-- Apply after admin-reporting.sql. Catalogue reconciliation inserts only missing pairs.
create unique index if not exists rxm_profiles_pair_unique on public.rxm_profiles
  ((upper(regexp_replace(btrim(payload->>'brand'),'[[:space:]]+',' ','g'))),
   (upper(regexp_replace(btrim(payload->>'generic'),'[[:space:]]+',' ','g'))));

insert into public.rxm_profiles(id,payload) values
 ('tofen','{"id":"tofen","generic":"Ketotifen","brand":"TOFEN","forms":["SYP","TAB"],"favorite":true}'),
 ('axodin','{"id":"axodin","generic":"Fexofenadine Hydrochloride","brand":"AXODIN","forms":["TAB","SUS"]}'),
 ('monocast','{"id":"monocast","generic":"Montelukast","brand":"MONOCAST","forms":["TAB"]}'),
 ('billi','{"id":"billi","generic":"Bilastine","brand":"BILLI","forms":["TAB","ORAL SOL"]}'),
 ('bexidal','{"id":"bexidal","generic":"Mebhydrolin","brand":"BEXIDAL","forms":["TAB"]}'),
 ('duvent','{"id":"duvent","generic":"Rupatadine","brand":"DUVENT","forms":["TAB","SYP"]}'),
 ('nasal','{"id":"nasal","generic":"Sodium Chloride","brand":"NASAL","forms":["NASAL SPRAY"]}'),
 ('atrizin','{"id":"atrizin","generic":"Cetirizine Dihydrochloride","brand":"ATRIZIN","forms":["TAB","SYP","DROP"]}')
on conflict do nothing;

create or replace function rxm_private.add_profiles(profiles jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare p jsonb; chosen_id text; added integer := 0; affected integer;
begin
  if jsonb_typeof(profiles) is distinct from 'array' then raise exception 'Profiles must be an array'; end if;
  for p in select value from jsonb_array_elements(profiles) loop
    if coalesce(btrim(p->>'brand'),'')='' or coalesce(btrim(p->>'generic'),'')='' or jsonb_typeof(p->'forms') is distinct from 'array' then continue; end if;
    if exists(select 1 from public.rxm_profiles r where
      upper(regexp_replace(btrim(r.payload->>'brand'),'[[:space:]]+',' ','g'))=upper(regexp_replace(btrim(p->>'brand'),'[[:space:]]+',' ','g')) and
      upper(regexp_replace(btrim(r.payload->>'generic'),'[[:space:]]+',' ','g'))=upper(regexp_replace(btrim(p->>'generic'),'[[:space:]]+',' ','g'))) then continue; end if;
    chosen_id := nullif(p->>'id','');
    if chosen_id is null or exists(select 1 from public.rxm_profiles where id=chosen_id) then
      chosen_id := 'discovered:' || jsonb_build_array(upper(regexp_replace(btrim(p->>'generic'),'[[:space:]]+',' ','g')),upper(regexp_replace(btrim(p->>'brand'),'[[:space:]]+',' ','g')))::text;
    end if;
    insert into public.rxm_profiles(id,payload) values(chosen_id,p || jsonb_build_object('id',chosen_id)) on conflict do nothing;
    get diagnostics affected = row_count;
    added := added + affected;
  end loop;
  return added;
end; $$;
revoke all on function rxm_private.add_profiles(jsonb) from public,anon,authenticated;

create or replace function rxm_private.source_profiles(dataset uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(p.value),'[]'::jsonb) from public.rxm_datasets d
 cross join lateral jsonb_array_elements(coalesce(d.payload->'catalog','[]'::jsonb)) p
 where d.id=dataset and d.complete and (
   -- Legacy catalogues were already filtered to Beximco by the importer.
   nullif(btrim(p.value->>'company'),'') is null or
   p.value->>'company' ~* '(^|[^[:alnum:]_])BEXIMCO([^[:alnum:]_]|$)'
 );
$$;
revoke all on function rxm_private.source_profiles(uuid) from public,anon,authenticated;

create or replace function rxm_private.write_brand_profiles(profiles jsonb) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if rxm_private.rxm_role() is null or rxm_private.rxm_role() not in ('owner','editor') then raise exception 'Brand editing access required'; end if;
  return rxm_private.add_profiles(profiles);
end; $$;
revoke all on function rxm_private.write_brand_profiles(jsonb) from public,anon;
grant execute on function rxm_private.write_brand_profiles(jsonb) to authenticated;
create or replace function public.rxm_add_brand_profiles(profiles jsonb) returns integer
language sql security invoker set search_path='' as $$select rxm_private.write_brand_profiles(profiles)$$;
revoke all on function public.rxm_add_brand_profiles(jsonb) from public,anon;
grant execute on function public.rxm_add_brand_profiles(jsonb) to authenticated;

create or replace function rxm_private.refresh_catalogue() returns integer
language plpgsql security definer set search_path='' as $$
declare d record; added integer := 0;
begin
  if rxm_private.rxm_role() is distinct from 'owner' then raise exception 'Admin access required'; end if;
  for d in select id from public.rxm_datasets where complete order by imported_at,id loop
    added := added + rxm_private.add_profiles(rxm_private.source_profiles(d.id));
  end loop;
  return added;
end; $$;
revoke all on function rxm_private.refresh_catalogue() from public,anon;
grant execute on function rxm_private.refresh_catalogue() to authenticated;
create or replace function public.rxm_refresh_catalogue() returns integer
language sql security invoker set search_path='' as $$select rxm_private.refresh_catalogue()$$;
revoke all on function public.rxm_refresh_catalogue() from public,anon;
grant execute on function public.rxm_refresh_catalogue() to authenticated;

create or replace function rxm_private.finish_import(dataset uuid,replace_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if rxm_private.rxm_role() is null or rxm_private.rxm_role() not in ('owner','editor') then raise exception 'Import access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724001);
  if not exists(select 1 from public.rxm_datasets where id=dataset and not complete and (imported_by=auth.uid() or rxm_private.rxm_role()='owner')) then raise exception 'Import not found or access denied'; end if;
  if not exists(select 1 from public.rxm_fact_chunks where dataset_id=dataset) then raise exception 'No prescription chunks were uploaded'; end if;
  update public.rxm_datasets set active=false where id=any(replace_ids);
  update public.rxm_datasets set complete=true,active=true where id=dataset;
  perform rxm_private.add_profiles(rxm_private.source_profiles(dataset));
end; $$;

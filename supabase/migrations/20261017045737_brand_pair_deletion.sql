-- Apply after brand-catalogue.sql. Keep deletion markers so imports and older
-- clients cannot recreate an admin-deleted normalized brand/generic pair.
create table public.rxm_deleted_brand_pairs (
  generic text not null,
  brand text not null,
  profile_id text not null,
  payload jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid default auth.uid(),
  primary key (generic,brand)
);
alter table public.rxm_deleted_brand_pairs enable row level security;
revoke all on public.rxm_deleted_brand_pairs from anon;
grant select,insert,update,delete on public.rxm_deleted_brand_pairs to authenticated;
create policy rxm_deleted_pairs_read on public.rxm_deleted_brand_pairs for select to authenticated
  using ((select rxm_private.rxm_role()) is not null);
create policy rxm_deleted_pairs_admin on public.rxm_deleted_brand_pairs for all to authenticated
  using ((select rxm_private.rxm_role()) = 'owner') with check ((select rxm_private.rxm_role()) = 'owner');

drop policy if exists rxm_profiles_write on public.rxm_profiles;
create policy rxm_profiles_insert on public.rxm_profiles for insert to authenticated
  with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_profiles_update on public.rxm_profiles for update to authenticated
  using ((select rxm_private.rxm_role()) in ('owner','editor')) with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_profiles_delete on public.rxm_profiles for delete to authenticated
  using ((select rxm_private.rxm_role()) = 'owner');

create function rxm_private.guard_brand_pair() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb; g text; b text;
begin
  perform pg_catalog.pg_advisory_xact_lock(724003);
  if TG_OP='DELETE' then p := OLD.payload; else p := NEW.payload; end if;
  g := upper(regexp_replace(btrim(p->>'generic'),'[[:space:]]+',' ','g'));
  b := upper(regexp_replace(btrim(p->>'brand'),'[[:space:]]+',' ','g'));
  if TG_OP='DELETE' then
    insert into public.rxm_deleted_brand_pairs(generic,brand,profile_id,payload)
      values(g,b,OLD.id,OLD.payload)
      on conflict(generic,brand) do update set profile_id=excluded.profile_id,payload=excluded.payload,deleted_at=now(),deleted_by=auth.uid();
    return OLD;
  end if;
  if exists(select 1 from public.rxm_deleted_brand_pairs d where d.generic=g and d.brand=b) then
    raise exception 'This brand pair was deleted by an admin and cannot be automatically restored.';
  end if;
  return NEW;
end; $$;
revoke all on function rxm_private.guard_brand_pair() from public,anon,authenticated;
create trigger rxm_guard_brand_pair before insert or update or delete on public.rxm_profiles
  for each row execute function rxm_private.guard_brand_pair();

create or replace function rxm_private.add_profiles(profiles jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare p jsonb; chosen_id text; added integer := 0; affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(724003);
  if jsonb_typeof(profiles) is distinct from 'array' then raise exception 'Profiles must be an array'; end if;
  for p in select value from jsonb_array_elements(profiles) loop
    if coalesce(btrim(p->>'brand'),'')='' or coalesce(btrim(p->>'generic'),'')='' or jsonb_typeof(p->'forms') is distinct from 'array' then continue; end if;
    if exists(select 1 from public.rxm_deleted_brand_pairs d where
      d.brand=upper(regexp_replace(btrim(p->>'brand'),'[[:space:]]+',' ','g')) and
      d.generic=upper(regexp_replace(btrim(p->>'generic'),'[[:space:]]+',' ','g'))) then continue; end if;
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

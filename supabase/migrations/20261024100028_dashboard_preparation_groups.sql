-- Add a form-aware dashboard API while keeping the original API and mail facts intact.
create function rxm_private.preparation_form(value text) returns text
language sql immutable set search_path='' as $$
 select case rxm_private.dashboard_normalize(value)
 when 'TABLET' then 'TAB' when 'TABLETS' then 'TAB' when 'SYRUP' then 'SYP'
 when 'CAPSULE' then 'CAP' when 'CAPSULES' then 'CAP' when 'SUSPENSION' then 'SUS'
 when 'ORAL SUSPENSION' then 'ORAL SUS' when 'ORAL SOLUTION' then 'ORAL SOL'
 when 'EYE DROPS' then 'EYE DROP' when 'OPHTHALMIC DROP' then 'EYE DROP' when 'OPHTHALMIC DROPS' then 'EYE DROP'
 when 'EAR DROPS' then 'EAR DROP' when 'NASAL DROPS' then 'NASAL DROP'
 when 'EYE OINTMENT' then 'EYE OINT' when 'OPHTHALMIC OINTMENT' then 'EYE OINT'
 when '' then 'UNKNOWN' else rxm_private.dashboard_normalize(value) end
$$;
create function rxm_private.preparation_key(generic text,brand text,company text,form text) returns text
language sql immutable set search_path='' as $$select rxm_private.dashboard_key(generic,brand,company)||chr(31)||rxm_private.preparation_form(form)$$;
create function rxm_private.preparation_market(form text) returns text
language sql immutable set search_path='' as $$
 select case
 when v ~ '^(EYE |OPHTHALMIC )' then 'EYE'
 when v ~ '^EAR ' then 'EAR' when v ~ '^NASAL ' then 'NASAL'
 when v ~ '^(INH|NEBU|SPACER)' then 'INHALED'
 when v ~ '^(IV|IM|INJ|SOL FOR INJ|SOL FOR INF)' then 'INJECTION'
 when v ~ '^(RECTAL |SUP$)' then 'RECTAL' when v ~ '^VAGINAL ' then 'VAGINAL'
 when v ~ '^(ORAL |TAB$|CAP$|SYP$|SUS$|SOFT CAP$|ELIXIR$|ORS$|SACHET$)' then 'ORAL'
 when v ~ '^(CREAM|OINT|GEL|LOTION|SHAMPOO|HAND RUB)$' then 'TOPICAL'
 else 'FORM:'||v end from (select rxm_private.preparation_form(form) v) f
$$;
create function rxm_private.summarize_preparations(facts jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_array(brand,company,form,rx)),'[]'::jsonb)
 from (select rxm_private.dashboard_normalize(f->>'brand') brand,rxm_private.dashboard_normalize(f->>'company') company,
 rxm_private.preparation_form(f->>'form') form,sum((f->>'count')::bigint) rx from jsonb_array_elements(facts) f group by 1,2,3) totals
$$;
revoke all on function rxm_private.preparation_form(text),rxm_private.preparation_key(text,text,text,text),rxm_private.preparation_market(text),rxm_private.summarize_preparations(jsonb) from public,anon;
grant execute on function rxm_private.preparation_form(text),rxm_private.preparation_key(text,text,text,text),rxm_private.preparation_market(text),rxm_private.summarize_preparations(jsonb) to authenticated;
alter table public.rxm_fact_chunks add column dashboard_preparation_summary jsonb;
create or replace function rxm_private.summarize_rx_chunk() returns trigger
language plpgsql set search_path='' as $$begin
 new.dashboard_summary := rxm_private.summarize_rx(new.payload);
 new.dashboard_preparation_summary := rxm_private.summarize_preparations(new.payload);
 return new;
end$$;

create table public.rxm_dashboard_preparation_taxonomy (
 key text primary key check(length(key) between 6 and 2003 and length(key)-length(replace(key,chr(31),''))=3),
 tg text not null check(length(tg) between 1 and 160)
);
alter table public.rxm_dashboard_preparation_taxonomy enable row level security;
revoke all on public.rxm_dashboard_preparation_taxonomy from public,anon,authenticated;
grant select on public.rxm_dashboard_preparation_taxonomy to authenticated;
create policy rxm_preparation_taxonomy_read on public.rxm_dashboard_preparation_taxonomy for select to authenticated
 using ((select rxm_private.rxm_role()) is not null);
create table public.rxm_dashboard_preparation_overrides (
 key text primary key check(length(key) between 6 and 2003 and length(key)-length(replace(key,chr(31),''))=3),
 tg text not null check(length(tg) between 1 and 160 and tg=rxm_private.dashboard_normalize(tg) and tg<>'UNCLASSIFIED'),
 updated_by uuid default auth.uid() references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create index rxm_preparation_override_editor on public.rxm_dashboard_preparation_overrides(updated_by);
alter table public.rxm_dashboard_preparation_overrides enable row level security;
revoke all on public.rxm_dashboard_preparation_overrides from public,anon,authenticated;
grant select on public.rxm_dashboard_preparation_overrides to authenticated;
grant insert(key,tg),update(tg) on public.rxm_dashboard_preparation_overrides to authenticated;
create policy rxm_preparation_override_read on public.rxm_dashboard_preparation_overrides for select to authenticated
 using ((select rxm_private.rxm_role()) is not null);
create policy rxm_preparation_override_insert on public.rxm_dashboard_preparation_overrides for insert to authenticated
 with check ((select rxm_private.rxm_role()) in ('owner','editor') and updated_by=(select auth.uid()) and tg=any((select public.rxm_dashboard_tg_options())::text[]));
create policy rxm_preparation_override_update on public.rxm_dashboard_preparation_overrides for update to authenticated
 using ((select rxm_private.rxm_role()) in ('owner','editor'))
 with check ((select rxm_private.rxm_role()) in ('owner','editor') and updated_by=(select auth.uid()) and tg=any((select public.rxm_dashboard_tg_options())::text[]));
create trigger rxm_preparation_override_stamp before insert or update on public.rxm_dashboard_preparation_overrides for each row execute function rxm_private.stamp_dashboard_tg();

create or replace function public.rxm_dashboard_tg_options() returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare choices text[];
begin
 if (select rxm_private.rxm_role()) is null then raise exception 'Workspace access required'; end if;
 select coalesce(array_agg(distinct name order by name),'{}'::text[]) into choices from (
   select rxm_private.dashboard_normalize(tg) name from public.rxm_dashboard_taxonomy
   union all select rxm_private.dashboard_normalize(tg) from public.rxm_dashboard_preparation_taxonomy
   union all select rxm_private.dashboard_normalize(t.value) from public.rxm_datasets d
   cross join lateral jsonb_each_text(case when jsonb_typeof(d.payload->'preparationGroups')='object' then d.payload->'preparationGroups'
     when jsonb_typeof(d.payload->'therapeuticGroups')='object' then d.payload->'therapeuticGroups' else '{}'::jsonb end) t where d.complete
 ) available where name<>'' and name<>'UNCLASSIFIED';
 return choices;
end$$;
create function public.rxm_assign_preparation_tg(generic_name text,brand_name text,company_names text[],dosage_forms text[],target_tg text) returns void
language plpgsql security invoker set search_path='' as $$
declare g text:=rxm_private.dashboard_normalize(generic_name); b text:=rxm_private.dashboard_normalize(brand_name); selected_tg text:=rxm_private.dashboard_normalize(target_tg); company text; form text;
begin
 if coalesce((select rxm_private.rxm_role()),'') not in ('owner','editor') then raise exception 'TG editing requires Admin or Editor access'; end if;
 if length(g) not between 1 and 500 or length(b) not between 1 and 500 or position(chr(31) in g||b)>0 then raise exception 'Invalid brand or generic'; end if;
 if company_names is null or cardinality(company_names) not between 1 and 20 or dosage_forms is null or cardinality(dosage_forms) not between 1 and 50 then raise exception 'Invalid preparation selection'; end if;
 if not (selected_tg=any(public.rxm_dashboard_tg_options())) then raise exception 'Select a TG from the list'; end if;
 foreach company in array company_names loop
   company:=rxm_private.dashboard_normalize(company);
   if length(company) not between 1 and 500 or position(chr(31) in company)>0 then raise exception 'Invalid company selection'; end if;
   foreach form in array dosage_forms loop
     if form is null or length(form) not between 1 and 500 or position(chr(31) in form)>0 then raise exception 'Invalid dosage form'; end if;
     insert into public.rxm_dashboard_preparation_overrides(key,tg) values(rxm_private.preparation_key(g,b,company,form),selected_tg)
     on conflict(key) do update set tg=excluded.tg;
   end loop;
 end loop;
end$$;
revoke all on function public.rxm_assign_preparation_tg(text,text,text[],text[],text) from public,anon;
grant execute on function public.rxm_assign_preparation_tg(text,text,text[],text[],text) to authenticated;

create function public.rxm_dashboard_preparations(from_month text,to_month text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select rxm_private.rxm_role()) is null then raise exception 'Workspace access required'; end if;
 if from_month is null or to_month is null or from_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or to_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or from_month>to_month then raise exception 'Choose a valid month range'; end if;
 if exists(select 1 from public.rxm_fact_chunks c join public.rxm_datasets d on d.id=c.dataset_id where d.active and d.complete and c.month between from_month and to_month and c.dashboard_preparation_summary is null) then raise exception 'Preparation summaries are being refreshed. Try again shortly.'; end if;
 if exists(select 1 from public.rxm_datasets a join public.rxm_datasets b on a.id<b.id and a.from_date<=b.to_date and b.from_date<=a.to_date
   where a.active and a.complete and b.active and b.complete and left(a.from_date::text,7)<=to_month and left(a.to_date::text,7)>=from_month
   and exists(select 1 from public.rxm_fact_chunks c join public.rxm_fact_chunks e on c.month=e.month and c.generic=e.generic where c.dataset_id=a.id and e.dataset_id=b.id and c.month between from_month and to_month)) then raise exception 'Active source dates overlap. Keep one version of each market before viewing the dashboard.'; end if;
 with sources as materialized (select id,coalesce(payload->'preparationGroups','{}'::jsonb) mapping from public.rxm_datasets where active and complete), counts as materialized (
   select c.dataset_id,c.generic,s->>0 brand,s->>1 company,s->>2 form,sum((s->>3)::bigint) rx
   from public.rxm_fact_chunks c join sources d on d.id=c.dataset_id
   cross join lateral jsonb_array_elements(c.dashboard_preparation_summary) s
   where c.month between from_month and to_month group by 1,2,3,4,5
 ), keyed as materialized (select c.*,rxm_private.preparation_key(c.generic,c.brand,c.company,c.form) key from counts c), classified as (
   select coalesce(o.tg,nullif(case when d.mapping ? c.key then d.mapping->>c.key else coalesce(t.tg,legacy.tg) end,''),'Unclassified') tg,
     c.generic,c.brand,c.company,c.rx,c.form
   from keyed c join sources d on d.id=c.dataset_id
   left join public.rxm_dashboard_preparation_taxonomy t on t.key=c.key
   left join public.rxm_dashboard_taxonomy legacy on legacy.key=rxm_private.dashboard_key(c.generic,c.brand,c.company)
   left join public.rxm_dashboard_preparation_overrides o on o.key=c.key
 ), totals as (select tg,generic,brand,company,form,sum(rx) rx from classified group by 1,2,3,4,5)
 select coalesce(jsonb_agg(jsonb_build_array(tg,generic,brand,company,rx,form)),'[]'::jsonb) into result from totals;
 return result;
end$$;
revoke all on function public.rxm_dashboard_preparations(text,text) from public,anon;
grant execute on function public.rxm_dashboard_preparations(text,text) to authenticated;

-- Run once after the bounded summary backfill and reference import. Preserve the
-- legacy table; carry only mappings with a single known route and no TG conflict.
create function rxm_private.carry_preparation_overrides() returns integer
language plpgsql security invoker set search_path='' as $$
declare added integer;
begin
 with known as materialized (
   select key,tg from public.rxm_dashboard_preparation_taxonomy
   union all select t.key,t.value from public.rxm_datasets d cross join lateral jsonb_each_text(
     case when jsonb_typeof(d.payload->'preparationGroups')='object' then d.payload->'preparationGroups' else '{}'::jsonb end) t
 ), observed as materialized (
   select distinct rxm_private.dashboard_key(c.generic,s->>0,s->>1) base,s->>2 form
   from public.rxm_fact_chunks c cross join lateral jsonb_array_elements(c.dashboard_preparation_summary) s
   union select split_part(key,chr(31),1)||chr(31)||split_part(key,chr(31),2)||chr(31)||split_part(key,chr(31),3),split_part(key,chr(31),4) from known
 ), safe as (
   select o.key,o.tg from public.rxm_dashboard_tg_overrides o join observed f on f.base=o.key
   group by o.key,o.tg having count(distinct rxm_private.preparation_market(f.form))=1
     and bool_and(f.form<>'UNKNOWN') and not exists(select 1 from known k where left(k.key,length(o.key)+1)=o.key||chr(31) and k.tg<>o.tg)
 ), copied as (
   insert into public.rxm_dashboard_preparation_overrides(key,tg)
   select distinct f.base||chr(31)||f.form,s.tg from observed f join safe s on s.key=f.base
   on conflict(key) do nothing returning key
 ) select count(*) into added from copied;
 return added;
end$$;
revoke all on function rxm_private.carry_preparation_overrides() from public,anon,authenticated;

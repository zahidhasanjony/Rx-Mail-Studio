-- Manual dashboard-only mappings override source/reference TGs across reporting months.
create table public.rxm_dashboard_tg_overrides (
  key text primary key check (length(key) between 3 and 1502 and length(key)-length(replace(key,chr(31),''))=2),
  tg text not null check (length(tg) between 1 and 160 and tg=rxm_private.dashboard_normalize(tg) and tg<>'UNCLASSIFIED'),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.rxm_dashboard_tg_overrides enable row level security;
revoke all on public.rxm_dashboard_tg_overrides from public,anon,authenticated;
grant select on public.rxm_dashboard_tg_overrides to authenticated;
grant insert(key,tg),update(tg) on public.rxm_dashboard_tg_overrides to authenticated;
create policy rxm_dashboard_tg_read on public.rxm_dashboard_tg_overrides for select to authenticated
using ((select rxm_private.rxm_role()) is not null);

create function public.rxm_dashboard_tg_options() returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare choices text[];
begin
 if (select rxm_private.rxm_role()) is null then raise exception 'Workspace access required'; end if;
 select coalesce(array_agg(distinct name order by name),'{}'::text[]) into choices from (
   select rxm_private.dashboard_normalize(tg) name from public.rxm_dashboard_taxonomy
   union all
   select rxm_private.dashboard_normalize(t.value) from public.rxm_datasets d
   cross join lateral jsonb_each_text(case when jsonb_typeof(d.payload->'therapeuticGroups')='object' then d.payload->'therapeuticGroups' else '{}'::jsonb end) t
   where d.complete
 ) available where name<>'' and name<>'UNCLASSIFIED';
 return choices;
end$$;
revoke all on function public.rxm_dashboard_tg_options() from public,anon;
grant execute on function public.rxm_dashboard_tg_options() to authenticated;

create policy rxm_dashboard_tg_insert on public.rxm_dashboard_tg_overrides for insert to authenticated
with check ((select rxm_private.rxm_role()) in ('owner','editor') and updated_by=(select auth.uid()) and tg=any((select public.rxm_dashboard_tg_options())::text[]));
create policy rxm_dashboard_tg_update on public.rxm_dashboard_tg_overrides for update to authenticated
using ((select rxm_private.rxm_role()) in ('owner','editor'))
with check ((select rxm_private.rxm_role()) in ('owner','editor') and updated_by=(select auth.uid()) and tg=any((select public.rxm_dashboard_tg_options())::text[]));

create function rxm_private.stamp_dashboard_tg() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.updated_by:=auth.uid(); new.updated_at:=now(); return new; end$$;
revoke all on function rxm_private.stamp_dashboard_tg() from public,anon;
create trigger rxm_dashboard_tg_stamp before insert or update on public.rxm_dashboard_tg_overrides for each row execute function rxm_private.stamp_dashboard_tg();

create function public.rxm_assign_dashboard_tg(generic_name text,brand_name text,company_names text[],target_tg text) returns void
language plpgsql security invoker set search_path='' as $$
declare g text:=rxm_private.dashboard_normalize(generic_name); b text:=rxm_private.dashboard_normalize(brand_name); selected_tg text:=rxm_private.dashboard_normalize(target_tg); company text;
begin
 if coalesce((select rxm_private.rxm_role()),'') not in ('owner','editor') then raise exception 'TG editing requires Admin or Editor access'; end if;
 if length(g) not between 1 and 500 or length(b) not between 1 and 500 or position(chr(31) in g||b)>0 then raise exception 'Invalid brand or generic'; end if;
 if company_names is null or cardinality(company_names) not between 1 and 20 then raise exception 'Invalid company selection'; end if;
 if not (selected_tg=any(public.rxm_dashboard_tg_options())) then raise exception 'Select a TG from the list'; end if;
 foreach company in array company_names loop
   company:=rxm_private.dashboard_normalize(company);
   if length(company) not between 1 and 500 or position(chr(31) in company)>0 then raise exception 'Invalid company selection'; end if;
   insert into public.rxm_dashboard_tg_overrides(key,tg) values(rxm_private.dashboard_key(g,b,company),selected_tg)
   on conflict(key) do update set tg=excluded.tg;
 end loop;
end$$;
revoke all on function public.rxm_assign_dashboard_tg(text,text,text[],text) from public,anon;
grant execute on function public.rxm_assign_dashboard_tg(text,text,text[],text) to authenticated;

create or replace function public.rxm_dashboard(from_month text,to_month text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select rxm_private.rxm_role()) is null then raise exception 'Workspace access required'; end if;
 if from_month is null or to_month is null or from_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or to_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or from_month>to_month then raise exception 'Choose a valid month range'; end if;
 if exists(select 1 from public.rxm_fact_chunks c join public.rxm_datasets d on d.id=c.dataset_id where d.active and d.complete and c.month between from_month and to_month and c.dashboard_summary is null) then raise exception 'Dashboard summaries are being prepared. Try again shortly.'; end if;
 if exists(select 1 from public.rxm_datasets a join public.rxm_datasets b on a.id<b.id and a.from_date<=b.to_date and b.from_date<=a.to_date
   where a.active and a.complete and b.active and b.complete and left(a.from_date::text,7)<=to_month and left(a.to_date::text,7)>=from_month
   and exists(select 1 from public.rxm_fact_chunks c join public.rxm_fact_chunks e on c.month=e.month and c.generic=e.generic where c.dataset_id=a.id and e.dataset_id=b.id and c.month between from_month and to_month)) then raise exception 'Active source dates overlap. Keep one version of each market before viewing the dashboard.'; end if;
 with sources as materialized (select id,coalesce(payload->'therapeuticGroups','{}'::jsonb) mapping from public.rxm_datasets where active and complete), counts as materialized (
   select c.dataset_id,c.generic,s->>0 brand,s->>1 company,sum((s->>2)::bigint) rx
   from public.rxm_fact_chunks c join sources d on d.id=c.dataset_id
   cross join lateral jsonb_array_elements(c.dashboard_summary) s
   where c.month between from_month and to_month group by 1,2,3,4
 ), keyed as materialized (select c.*,rxm_private.dashboard_key(c.generic,c.brand,c.company) key from counts c), classified as (
   select coalesce(o.tg,nullif(case when d.mapping ? c.key
     then d.mapping->>c.key else t.tg end,''),'Unclassified') tg,
     c.generic,c.brand,c.company,c.rx
   from keyed c join sources d on d.id=c.dataset_id
   left join public.rxm_dashboard_taxonomy t on t.key=c.key
   left join public.rxm_dashboard_tg_overrides o on o.key=c.key
 ), totals as (select tg,generic,brand,company,sum(rx) rx from classified group by 1,2,3,4)
 select coalesce(jsonb_agg(jsonb_build_array(tg,generic,brand,company,rx)),'[]'::jsonb) into result from totals;
 return result;
end$$;

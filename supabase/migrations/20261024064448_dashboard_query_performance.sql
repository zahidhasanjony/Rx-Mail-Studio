-- Read large source metadata once, and normalize each aggregated market key once.
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
   select coalesce(nullif(case when d.mapping ? c.key
     then d.mapping->>c.key else t.tg end,''),'Unclassified') tg,
     c.generic,c.brand,c.company,c.rx
   from keyed c join sources d on d.id=c.dataset_id
   left join public.rxm_dashboard_taxonomy t on t.key=c.key
 ), totals as (select tg,generic,brand,company,sum(rx) rx from classified group by 1,2,3,4)
 select coalesce(jsonb_agg(jsonb_build_array(tg,generic,brand,company,rx)),'[]'::jsonb) into result from totals;
 return result;
end$$;

-- Compact, non-identifying dashboard summaries; original upload payloads stay unchanged.
alter table public.rxm_fact_chunks add column dashboard_summary jsonb;
create table public.rxm_dashboard_taxonomy (
  key text primary key,
  tg text not null check (length(tg) between 1 and 160)
);
alter table public.rxm_dashboard_taxonomy enable row level security;
revoke all on public.rxm_dashboard_taxonomy from public,anon,authenticated;
grant select on public.rxm_dashboard_taxonomy to authenticated;
create policy rxm_dashboard_taxonomy_read on public.rxm_dashboard_taxonomy for select to authenticated
using ((select rxm_private.rxm_role()) is not null);

create function rxm_private.dashboard_normalize(value text) returns text
language sql immutable set search_path='' as $$select upper(regexp_replace(btrim(coalesce(value,'')),'\s+',' ','g'))$$;
create function rxm_private.dashboard_key(generic text,brand text,company text) returns text
language sql immutable set search_path='' as $$select rxm_private.dashboard_normalize(generic)||chr(31)||rxm_private.dashboard_normalize(brand)||chr(31)||rxm_private.dashboard_normalize(company)$$;
create function rxm_private.summarize_rx(facts jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_array(brand,company,rx)),'[]'::jsonb)
 from (select rxm_private.dashboard_normalize(f->>'brand') brand,rxm_private.dashboard_normalize(f->>'company') company,
 sum((f->>'count')::bigint) rx from jsonb_array_elements(facts) f group by 1,2) totals
$$;
create function rxm_private.summarize_rx_chunk() returns trigger
language plpgsql set search_path='' as $$begin new.dashboard_summary := rxm_private.summarize_rx(new.payload); return new; end$$;
revoke all on function rxm_private.dashboard_normalize(text),rxm_private.dashboard_key(text,text,text),rxm_private.summarize_rx(jsonb),rxm_private.summarize_rx_chunk() from public,anon;
grant execute on function rxm_private.dashboard_normalize(text),rxm_private.dashboard_key(text,text,text),rxm_private.summarize_rx(jsonb) to authenticated;
create trigger rxm_dashboard_chunk before insert or update of payload on public.rxm_fact_chunks for each row execute function rxm_private.summarize_rx_chunk();
-- API clients can submit prescription payloads, never forge cached totals.
revoke insert,update on public.rxm_fact_chunks from authenticated;
grant insert(dataset_id,month,generic,payload),update(month,generic,payload) on public.rxm_fact_chunks to authenticated;

create function public.rxm_dashboard(from_month text,to_month text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select rxm_private.rxm_role()) is null then raise exception 'Workspace access required'; end if;
 if from_month is null or to_month is null or from_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or to_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or from_month>to_month then raise exception 'Choose a valid month range'; end if;
 if exists(select 1 from public.rxm_fact_chunks c join public.rxm_datasets d on d.id=c.dataset_id where d.active and d.complete and c.month between from_month and to_month and c.dashboard_summary is null) then raise exception 'Dashboard summaries are being prepared. Try again shortly.'; end if;
 if exists(select 1 from public.rxm_datasets a join public.rxm_datasets b on a.id<b.id and a.from_date<=b.to_date and b.from_date<=a.to_date
   where a.active and a.complete and b.active and b.complete and left(a.from_date::text,7)<=to_month and left(a.to_date::text,7)>=from_month
   and exists(select 1 from public.rxm_fact_chunks c join public.rxm_fact_chunks e on c.month=e.month and c.generic=e.generic where c.dataset_id=a.id and e.dataset_id=b.id and c.month between from_month and to_month)) then raise exception 'Active source dates overlap. Keep one version of each market before viewing the dashboard.'; end if;
 with counts as (
   select c.dataset_id,c.generic,s->>0 brand,s->>1 company,sum((s->>2)::bigint) rx
   from public.rxm_fact_chunks c join public.rxm_datasets d on d.id=c.dataset_id
   cross join lateral jsonb_array_elements(c.dashboard_summary) s
   where d.active and d.complete and c.month between from_month and to_month group by 1,2,3,4
 ), classified as (
   select coalesce(nullif(case when coalesce(d.payload->'therapeuticGroups','{}'::jsonb) ? rxm_private.dashboard_key(c.generic,c.brand,c.company)
     then d.payload->'therapeuticGroups'->>rxm_private.dashboard_key(c.generic,c.brand,c.company) else t.tg end,''),'Unclassified') tg,
     c.generic,c.brand,c.company,c.rx
   from counts c join public.rxm_datasets d on d.id=c.dataset_id
   left join public.rxm_dashboard_taxonomy t on t.key=rxm_private.dashboard_key(c.generic,c.brand,c.company)
 ), totals as (select tg,generic,brand,company,sum(rx) rx from classified group by 1,2,3,4)
 select coalesce(jsonb_agg(jsonb_build_array(tg,generic,brand,company,rx)),'[]'::jsonb) into result from totals;
 return result;
end$$;
revoke all on function public.rxm_dashboard(text,text) from public,anon;
grant execute on function public.rxm_dashboard(text,text) to authenticated;

-- Apply after schema.sql and username-auth.sql. Shared wording never includes signatures or personal CC.
create table if not exists public.rxm_workspace_defaults (
  id text primary key check (id = 'email'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload ?& array['subject','opening','body']),
  updated_at timestamptz not null default now()
);
insert into public.rxm_workspace_defaults(id,payload) values ('email', '{"subject":"{Generic} ({Brand}) Prescriber List of {Region} Region for {Period}","opening":"Please find below the prescription share and prescribers list of {Generic} and {Brand} Rx scenario in {Region} Region for {Period}.","body":"{RegionalShare}\n{ASEShare}\n{MPEShare}\n{Prescribers}"}') on conflict(id) do nothing;
alter table public.rxm_workspace_defaults enable row level security;
revoke all on public.rxm_workspace_defaults from anon;
grant select,insert,update,delete on public.rxm_workspace_defaults to authenticated;
create policy rxm_defaults_read on public.rxm_workspace_defaults for select to authenticated using ((select rxm_private.rxm_role()) is not null);
create policy rxm_defaults_admin on public.rxm_workspace_defaults for all to authenticated using ((select rxm_private.rxm_role()) = 'owner') with check ((select rxm_private.rxm_role()) = 'owner');

drop policy if exists rxm_datasets_write on public.rxm_datasets;
create policy rxm_datasets_insert on public.rxm_datasets for insert to authenticated with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_datasets_update on public.rxm_datasets for update to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_datasets_delete on public.rxm_datasets for delete to authenticated using ((select rxm_private.rxm_role()) = 'owner');
alter table public.rxm_datasets add column if not exists imported_by uuid default auth.uid();
-- Only the database assigns import ownership and completion. Editors can still upload and activate sources.
revoke insert,update on public.rxm_datasets from authenticated;
grant insert(id,name,hash,from_date,to_date,imported_at,active,complete,payload) on public.rxm_datasets to authenticated;
grant update(active,payload) on public.rxm_datasets to authenticated;

drop policy if exists rxm_chunks_write on public.rxm_fact_chunks;
create policy rxm_chunks_insert on public.rxm_fact_chunks for insert to authenticated with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_chunks_update on public.rxm_fact_chunks for update to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check ((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_chunks_delete on public.rxm_fact_chunks for delete to authenticated using ((select rxm_private.rxm_role()) = 'owner');

drop policy if exists rxm_hierarchy_write on public.rxm_hierarchies;
create policy rxm_hierarchy_write on public.rxm_hierarchies for all to authenticated using ((select rxm_private.rxm_role()) = 'owner') with check ((select rxm_private.rxm_role()) = 'owner');

create or replace function public.rxm_export_hierarchy(hierarchy_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if rxm_private.rxm_role() is distinct from 'owner' then raise exception 'Admin access required'; end if;
  select payload into result from public.rxm_hierarchies where id = hierarchy_id;
  return result;
end; $$;
revoke all on function public.rxm_export_hierarchy(uuid) from public,anon;
grant execute on function public.rxm_export_hierarchy(uuid) to authenticated;

-- Failed uploads are not library imports. The importer can clean up only their own unfinished upload.
create or replace function rxm_private.cleanup_import(dataset uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if rxm_private.rxm_role() not in ('owner','editor') or rxm_private.rxm_role() is null then raise exception 'Import access required'; end if;
  delete from public.rxm_datasets where id = dataset and not complete and imported_by = auth.uid();
end; $$;
revoke all on function rxm_private.cleanup_import(uuid) from public,anon;
grant execute on function rxm_private.cleanup_import(uuid) to authenticated;
create or replace function public.rxm_cleanup_import(dataset uuid) returns void
language sql security invoker set search_path = '' as $$select rxm_private.cleanup_import(dataset)$$;
revoke all on function public.rxm_cleanup_import(uuid) from public,anon;
grant execute on function public.rxm_cleanup_import(uuid) to authenticated;

-- Finish uploads with database-assigned ownership; completion is not client-writable.
create or replace function rxm_private.finish_import(dataset uuid, replace_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if rxm_private.rxm_role() not in ('owner','editor') or rxm_private.rxm_role() is null then raise exception 'Import access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(724001);
  if not exists(select 1 from public.rxm_datasets where id=dataset and not complete and
    (imported_by=auth.uid() or rxm_private.rxm_role()='owner')) then raise exception 'Import not found or access denied'; end if;
  if not exists(select 1 from public.rxm_fact_chunks where dataset_id=dataset) then raise exception 'No prescription chunks were uploaded'; end if;
  update public.rxm_datasets set active=false where id=any(replace_ids);
  update public.rxm_datasets set complete=true,active=true where id=dataset;
end; $$;
revoke all on function rxm_private.finish_import(uuid,uuid[]) from public,anon;
grant execute on function rxm_private.finish_import(uuid,uuid[]) to authenticated;
create or replace function public.rxm_finish_import(dataset uuid,replace_ids uuid[] default '{}') returns void
language sql security invoker set search_path = '' as $$select rxm_private.finish_import(dataset,replace_ids)$$;
revoke all on function public.rxm_finish_import(uuid,uuid[]) from public,anon;
grant execute on function public.rxm_finish_import(uuid,uuid[]) to authenticated;

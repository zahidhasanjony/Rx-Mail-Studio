-- Isolated Rx Mail Studio tables; existing campaign tables are untouched.
begin;
create schema if not exists rxm_private;
revoke all on schema rxm_private from public, anon;
grant usage on schema rxm_private to authenticated;
create table public.rxm_members (email text primary key check(email=lower(email)),role text not null check(role in ('owner','editor','member')),created_at timestamptz not null default now());
-- Replace this example address with your verified workspace owner before installing.
insert into public.rxm_members(email,role) values ('owner@example.com','owner');
-- Internal lookup of verified Auth identity and membership. It is deliberately
-- outside the exposed public schema and is never callable through the Data API.
create function rxm_private.rxm_role() returns text language plpgsql stable security definer set search_path='' as $$
declare member_role text;
begin
 if auth.uid() is null then return null; end if;
 select m.role into member_role from public.rxm_members m join auth.users u on lower(u.email)=m.email
 where u.id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false);
 return member_role;
end $$;
revoke all on function rxm_private.rxm_role() from public, anon;
grant execute on function rxm_private.rxm_role() to authenticated;
create table public.rxm_datasets (id uuid primary key,name text not null,hash text not null unique,from_date date not null,to_date date not null,imported_at timestamptz not null,active boolean not null default false,complete boolean not null default false,payload jsonb not null,check(to_date>=from_date),check(not active or complete));
create index rxm_datasets_active_dates on public.rxm_datasets(from_date,to_date) where active and complete;
create table public.rxm_fact_chunks (id bigint generated always as identity primary key,dataset_id uuid not null references public.rxm_datasets(id) on delete cascade,month text not null check(month ~ '^\d{4}-\d{2}$'),generic text not null,payload jsonb not null check(jsonb_typeof(payload)='array' and octet_length(payload::text)<2000000));
create index rxm_chunks_lookup on public.rxm_fact_chunks(dataset_id,month,generic,id);
create table public.rxm_hierarchies (id uuid primary key,effective_from date not null,created_at timestamptz not null,payload jsonb not null);
create table public.rxm_profiles (id text primary key,payload jsonb not null);
create table public.rxm_settings (user_id uuid primary key references auth.users(id) on delete cascade,payload jsonb not null);
create table public.rxm_user_templates (email text primary key references public.rxm_members(email) on delete cascade,payload jsonb not null);
create table public.rxm_batches (id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null,payload jsonb not null);
create index rxm_batches_user_created on public.rxm_batches(user_id,created_at desc);
alter table public.rxm_members enable row level security;
alter table public.rxm_datasets enable row level security;
alter table public.rxm_fact_chunks enable row level security;
alter table public.rxm_hierarchies enable row level security;
alter table public.rxm_profiles enable row level security;
alter table public.rxm_settings enable row level security;
alter table public.rxm_user_templates enable row level security;
alter table public.rxm_batches enable row level security;
revoke all on public.rxm_members,public.rxm_datasets,public.rxm_fact_chunks,public.rxm_hierarchies,public.rxm_profiles,public.rxm_settings,public.rxm_batches from anon;
revoke all on public.rxm_user_templates from anon;
grant select,insert,update,delete on public.rxm_user_templates to authenticated;
grant select,insert,update,delete on public.rxm_members,public.rxm_datasets,public.rxm_fact_chunks,public.rxm_hierarchies,public.rxm_profiles,public.rxm_settings,public.rxm_batches to authenticated;
grant usage,select on sequence public.rxm_fact_chunks_id_seq to authenticated;
create policy rxm_members_read on public.rxm_members for select to authenticated using ((select rxm_private.rxm_role())='owner' or (email=lower((select auth.jwt()->>'email')) and (select rxm_private.rxm_role()) is not null));
create policy rxm_members_manage on public.rxm_members for all to authenticated using ((select rxm_private.rxm_role())='owner') with check((select rxm_private.rxm_role())='owner');
create policy rxm_datasets_read on public.rxm_datasets for select to authenticated using ((select rxm_private.rxm_role()) is not null);
create policy rxm_datasets_write on public.rxm_datasets for all to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_chunks_read on public.rxm_fact_chunks for select to authenticated using ((select rxm_private.rxm_role()) is not null and exists(select 1 from public.rxm_datasets d where d.id=dataset_id and d.complete));
create policy rxm_chunks_write on public.rxm_fact_chunks for all to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_hierarchy_read on public.rxm_hierarchies for select to authenticated using ((select rxm_private.rxm_role()) is not null);
create policy rxm_hierarchy_write on public.rxm_hierarchies for all to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_profiles_read on public.rxm_profiles for select to authenticated using ((select rxm_private.rxm_role()) is not null);
create policy rxm_profiles_write on public.rxm_profiles for all to authenticated using ((select rxm_private.rxm_role()) in ('owner','editor')) with check((select rxm_private.rxm_role()) in ('owner','editor'));
create policy rxm_settings_self on public.rxm_settings for all to authenticated using (user_id=(select auth.uid()) and (select rxm_private.rxm_role()) is not null) with check(user_id=(select auth.uid()) and (select rxm_private.rxm_role()) is not null);
create policy rxm_templates_self on public.rxm_user_templates for select to authenticated using (email=lower((select auth.jwt()->>'email')) and (select rxm_private.rxm_role()) is not null);
create policy rxm_templates_owner_write on public.rxm_user_templates for insert to authenticated with check ((select rxm_private.rxm_role())='owner');
create policy rxm_templates_owner_update on public.rxm_user_templates for update to authenticated using ((select rxm_private.rxm_role())='owner') with check ((select rxm_private.rxm_role())='owner');
create policy rxm_templates_owner_delete on public.rxm_user_templates for delete to authenticated using ((select rxm_private.rxm_role())='owner');
create policy rxm_batches_self on public.rxm_batches for all to authenticated using (user_id=(select auth.uid()) and (select rxm_private.rxm_role()) is not null) with check(user_id=(select auth.uid()) and (select rxm_private.rxm_role()) is not null);
create function public.rxm_check_coverage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.active and new.complete then
  perform pg_catalog.pg_advisory_xact_lock(724001);
  if exists(select 1 from public.rxm_datasets d where d.id<>new.id and d.active and d.complete and d.from_date<=new.to_date and d.to_date>=new.from_date) then
   raise exception 'Reporting coverage overlaps an active import. Deactivate the older import first.';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.rxm_check_coverage() from public,anon,authenticated;
create trigger rxm_coverage before insert or update of active,complete,from_date,to_date on public.rxm_datasets for each row execute function public.rxm_check_coverage();
create function public.rxm_finish_import(dataset uuid,replace_ids uuid[] default '{}') returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(724001);
 if not exists(select 1 from public.rxm_fact_chunks where dataset_id=dataset) then raise exception 'No prescription chunks were uploaded'; end if;
 update public.rxm_datasets set active=false where id=any(replace_ids);
 update public.rxm_datasets set complete=true,active=true where id=dataset;
 if not found then raise exception 'Import not found or access denied'; end if;
end $$;
revoke all on function public.rxm_finish_import(uuid,uuid[]) from public,anon;
grant execute on function public.rxm_finish_import(uuid,uuid[]) to authenticated;
commit;

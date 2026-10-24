-- Shared reporting reads remain available; source and catalogue management is admin-only.
begin;
create function rxm_private.guard_management_write() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (auth.uid() is not null and rxm_private.rxm_role() is distinct from 'owner')
     or (auth.uid() is null and current_user in ('anon','authenticated')) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;
revoke all on function rxm_private.guard_management_write() from public,anon,authenticated;
-- The trigger also guards writes made by existing SECURITY DEFINER import/catalogue RPCs.
do $$
declare target text;
begin
  foreach target in array array['rxm_datasets','rxm_fact_chunks','rxm_hierarchies','rxm_profiles'] loop
    execute format('create trigger rxm_management_admin before insert or update or delete on public.%I for each row execute function rxm_private.guard_management_write()', target);
    execute format('create policy rxm_management_admin_insert on public.%I as restrictive for insert to authenticated with check ((select rxm_private.rxm_role()) = ''owner'')', target);
    execute format('create policy rxm_management_admin_update on public.%I as restrictive for update to authenticated using ((select rxm_private.rxm_role()) = ''owner'') with check ((select rxm_private.rxm_role()) = ''owner'')', target);
    execute format('create policy rxm_management_admin_delete on public.%I as restrictive for delete to authenticated using ((select rxm_private.rxm_role()) = ''owner'')', target);
  end loop;
end $$;
commit;

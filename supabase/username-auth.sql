-- Apply after schema.sql. Account credentials are accessible only to the server.
begin;
create table public.rxm_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username=upper(username) and username ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'),
 display_name text not null check(length(display_name) between 1 and 120),
 login_email text not null unique references public.rxm_members(email) on delete cascade,
 password_salt text not null check(password_salt ~ '^[a-f0-9]{64}$'),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.rxm_login_limits (
 bucket text primary key check(bucket ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null default now(), attempts integer not null default 1
);
create table public.rxm_auth_bootstrap (
 id integer primary key check(id=1), token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null
);
alter table public.rxm_accounts enable row level security;
alter table public.rxm_login_limits enable row level security;
alter table public.rxm_auth_bootstrap enable row level security;
revoke all on public.rxm_accounts,public.rxm_login_limits,public.rxm_auth_bootstrap from public,anon,authenticated;
grant all on public.rxm_accounts,public.rxm_login_limits,public.rxm_auth_bootstrap to service_role;
create policy rxm_accounts_server_only on public.rxm_accounts for all to anon,authenticated using (false) with check (false);
create policy rxm_limits_server_only on public.rxm_login_limits for all to anon,authenticated using (false) with check (false);
create policy rxm_bootstrap_server_only on public.rxm_auth_bootstrap for all to anon,authenticated using (false) with check (false);

-- Existing RLS policies now require an active username account too.
create or replace function rxm_private.rxm_role() returns text language plpgsql stable security definer set search_path='' as $$
declare member_role text;
begin
 if auth.uid() is null then return null; end if;
 select m.role into member_role from public.rxm_members m
 join auth.users u on lower(u.email)=m.email
 join public.rxm_accounts a on a.user_id=u.id and a.login_email=m.email
 where u.id=auth.uid() and a.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false);
 return member_role;
end $$;
revoke all on function rxm_private.rxm_role() from public,anon;
grant execute on function rxm_private.rxm_role() to authenticated;
-- Account management must pass the server's checks, including last-admin protection.
revoke insert,update,delete on public.rxm_members from authenticated;
grant select,insert,update,delete on public.rxm_members to service_role;
-- The server can inspect identity columns, never Auth password hashes.
grant select(id,email,email_confirmed_at) on auth.users to service_role;

create function public.rxm_login_attempt(bucket_id text, attempt_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare hits integer;
begin
 if attempt_limit not between 1 and 200 then raise exception 'Invalid login limit'; end if;
 delete from public.rxm_login_limits where started_at<now()-interval '1 day';
 insert into public.rxm_login_limits(bucket,started_at,attempts) values(bucket_id,now(),1)
 on conflict(bucket) do update set
 attempts=case when rxm_login_limits.started_at<now()-interval '15 minutes' then 1 else rxm_login_limits.attempts+1 end,
 started_at=case when rxm_login_limits.started_at<now()-interval '15 minutes' then now() else rxm_login_limits.started_at end
 returning attempts into hits;
 return hits<=attempt_limit;
end $$;
create function public.rxm_consume_bootstrap(provided_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare consumed integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(724002);
 if exists(select 1 from public.rxm_accounts a join public.rxm_members m on m.email=a.login_email where m.role='owner' and a.active) then return false; end if;
 delete from public.rxm_auth_bootstrap where id=1 and token_hash=provided_hash and expires_at>now() returning id into consumed;
 return consumed is not null;
end $$;
create function public.rxm_existing_owner() returns table(user_id uuid,login_email text) language sql stable security invoker set search_path='' as $$
 select u.id,m.email from public.rxm_members m join auth.users u on lower(u.email)=m.email
 where m.role='owner' and u.email_confirmed_at is not null limit 1
$$;
create function public.rxm_register_account(account_id uuid,account_username text,account_name text,account_email text,account_salt text,account_role text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if account_role not in ('owner','editor','member') then raise exception 'Invalid account role'; end if;
 if not exists(select 1 from auth.users u where u.id=account_id and lower(u.email)=account_email and u.email_confirmed_at is not null) then raise exception 'Account identity mismatch'; end if;
 insert into public.rxm_members(email,role) values(account_email,account_role)
 on conflict(email) do update set role=excluded.role;
 insert into public.rxm_accounts(user_id,username,display_name,login_email,password_salt)
 values(account_id,account_username,account_name,account_email,account_salt);
end $$;
create function public.rxm_update_account(actor_id uuid,target_id uuid,account_name text,account_role text,account_active boolean) returns void language plpgsql security invoker set search_path='' as $$
declare target_email text; target_role text; target_active boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(724003);
 if not exists(select 1 from public.rxm_accounts a join public.rxm_members m on m.email=a.login_email where a.user_id=actor_id and a.active and m.role='owner') then raise exception 'Admin access required'; end if;
 if account_role not in ('owner','editor','member') then raise exception 'Invalid account role'; end if;
 select a.login_email,m.role,a.active into target_email,target_role,target_active from public.rxm_accounts a join public.rxm_members m on m.email=a.login_email where a.user_id=target_id;
 if target_email is null then raise exception 'User not found'; end if;
 if target_id=actor_id and (not account_active or account_role<>'owner') then raise exception 'You cannot remove your own admin access'; end if;
 if target_role='owner' and target_active and (not account_active or account_role<>'owner') and
 (select count(*) from public.rxm_accounts a join public.rxm_members m on m.email=a.login_email where a.active and m.role='owner')<=1 then raise exception 'Keep at least one active admin'; end if;
 update public.rxm_accounts set display_name=account_name,active=account_active,updated_at=now() where user_id=target_id;
 update public.rxm_members set role=account_role where email=target_email;
end $$;
revoke all on function public.rxm_login_attempt(text,integer),public.rxm_consume_bootstrap(text),public.rxm_existing_owner(),public.rxm_register_account(uuid,text,text,text,text,text),public.rxm_update_account(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.rxm_login_attempt(text,integer),public.rxm_consume_bootstrap(text),public.rxm_existing_owner(),public.rxm_register_account(uuid,text,text,text,text,text),public.rxm_update_account(uuid,uuid,text,text,boolean) to service_role;
commit;

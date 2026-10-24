-- Keep history listings small. Frozen email HTML remains in the original payload.
alter table public.rxm_batches add column summary jsonb;
create function rxm_private.summarize_batch(p jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
   'id',p->'id','createdAt',p->'createdAt','brand',p->'brand','generic',p->'generic',
   'month',p->'month','endMonth',p->'endMonth','period',p->'period','periodLabel',p->'periodLabel',
   'mailCount',count(*),'openedCount',count(*) filter(where m->>'status'='Opened'),
   'failedCount',count(*) filter(where m->>'status'='Failed'),
   'preparedCount',count(*) filter(where m->>'status'='Prepared')))
 from jsonb_array_elements(coalesce(p->'mails','[]'::jsonb)) m;
$$;
revoke all on function rxm_private.summarize_batch(jsonb) from public,anon;
grant execute on function rxm_private.summarize_batch(jsonb) to authenticated,service_role;
create function rxm_private.set_batch_summary() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.summary := rxm_private.summarize_batch(new.payload);
 return new;
end $$;
revoke all on function rxm_private.set_batch_summary() from public,anon;
create trigger rxm_batch_summary before insert or update of payload,summary on public.rxm_batches
for each row execute function rxm_private.set_batch_summary();
update public.rxm_batches set summary=rxm_private.summarize_batch(payload);
alter table public.rxm_batches alter column summary set not null;

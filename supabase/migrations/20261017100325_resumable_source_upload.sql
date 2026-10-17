-- Additive protocol: existing completed sources and older in-flight uploads
-- keep their current behavior. Only the new manifest protocol uses these RPCs.
alter table public.rxm_datasets add column upload_manifest jsonb;
alter table public.rxm_fact_chunks add column upload_part integer;
alter table public.rxm_fact_chunks add column upload_hash text;
alter table public.rxm_fact_chunks add column upload_records integer;
alter table public.rxm_fact_chunks add column upload_rx bigint;
create unique index rxm_chunks_upload_part on public.rxm_fact_chunks(dataset_id,upload_part);

-- New-protocol writes pass through the checked batch RPC. The existing Data
-- API insert path remains available only for legacy datasets.
drop policy rxm_chunks_insert on public.rxm_fact_chunks;
create policy rxm_chunks_insert on public.rxm_fact_chunks for insert to authenticated
with check ((select rxm_private.rxm_role()) in ('owner','editor') and exists(select 1 from public.rxm_datasets d where d.id=dataset_id and d.upload_manifest is null));
drop policy rxm_chunks_update on public.rxm_fact_chunks;
create policy rxm_chunks_update on public.rxm_fact_chunks for update to authenticated
using ((select rxm_private.rxm_role()) in ('owner','editor') and exists(select 1 from public.rxm_datasets d where d.id=dataset_id and d.upload_manifest is null))
with check ((select rxm_private.rxm_role()) in ('owner','editor') and exists(select 1 from public.rxm_datasets d where d.id=dataset_id and d.upload_manifest is null));

-- No INSERT/UPDATE grant is added for the manifest column. Only these private,
-- authenticated routines can register a manifest and write its checked chunks.
create function rxm_private.begin_upload(source jsonb, manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.rxm_datasets; n bigint; r bigint; x bigint;
begin
  if auth.uid() is null or rxm_private.rxm_role() is null or rxm_private.rxm_role() not in ('owner','editor') then raise exception 'Import access required'; end if;
  if jsonb_typeof(manifest->'parts') is distinct from 'array' or (manifest->>'version')::int is distinct from 1 or octet_length(manifest::text)>4000000 then raise exception 'Invalid upload manifest'; end if;
  n := jsonb_array_length(manifest->'parts');
  if n<1 or n>20000 then raise exception 'Invalid upload manifest size'; end if;
  select sum((p->>'records')::bigint),sum((p->>'rx')::bigint) into r,x from jsonb_array_elements(manifest->'parts') p;
  if r is null or x is null or r is distinct from (manifest->>'records')::bigint or x is distinct from (manifest->>'rx')::bigint or r<1 or x<r then raise exception 'Invalid upload totals'; end if;
  if exists(select 1 from jsonb_array_elements(manifest->'parts') with ordinality p(value,ord)
    where (value->>'part')::int is distinct from ord-1 or coalesce((value->>'records')::int,0) not between 1 and 1000
      or coalesce((value->>'rx')::bigint,0) < (value->>'records')::int or coalesce(value->>'hash','') !~ '^[0-9a-f]{64}$'
      or coalesce(value->>'month','') !~ '^\d{4}-\d{2}$' or coalesce(value->>'generic','')='') then raise exception 'Invalid upload part'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(source->>'hash',724101));
  select * into d from public.rxm_datasets where id=(source->>'id')::uuid;
  if found then
    if d.imported_by is distinct from auth.uid() then raise exception 'This upload belongs to another account'; end if;
    if d.upload_manifest is distinct from manifest or d.hash is distinct from source->>'hash' then raise exception 'The saved upload manifest does not match'; end if;
  else
    if exists(select 1 from public.rxm_datasets where hash=source->>'hash') then raise exception 'This file already has a saved or unfinished import. Check Source files before starting again.'; end if;
    insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,active,complete,payload,upload_manifest)
    values((source->>'id')::uuid,source->>'name',source->>'hash',(source->>'from')::date,(source->>'to')::date,(source->>'importedAt')::timestamptz,false,false,source,manifest)
    returning * into d;
  end if;
  return jsonb_build_object('complete',d.complete,'uploaded',coalesce((select jsonb_agg(jsonb_build_object('part',c.upload_part,'hash',c.upload_hash) order by c.upload_part) from public.rxm_fact_chunks c where c.dataset_id=d.id),'[]'::jsonb));
end $$;
revoke all on function rxm_private.begin_upload(jsonb,jsonb) from public,anon;
grant execute on function rxm_private.begin_upload(jsonb,jsonb) to authenticated;
create function public.rxm_begin_upload(source jsonb,manifest jsonb) returns jsonb language sql security invoker set search_path='' as $$select rxm_private.begin_upload(source,manifest)$$;
revoke all on function public.rxm_begin_upload(jsonb,jsonb) from public,anon;
grant execute on function public.rxm_begin_upload(jsonb,jsonb) to authenticated;

create function rxm_private.upload_batch(dataset uuid,parts jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare d public.rxm_datasets; p jsonb; expected jsonb; facts jsonb; part_no int; checksum text; records_count int; rx_count bigint; existing_hash text;
begin
  if auth.uid() is null or rxm_private.rxm_role() is null or rxm_private.rxm_role() not in ('owner','editor') then raise exception 'Import access required'; end if;
  select * into d from public.rxm_datasets where id=dataset;
  if not found or d.imported_by is distinct from auth.uid() or d.upload_manifest is null then raise exception 'Upload not found or access denied'; end if;
  if d.complete then raise exception 'This upload is already complete'; end if;
  if jsonb_typeof(parts) is distinct from 'array' or jsonb_array_length(parts) not between 1 and 64 or octet_length(parts::text)>1048576 then raise exception 'Upload request is too large'; end if;
  for p in select value from jsonb_array_elements(parts) loop
    part_no := (p->>'part')::int;
    if part_no is null or part_no<0 or part_no>=jsonb_array_length(d.upload_manifest->'parts') then raise exception 'Unexpected upload part'; end if;
    expected := d.upload_manifest->'parts'->part_no;
    facts := p->'payload';
    if jsonb_typeof(facts) is distinct from 'array' then raise exception 'Invalid prescription data'; end if;
    if octet_length(facts::text)>300000 then raise exception 'Upload part is too large'; end if;
    if exists(select 1 from jsonb_array_elements(facts) f where f - array['date','generic','brand','company','form','doctorCode','doctorName','specialty','acdRegion','acdMpe','acdAse','ccdRegion','ccdMpe','ccdAse','count','sourceRow','sourceRows','sheet'] <> '{}'::jsonb) then raise exception 'Unsupported prescription fields'; end if;
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_agg(jsonb_build_array(
      f->'date',f->'generic',f->'brand',f->'company',f->'form',f->'doctorCode',f->'doctorName',f->'specialty',
      f->'acdRegion',f->'acdMpe',f->'acdAse',f->'ccdRegion',f->'ccdMpe',f->'ccdAse',f->'count',f->'sourceRow',f->'sourceRows',f->'sheet') order by ord)::text,'UTF8')),'hex') into checksum
      from jsonb_array_elements(facts) with ordinality t(f,ord);
    if checksum is distinct from expected->>'hash' then raise exception 'Upload checksum mismatch'; end if;
    records_count := jsonb_array_length(facts);
    if exists(select 1 from jsonb_array_elements(facts) f where (f->>'count') is null or (f->>'count') !~ '^[1-9][0-9]*$'
      or upper(regexp_replace(btrim(f->>'generic'),'\s+',' ','g')) is distinct from expected->>'generic'
      or left(f->>'date',7) is distinct from expected->>'month') then raise exception 'Invalid market, month or prescription count'; end if;
    select sum((f->>'count')::bigint) into rx_count from jsonb_array_elements(facts) f;
    if records_count is distinct from (expected->>'records')::int or rx_count is distinct from (expected->>'rx')::bigint then raise exception 'Upload totals mismatch'; end if;
    insert into public.rxm_fact_chunks(dataset_id,month,generic,payload,upload_part,upload_hash,upload_records,upload_rx)
    values(dataset,expected->>'month',expected->>'generic',facts,part_no,checksum,records_count,rx_count)
    on conflict(dataset_id,upload_part) do nothing;
    select upload_hash into existing_hash from public.rxm_fact_chunks where dataset_id=dataset and upload_part=part_no;
    if existing_hash is distinct from checksum then raise exception 'Conflicting upload part'; end if;
  end loop;
end $$;
revoke all on function rxm_private.upload_batch(uuid,jsonb) from public,anon;
grant execute on function rxm_private.upload_batch(uuid,jsonb) to authenticated;
create function public.rxm_upload_batch(dataset uuid,parts jsonb) returns void language sql security invoker set search_path='' as $$select rxm_private.upload_batch(dataset,parts)$$;
revoke all on function public.rxm_upload_batch(uuid,jsonb) from public,anon;
grant execute on function public.rxm_upload_batch(uuid,jsonb) to authenticated;

-- This trigger also protects activation through the legacy finish RPC. Totals
-- were derived from actual JSON and checked against each checksum on upload.
create function rxm_private.verify_upload_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare manifest jsonb := old.upload_manifest;
begin
  if manifest is null or old.complete or not new.complete then return new; end if;
  if (select count(*) from public.rxm_fact_chunks where dataset_id=old.id) <> jsonb_array_length(manifest->'parts') then raise exception 'Upload is incomplete. Resume before activation.'; end if;
  if exists(select 1 from jsonb_array_elements(manifest->'parts') p left join public.rxm_fact_chunks c on c.dataset_id=old.id and c.upload_part=(p->>'part')::int
    where c.id is null or c.upload_hash is distinct from p->>'hash' or c.generic is distinct from p->>'generic' or c.month is distinct from p->>'month'
      or c.upload_records is distinct from (p->>'records')::int or c.upload_rx is distinct from (p->>'rx')::bigint) then raise exception 'Upload verification failed'; end if;
  return new;
end $$;
revoke all on function rxm_private.verify_upload_activation() from public,anon,authenticated;
create trigger rxm_verify_upload before update of complete on public.rxm_datasets for each row execute function rxm_private.verify_upload_activation();

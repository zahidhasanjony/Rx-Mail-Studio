import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('only admins can manage sources, hierarchy and catalogue, including definer RPCs; shared reporting reads and personal batches still work', async () => {
  const db = new PGlite();
  const owner='11111111-1111-4111-8111-111111111111', editor='22222222-2222-4222-8222-222222222222', member='33333333-3333-4333-8333-333333333333';
  const pending='66666666-6666-4666-8666-666666666666';
  const dataset='44444444-4444-4444-8444-444444444444', denied='55555555-5555-4555-8555-555555555555';
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
    for (const file of ['schema.sql','admin-reporting.sql','brand-catalogue.sql','migrations/20261017045737_brand_pair_deletion.sql','migrations/20261017100325_resumable_source_upload.sql','migrations/20261024173658_admin_management_access.sql']) await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.com',now()),('${editor}','editor@example.com',now()),('${member}','member@example.com',now());insert into public.rxm_members(email,role) values('editor@example.com','editor'),('member@example.com','member');`);
    const identity = async(id:string,email:string) => { await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);select set_config('request.jwt.claim.email','${email}',false);set role authenticated;`); };
    await identity(owner,'owner@example.com');
    await db.exec(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,payload) values('${dataset}','Admin source','admin','2026-07-01','2026-07-31',now(),'{}');insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values('${dataset}','2026-07','TEST','[{"count":1}]');select public.rxm_finish_import('${dataset}');insert into public.rxm_hierarchies values('${dataset}','2026-07-01',now(),'{}');`);
    await db.exec(`reset role;insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,imported_by,payload) values('${pending}','Old editor upload','pending','2026-08-01','2026-08-31',now(),'${editor}','{}');insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values('${pending}','2026-08','TEST','[{"count":1}]');set role authenticated;`);
    const source={id:denied,name:'Blocked',hash:'blocked',from:'2026-08-01',to:'2026-08-31',importedAt:new Date().toISOString()};
    const manifest={version:1,records:1,rx:1,parts:[{part:0,hash:'a'.repeat(64),generic:'TEST',month:'2026-08',records:1,rx:1,bytes:20}]};
    for (const [id,email] of [[editor,'editor@example.com'],[member,'member@example.com']]) {
      await identity(id,email);
      for (const table of ['rxm_datasets','rxm_hierarchies','rxm_profiles','rxm_fact_chunks']) assert.ok((await db.query(`select * from public.${table}`)).rows.length,table+' reporting data remains readable');
      await assert.rejects(db.query(`insert into public.rxm_profiles values('blocked','{}')`),/row-level security|Admin access required/);
      await assert.rejects(db.query(`insert into public.rxm_hierarchies values('${denied}','2026-08-01',now(),'{}')`),/row-level security|Admin access required/);
      await assert.rejects(db.query(`select public.rxm_add_brand_profiles($1)`,[JSON.stringify([{brand:'BLOCKED',generic:'Test',company:'BEXIMCO',forms:['TAB']}])]),/Admin access required|Brand editing access required/);
      await assert.rejects(db.query(`select public.rxm_begin_upload($1,$2)`,[JSON.stringify(source),JSON.stringify(manifest)]),/Admin access required|Import access required/);
      await assert.rejects(db.query(`select public.rxm_finish_import('${pending}')`),/Admin access required|Import access required|access denied/);
      for (const table of ['rxm_datasets','rxm_hierarchies','rxm_profiles']) assert.equal((await db.query(`update public.${table} set payload='{}' returning id`)).rows.length,0,'non-admin updates are blocked');
      await db.exec(`insert into public.rxm_batches values('${id}','${id}',now(),'{}');`);
      assert.equal((await db.query('select * from public.rxm_batches')).rows.length,1,'personal mail history still works');
    }
    await identity(owner,'owner@example.com');
    assert.equal((await db.query<{added:number}>(`select public.rxm_add_brand_profiles('[{"brand":"ADMINBRAND","generic":"Test","company":"BEXIMCO","forms":["TAB"]}]') as added`)).rows[0].added,1);
    assert.equal((await db.query(`select * from public.rxm_datasets where id='${denied}'`)).rows.length,0,'blocked RPC leaves no partial source');
  } finally { await db.close(); }
});

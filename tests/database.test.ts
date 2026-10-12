import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Postgres schema enforces verified team membership, private settings and overlap replacement", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$; grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid(),auth.jwt() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL("../supabase/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(await readFile(new URL("../supabase/username-auth.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/admin-reporting.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/brand-catalogue.sql", import.meta.url), "utf8"));
    const owner = "11111111-1111-4111-8111-111111111111",
      member = "22222222-2222-4222-8222-222222222222",
      outsider = "33333333-3333-4333-8333-333333333333";
    await db.exec(
      `insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.com',now()),('${member}','team@example.com',now()),('${outsider}','other@example.com',now()); insert into public.rxm_members values('team@example.com','member',now());`,
    );
    await db.exec(`insert into public.rxm_accounts(user_id,username,display_name,login_email,password_salt) values('${owner}','ADMIN','Owner','owner@example.com',repeat('a',64)),('${member}','MEMBER','Team member','team@example.com',repeat('b',64));`);
    const identity = async (id: string, email: string) => {
      await db.exec(
        `reset role; select set_config('request.jwt.claim.sub','${id}',false);select set_config('request.jwt.claim.email','${email}',false);set role authenticated;`,
      );
    };
    await identity(owner, "owner@example.com");
    assert.equal(
      (await db.query(`select * from public.rxm_members`)).rows.length,
      2,
    );
    await db.exec(
      `insert into public.rxm_settings values('${owner}','{"name":"Owner"}');`,
    );
    await db.exec(
      `insert into public.rxm_user_templates values('owner@example.com','{"name":"Owner","personalCc":[{"email":"boss@example.com"}]}');`,
    );
    assert.equal(
      (await db.query("select * from public.rxm_user_templates")).rows.length,
      1,
    );
    const first = "44444444-4444-4444-8444-444444444444",
      second = "55555555-5555-4555-8555-555555555555";
    for (const id of [first, second])
      await db.exec(
        `insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,payload) values('${id}','Test','${id}','2026-06-01','2026-06-30',now(),'{}');insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values('${id}','2026-06','KETOTIFEN','[{"count":1}]');`,
      );
    const oldTofen = (await db.query<{ payload: unknown }>("select payload from public.rxm_profiles where id='tofen'")).rows[0].payload;
    await db.query(`update public.rxm_datasets set payload=$1 where id='${first}'`,[JSON.stringify({ catalog: [
      { id:"discovered", brand:"NEWBEX", generic:"Example", company:"Beximco Pharmaceuticals PLC", forms:["TAB"] },
      { id:"source-tofen", brand:"TOFEN", generic:"Ketotifen", company:"BEXIMCO", forms:["EYE DROP"] },
      { id:"competitor", brand:"FENAT", generic:"Ketotifen", company:"Competitor", forms:["TAB"] },
    ] })]);
    await db.query(`select public.rxm_finish_import('${first}')`);
    await assert.rejects(
      db.query(`select public.rxm_finish_import('${second}')`),
      /overlaps/,
    );
    await db.query(
      `select public.rxm_finish_import('${second}',array['${first}'::uuid])`,
    );
    assert.equal(
      (
        await db.query<{ id: string }>(
          `select id from public.rxm_datasets where active`,
        )
      ).rows[0].id,
      second,
    );
    assert.equal((await db.query("select * from public.rxm_profiles where payload->>'brand'='NEWBEX'")).rows.length,1,"Successful imports automatically add new Beximco pairs");
    assert.equal((await db.query("select * from public.rxm_profiles where payload->>'brand'='FENAT'")).rows.length,0,"Competitor pairs are excluded");
    assert.deepEqual((await db.query<{ payload: unknown }>("select payload from public.rxm_profiles where id='tofen'")).rows[0].payload,oldTofen);
    await db.query(`update public.rxm_datasets set payload=$1 where id='${second}'`,[JSON.stringify({ catalog:[{ id:"later",brand:"LATERBEX",generic:"New generic",company:"BEXIMCO",forms:["SYP"] }] })]);
    assert.equal((await db.query<{ added: number }>("select public.rxm_refresh_catalogue() as added")).rows[0].added,1);
    assert.equal((await db.query<{ added: number }>("select public.rxm_refresh_catalogue() as added")).rows[0].added,0,"Manual refresh is idempotent");
    await db.query("select public.rxm_add_brand_profiles($1)",[JSON.stringify([{id:"same-pair-other-id",brand:" laterbex ",generic:"new  generic",forms:["TAB"]}])]);
    assert.equal((await db.query("select * from public.rxm_profiles where id='same-pair-other-id'")).rows.length,0,"Normalized duplicates never overwrite existing definitions");
    assert.deepEqual((await db.query<{ payload: unknown }>("select payload from public.rxm_profiles where id='later'")).rows[0].payload,{id:"later",brand:"LATERBEX",generic:"New generic",company:"BEXIMCO",forms:["SYP"]});
    const hierarchy = "66666666-6666-4666-8666-666666666666";
    await db.exec(`insert into public.rxm_hierarchies(id,effective_from,created_at,payload) values('${hierarchy}','2026-01-01',now(),'{"name":"Test hierarchy"}');insert into public.rxm_batches values('99999999-9999-4999-8999-999999999999','${owner}',now(),'{"sourceIds":["${first}"],"mails":[{"html":"Frozen"}]}')`);
    assert.equal((await db.query<{ result: { name: string } }>(`select public.rxm_export_hierarchy('${hierarchy}') as result`)).rows[0].result.name, "Test hierarchy");
    const editor = "77777777-7777-4777-8777-777777777777";
    await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${editor}','editor@example.com',now());insert into public.rxm_members values('editor@example.com','editor',now());insert into public.rxm_accounts(user_id,username,display_name,login_email,password_salt) values('${editor}','EDITOR','Editor','editor@example.com',repeat('e',64))`);
    await identity(editor,"editor@example.com");
    await assert.rejects(db.query("select public.rxm_refresh_catalogue()"),/Admin access required/);
    await assert.rejects(db.query("select rxm_private.add_profiles('[]')"),/permission denied/);
    assert.equal((await db.query(`delete from public.rxm_datasets where id='${second}' returning id`)).rows.length,0,"Editors cannot delete library sources");
    assert.equal((await db.query(`delete from public.rxm_fact_chunks where dataset_id='${second}' returning id`)).rows.length,0,"Editors cannot delete completed source chunks");
    await assert.rejects(db.exec(`update public.rxm_datasets set complete=false where id='${second}'`),/permission denied/);
    await assert.rejects(db.query(`select public.rxm_export_hierarchy('${hierarchy}')`),/Admin access required/);
    await assert.rejects(db.exec(`insert into public.rxm_hierarchies(id,effective_from,created_at,payload) values('88888888-8888-4888-8888-888888888888','2026-01-01',now(),'{}')`),/row-level security/);
    assert.equal((await db.query(`update public.rxm_workspace_defaults set payload='{"subject":"Editor","opening":"Text","body":"Text"}' where id='email' returning id`)).rows.length,0);
    const failed = "88888888-8888-4888-8888-888888888888";
    await db.exec(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,payload) values('${failed}','Failed','failed','2026-08-01','2026-08-10',now(),'{}')`);
    await db.query(`select public.rxm_cleanup_import('${second}')`);
    assert.equal((await db.query(`select id from public.rxm_datasets where id='${second}'`)).rows.length,1,"Cleanup cannot remove completed imports");
    await db.query(`select public.rxm_cleanup_import('${failed}')`);
    assert.equal((await db.query(`select id from public.rxm_datasets where id='${failed}'`)).rows.length,0,"Editors can recover their own failed uploads");
    await db.exec(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,payload) values('${failed}','Retry','retry','2026-08-01','2026-08-10',now(),'{}');insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values('${failed}','2026-08','KETOTIFEN','[{"count":1}]')`);
    await db.query(`select public.rxm_finish_import('${failed}')`);
    assert.equal((await db.query<{ complete: boolean }>(`select complete from public.rxm_datasets where id='${failed}'`)).rows[0].complete,true,"Editors can still complete imports");
    await identity(owner,"owner@example.com");
    await db.exec(`update public.rxm_workspace_defaults set payload='{"subject":"Team default","opening":"Text","body":"Text"}' where id='email';delete from public.rxm_datasets where id='${first}';delete from public.rxm_datasets where id='${failed}'`);
    assert.equal((await db.query(`select * from public.rxm_batches`)).rows.length,1,"Source deletion preserves frozen history");
    assert.equal((await db.query(`select * from public.rxm_fact_chunks where dataset_id='${first}'`)).rows.length,0,"Deleting metadata removes its chunks");
    await identity(member, "team@example.com");
    await assert.rejects(db.query("select public.rxm_refresh_catalogue()"),/Admin access required/);
    await assert.rejects(db.query("select public.rxm_add_brand_profiles('[]')"),/Brand editing access required/);
    assert.equal((await db.query<{ payload: { subject: string } }>("select payload from public.rxm_workspace_defaults")).rows[0].payload.subject,"Team default");
    await assert.rejects(db.query(`select public.rxm_export_hierarchy('${hierarchy}')`),/Admin access required/);
    assert.equal((await db.query(`delete from public.rxm_datasets where id='${second}' returning id`)).rows.length,0);
    assert.equal(
      (await db.query("select * from public.rxm_user_templates")).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(
        `insert into public.rxm_user_templates values('team@example.com','{}')`,
      ),
      /row-level security/,
    );
    assert.equal(
      (await db.query("select * from public.rxm_settings")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.rxm_datasets")).rows.length,
      1,
    );
    await assert.rejects(
      db.exec(
        `insert into public.rxm_members values('hacker@example.com','owner',now())`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.exec(`insert into public.rxm_settings values('${owner}','{}')`),
      /row-level security/,
    );
    await assert.rejects(db.query("select * from public.rxm_accounts"), /permission denied/);
    await assert.rejects(db.query("select public.rxm_login_attempt(repeat('a',64),10)"), /permission denied/);
    await db.exec(`reset role;update public.rxm_accounts set active=false where user_id='${member}'`);
    await identity(member, "team@example.com");
    assert.equal((await db.query("select * from public.rxm_datasets")).rows.length, 0, "Disabled users lose access with their existing token");
    await db.exec("reset role;set role service_role");
    await assert.rejects(db.query(`select public.rxm_update_account('${owner}','${owner}','Owner','member',true)`), /own admin access/);
    await assert.rejects(db.query(`select public.rxm_update_account('${member}','${owner}','Owner','member',true)`), /Admin access required/);
    assert.equal((await db.query("select * from public.rxm_existing_owner()")).rows.length, 1);
    await assert.rejects(db.query("select encrypted_password from auth.users"), /does not exist|permission denied/);
    for (let i = 1; i <= 11; i++) {
      assert.equal((await db.query<{allowed:boolean}>("select public.rxm_login_attempt(repeat('c',64),10) as allowed")).rows[0].allowed, i <= 10);
    }
    await db.exec("update public.rxm_login_limits set started_at=now()-interval '16 minutes'");
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_login_attempt(repeat('c',64),10) as allowed")).rows[0].allowed, true);
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_consume_bootstrap(repeat('d',64)) as allowed")).rows[0].allowed, false, "An active admin prevents bootstrap");
    await db.exec("update public.rxm_accounts set active=false where username='ADMIN';insert into public.rxm_auth_bootstrap values(1,repeat('d',64),now()-interval '1 minute')");
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_consume_bootstrap(repeat('d',64)) as allowed")).rows[0].allowed, false, "Expired bootstrap tokens fail");
    await db.exec("update public.rxm_auth_bootstrap set expires_at=now()+interval '15 minutes'");
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_consume_bootstrap(repeat('e',64)) as allowed")).rows[0].allowed, false);
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_consume_bootstrap(repeat('d',64)) as allowed")).rows[0].allowed, true);
    assert.equal((await db.query<{allowed:boolean}>("select public.rxm_consume_bootstrap(repeat('d',64)) as allowed")).rows[0].allowed, false, "Bootstrap tokens can be used only once");
    await db.exec("update public.rxm_accounts set active=true where username='ADMIN'");
    await identity(outsider, "other@example.com");
    assert.equal(
      (await db.query("select * from public.rxm_datasets")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from public.rxm_user_templates"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.rxm_datasets"),
      /permission denied/,
    );
    await db.exec(
      `reset role;update auth.users set email_confirmed_at=null where id='${owner}'`,
    );
    await identity(owner, "owner@example.com");
    assert.equal(
      (await db.query("select * from public.rxm_datasets")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

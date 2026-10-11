import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Postgres schema enforces verified team membership, private settings and overlap replacement", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$; grant usage on schema auth to authenticated; grant execute on function auth.uid(),auth.jwt() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL("../supabase/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    const owner = "11111111-1111-4111-8111-111111111111",
      member = "22222222-2222-4222-8222-222222222222",
      outsider = "33333333-3333-4333-8333-333333333333";
    await db.exec(
      `insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.com',now()),('${member}','team@example.com',now()),('${outsider}','other@example.com',now()); insert into public.rxm_members values('team@example.com','member',now());`,
    );
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
    await identity(member, "team@example.com");
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
      2,
    );
    await assert.rejects(
      db.exec(
        `insert into public.rxm_members values('hacker@example.com','owner',now())`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.exec(`insert into public.rxm_settings values('${owner}','{}')`),
      /row-level security/,
    );
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

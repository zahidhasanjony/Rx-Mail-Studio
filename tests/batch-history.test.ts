import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { summarizeBatch } from '../src/batch-history';
import type { Batch } from '../src/types';
test('history summaries count statuses without including email bodies', () => {
  const batch = { id: 'b', createdAt: '2026-06-01', month: '2026-06', brand: 'TOFEN', generic: 'Ketotifen', mails: [
    { status: 'Opened', html: 'private frozen body' }, { status: 'Failed' }, { status: 'Prepared' }, { status: 'Prepared' },
  ] } as Batch;
  const summary = summarizeBatch(batch);
  assert.equal(summary.mailCount, 4); assert.equal(summary.openedCount, 1);
  assert.equal(summary.failedCount, 1); assert.equal(summary.preparedCount, 2);
  assert.ok(!JSON.stringify(summary).includes('private frozen body'));
});
test('Postgres backfills small history summaries, preserves original payloads and enforces user isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema rxm_private; grant usage on schema auth,rxm_private to authenticated; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create table public.rxm_batches(id uuid primary key,user_id uuid not null,created_at timestamptz not null,payload jsonb not null); alter table public.rxm_batches enable row level security; grant select,insert,update,delete on rxm_batches to authenticated; create policy own on rxm_batches for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));`);
    const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
    const payload = { id, createdAt: '2026-06-01T00:00:00Z', brand: 'TOFEN', generic: 'Ketotifen', month: '2026-06', mails: [{ status: 'Prepared', html: 'Frozen original content'.repeat(10000) }, { status: 'Opened', html: 'Unchanged email' }] };
    await db.query('insert into rxm_batches values($1,$2,now(),$3)', [id, owner, JSON.stringify(payload)]);
    await db.exec(await readFile(new URL('../supabase/migrations/20261024151858_batch_history_summaries.sql', import.meta.url), 'utf8'));
    let row = (await db.query<{ summary: Record<string, unknown>; payload: unknown }>('select summary,payload from rxm_batches')).rows[0];
    assert.deepEqual(row.payload, payload); assert.equal(row.summary.mailCount, 2); assert.equal(row.summary.openedCount, 1); assert.equal(row.summary.preparedCount, 1);
    assert.ok(JSON.stringify(row.summary).length < 400);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated`);
    payload.mails[0].status = 'Failed';
    await db.query('update rxm_batches set payload=$1 where id=$2', [JSON.stringify(payload), id]);
    row = (await db.query<{ summary: Record<string, unknown>; payload: unknown }>('select summary,payload from rxm_batches')).rows[0];
    assert.equal(row.summary.failedCount, 1); assert.equal(row.summary.preparedCount, 0); assert.deepEqual(row.payload, payload);
    await db.exec(`update rxm_batches set summary='{"mailCount":999}';`);
    assert.equal((await db.query<{ summary: { mailCount: number } }>('select summary from rxm_batches')).rows[0].summary.mailCount, 2, 'Summary is always derived from the frozen payload');
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated`);
    assert.equal((await db.query('select id,summary from rxm_batches')).rows.length, 0);
    assert.equal((await db.query('select payload from rxm_batches where id=$1', [id])).rows.length, 0);
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select id,summary from rxm_batches'), /permission denied/);
  } finally { await db.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { dashboardData, dashboardGroups, dashboardBrands, dashboardTotals, therapeuticGroupKey } from '../src/dashboard-model';
import type { Dataset } from '../src/types';

test('dashboard shares use summed occurrence counts, preserve all competitors and use each brand generic denominator', () => {
  const rows = [
    { tg: 'ANTI-ALLERGY', generic: 'Ketotifen', brand: 'TOFEN', company: 'BEXIMCO', rx: 10 },
    { tg: 'ANTI-ALLERGY', generic: 'Ketotifen', brand: 'Other', company: 'OTHER', rx: 30 },
    { tg: 'ANTI-ALLERGY', generic: 'Bilastine', brand: 'BILLI', company: 'Beximco Pharmaceuticals', rx: 20 },
    { tg: 'ANTI-ALLERGY', generic: 'Bilastine', brand: 'Other', company: 'OTHER', rx: 140 },
    { tg: 'Unclassified', generic: 'Unknown', brand: 'U', company: 'OTHER', rx: 50 },
    { tg: 'Unclassified', generic: 'Ketotifen', brand: 'Unknown TG competitor', company: 'OTHER', rx: 10 },
  ];
  assert.deepEqual(dashboardTotals(rows), { own: 30, market: 260, share: 30 / 260 * 100 });
  assert.equal(dashboardGroups(rows).find(g => g.name === 'ANTI-ALLERGY')!.share, 15);
  const brands = dashboardBrands(rows, 'ANTI-ALLERGY');
  assert.equal(brands.find(b => b.name === 'TOFEN')!.share, 20);
  assert.equal(brands.find(b => b.name === 'BILLI')!.share, 12.5);
  assert.equal(dashboardTotals([]).share, null);
  const fact = { date: '2026-06-01', generic: 'Ketotifen', brand: 'TOFEN', company: 'BEXIMCO', count: 7 };
  const ds = { id: 'a', active: true, from: '2026-06-01', to: '2026-06-30', facts: [fact], therapeuticGroups: { [therapeuticGroupKey('Ketotifen', 'TOFEN', 'BEXIMCO')]: 'ANTI-ALLERGY' } } as Dataset;
  assert.equal(dashboardData([ds, { ...ds, id: 'inactive', active: false }], '2026-06', '2026-06').rows[0].rx, 7);
  assert.equal(dashboardData([{ ...ds, includedGenerics: ['Ketotifen'] }], '2026-06', '2026-06').limited, true, 'Legacy selected-market imports cannot claim full market coverage');
  assert.throws(() => dashboardData([ds, { ...ds, id: 'b' }], '2026-06', '2026-06'), /overlap/);
});

test('Postgres dashboard caches verified payload counts, protects summaries and respects roles, activation and scope', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
    const migrations = await readdir(new URL('../supabase/migrations/', import.meta.url));
    for (const file of ['schema.sql', 'admin-reporting.sql', 'brand-catalogue.sql', ...migrations.sort().map(f => 'migrations/' + f)]) await db.exec(await readFile(new URL('../supabase/' + file, import.meta.url), 'utf8'));
    const user = '11111111-1111-4111-8111-111111111111', june = '22222222-2222-4222-8222-222222222222', july = '33333333-3333-4333-8333-333333333333';
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${user}','owner@example.com',now());select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.email','owner@example.com',false);`);
    for (const [id, month] of [[june, '06'], [july, '07']]) {
      const meta = JSON.stringify({ therapeuticGroups: { [therapeuticGroupKey('Ketotifen', 'TOFEN', 'BEXIMCO')]: 'ANTI-ALLERGY' } });
      await db.query(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,complete,active,payload) values($1::uuid,$1::text,$1::text,$2::date,$3::date,now(),true,true,$4::jsonb)`, [id, '2026-' + month + '-01', '2026-' + month + '-30', meta]);
      await db.query(`insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values($1,$2,'KETOTIFEN',$3::jsonb)`, [id, '2026-' + month, JSON.stringify([{ brand: 'TOFEN', company: 'BEXIMCO', count: month === '06' ? 10 : 20, doctorCode: 'private' }, { brand: 'OTHER', company: 'OTHER', count: 30 }])]);
    }
    await db.query('insert into public.rxm_dashboard_taxonomy values($1,$2)', [therapeuticGroupKey('Ketotifen', 'OTHER', 'OTHER'), 'ANTI-ALLERGY']);
    await db.exec('set role authenticated');
    const call = async (from = '2026-06', to = '2026-07') => (await db.query<{data: [string,string,string,string,number][]}>('select public.rxm_dashboard($1,$2) data', [from, to])).rows[0].data;
    const rows = await call();
    assert.equal(rows.reduce((n,r) => n + Number(r[4]), 0), 90);
    assert.ok(rows.every(r => r[0] === 'ANTI-ALLERGY'));
    assert.ok(!JSON.stringify(rows).includes('private'));
    assert.equal((await call('2026-06','2026-06')).reduce((n,r)=>n+Number(r[4]),0),40);
    await assert.rejects(db.exec(`update public.rxm_fact_chunks set dashboard_summary='[]'`), /permission denied/);
    await assert.rejects(db.exec(`insert into public.rxm_dashboard_taxonomy values('forged','TG')`), /permission denied/);
    await assert.rejects(call('2026-08', '2026-06'), /valid month/);
    await db.exec(`reset role;update public.rxm_datasets set active=false where id='${july}';set role authenticated`);
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),40);
    await db.exec(`reset role;update public.rxm_fact_chunks set payload='[{"brand":"TOFEN","company":"BEXIMCO","count":5}]' where dataset_id='${june}';set role authenticated`);
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),5,'payload replacement refreshes the cache');
    await db.exec('reset role;set role anon');
    await assert.rejects(call(),/permission denied/);
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claim.email','',false);set role authenticated`);
    await assert.rejects(call(),/access required/);
  } finally { await db.close(); }
});

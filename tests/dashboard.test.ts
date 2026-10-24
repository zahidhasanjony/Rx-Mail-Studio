import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { dashboardData, dashboardGroups, dashboardBrands, dashboardTotals, therapeuticGroupKey, mappedDashboardRows, dashboardCompetitors } from '../src/dashboard-model';
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
  const mapped = mappedDashboardRows(rows, { [therapeuticGroupKey('Ketotifen', 'TOFEN', 'BEXIMCO')]: 'ANALGESIC' });
  assert.equal(mapped[0].tg, 'ANALGESIC');
  assert.deepEqual(dashboardTotals(mapped), dashboardTotals(rows));
  assert.equal(mapped[1].tg, rows[1].tg, 'Another brand/company in the generic is unchanged');
  assert.equal(rows[0].tg, 'ANTI-ALLERGY', 'Source classifications are not modified');
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
    await db.exec(`reset role;insert into public.rxm_dashboard_taxonomy(key,tg) values('test-analgesic','ANALGESIC');set role authenticated`);
    const assign = async (tg: string) => db.query('select public.rxm_assign_dashboard_tg($1,$2,array[$3]::text[],$4)', [' ketotifen ', ' tofen ', ' Beximco ', tg]);
    await assign(' analgesic ');
    assert.equal((await call()).find(r => r[2] === 'TOFEN')![0], 'ANALGESIC', 'Manual TG overrides raw source TG across both months');
    assert.equal((await call('2026-06','2026-06')).find(r => r[2] === 'TOFEN')![0], 'ANALGESIC');
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),90,'Assignment does not change Rx totals');
    assert.equal((await call()).find(r=>r[2]==='OTHER')![0],'ANTI-ALLERGY','Only the named brand moves');
    await assert.rejects(assign('NOT A REAL TG'),/Select a TG/);
    await assert.rejects(db.exec(`insert into public.rxm_dashboard_tg_overrides(key,tg) values('G'||chr(31)||'B'||chr(31)||'C','MADE UP')`),/row-level security/);
    await assert.rejects(db.query('select public.rxm_assign_dashboard_tg($1,$2,array[$3,$4]::text[],$5)', ['Ketotifen','TOFEN','FIRST COMPANY','','ANALGESIC']),/company selection/);
    assert.equal((await db.query<{n:number}>('select count(*)::int n from public.rxm_dashboard_tg_overrides')).rows[0].n,1,'A failed multi-company save rolls back every change');
    await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('44444444-4444-4444-8444-444444444444','editor@example.com',now()),('55555555-5555-4555-8555-555555555555','member@example.com',now());insert into public.rxm_members(email,role) values('editor@example.com','editor'),('member@example.com','member');select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);select set_config('request.jwt.claim.email','editor@example.com',false);set role authenticated`);
    await assign('ANTI-ALLERGY');
    assert.equal((await db.query<{id:string}>('select updated_by::text id from public.rxm_dashboard_tg_overrides')).rows[0].id,'44444444-4444-4444-8444-444444444444');
    await db.exec(`select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);select set_config('request.jwt.claim.email','member@example.com',false);`);
    assert.equal((await call()).find(r=>r[2]==='TOFEN')![0],'ANTI-ALLERGY','Members see saved mappings');
    await assert.rejects(assign('ANALGESIC'),/Admin or Editor/);
    await assert.rejects(db.exec(`insert into public.rxm_dashboard_tg_overrides(key,tg) values('G'||chr(31)||'B'||chr(31)||'C','ANALGESIC')`),/row-level security/);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.email','owner@example.com',false);`);
    await assert.rejects(db.exec(`update public.rxm_fact_chunks set dashboard_summary='[]'`), /permission denied/);
    await assert.rejects(db.exec(`insert into public.rxm_dashboard_taxonomy values('forged','TG')`), /permission denied/);
    await assert.rejects(call('2026-08', '2026-06'), /valid month/);
    await db.exec(`reset role;update public.rxm_datasets set active=false where id='${july}';set role authenticated`);
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),40);
    await db.exec(`reset role;update public.rxm_fact_chunks set payload='[{"brand":"TOFEN","company":"BEXIMCO","count":5}]' where dataset_id='${june}';set role authenticated`);
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),5,'payload replacement refreshes the cache');
    await db.exec('reset role;set role anon');
    await assert.rejects(call(),/permission denied/);
    await assert.rejects(assign('ANALGESIC'),/permission denied/);
    await assert.rejects(db.exec('select public.rxm_dashboard_tg_options()'),/permission denied/);
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claim.email','',false);set role authenticated`);
    await assert.rejects(call(),/access required/);
  } finally { await db.close(); }
});


test('competitor ranking includes the whole generic market, merges normalized brand/company pairs and retains distinct companies', () => {
  const rows = [
    { tg: 'ANTI-ALLERGY', generic: 'Bilastine', brand: 'BILLI', company: 'BEXIMCO', rx: 10 },
    { tg: 'Unclassified', generic: ' bilastine ', brand: ' billi ', company: ' beximco ', rx: 5 },
    { tg: 'OTHER TG', generic: 'BILASTINE', brand: 'BIL-B', company: 'Company B', rx: 30 },
    { tg: 'Unclassified', generic: 'Bilastine', brand: 'BIL-B', company: 'Company C', rx: 5 },
    { tg: 'ANTI-ALLERGY', generic: 'Bilastine + Other', brand: 'COMBINATION', company: 'Company B', rx: 500 },
    { tg: 'ANTI-ALLERGY', generic: 'Ketotifen', brand: 'BILLI', company: 'BEXIMCO', rx: 50 },
  ];
  const original = structuredClone(rows);
  const market = dashboardCompetitors(rows, ' Bilastine ');
  assert.equal(market.market, 50);
  assert.deepEqual(market.brands.map(b => [b.name, b.company, b.rx, b.share]), [
    ['BIL-B', 'Company B', 30, 60], ['BILLI', 'BEXIMCO', 15, 30], ['BIL-B', 'Company C', 5, 10],
  ]);
  assert.equal(market.brands.reduce((sum, b) => sum + b.share!, 0), 100);
  assert.equal(market.brands.filter(b => b.beximco).length, 1);
  assert.deepEqual(rows, original);
  assert.deepEqual(dashboardCompetitors(rows, 'Missing'), { market: 0, brands: [] });
  assert.equal(dashboardCompetitors([{ ...rows[0], rx: 0 }], 'Bilastine').brands[0].share, null);
});

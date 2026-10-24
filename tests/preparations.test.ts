import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizePreparation, preparationMarket, preparationKey } from '../src/preparations';
import { dashboardData, dashboardBrands, dashboardCompetitors, dashboardTotals, mappedDashboardRows, therapeuticGroupKey } from '../src/dashboard-model';
import type { Dataset, RxFact } from '../src/types';

const formFacts = [
  ['Ketotifen','TOFEN','BEXIMCO','TAB',10,'ALLERGIC DISORDER'],
  ['Ketotifen','TOFEN','BEXIMCO','SYP',20,'ALLERGIC DISORDER'],
  ['Ketotifen','TOFEN','BEXIMCO','EYE DROP',5,'OPHTHALMIC'],
  ['Ketotifen','OTHER ORAL','OTHER','SYP',40,'Unclassified'],
  ['Ketotifen','OTHER EYE','OTHER','EYE DROP',15,'OPHTHALMIC'],
  ['Ciprofloxacin','NEOFLOXIN','BEXIMCO','TAB',7,'ANTI-INFECTIVES'],
  ['Ciprofloxacin','NEOFLOXIN','BEXIMCO','EYE DROP',3,'OPHTHALMIC'],
  ['Ciprofloxacin','NEOFLOXIN','BEXIMCO','EAR DROP',2,'OPHTHALMIC'],
  ['Ciprofloxacin','NEOFLOXIN','BEXIMCO','IV INF',4,'ANTI-INFECTIVES'],
] as const;
const groups = Object.fromEntries(formFacts.map(([g,b,c,f,,tg]) => [preparationKey(g,b,c,f),tg]));
const source = () => ({ id:'june',name:'fixture',active:true,from:'2026-06-01',to:'2026-06-30',classificationVersion:2,preparationGroups:groups,
  therapeuticGroups:{[therapeuticGroupKey('Ketotifen','TOFEN','BEXIMCO')]:'ALLERGIC DISORDER'},
  facts: formFacts.map(([generic,brand,company,form,count])=>({generic,brand,company,form,count,date:'2026-06-01'} as RxFact)) } as Dataset);

test('preparation classification preserves routes, exact source TG and generic-market denominators', () => {
  const ds=source(), rows=dashboardData([ds],'2026-06','2026-06').rows;
  assert.equal(dashboardTotals(rows).market,106);
  const oral=dashboardBrands(rows,'ALLERGIC DISORDER');
  assert.equal(oral.length,1);assert.equal(oral[0].own,30);assert.equal(oral[0].market,70);
  assert.deepEqual(oral[0].forms,['TAB','SYP']);
  const ophthalmic=dashboardBrands(rows,'OPHTHALMIC');
  assert.equal(ophthalmic.find(b=>b.name==='TOFEN')!.own,5);
  assert.equal(ophthalmic.filter(b=>b.name==='NEOFLOXIN').length,2,'Ear and eye stay separate even when their source TG is the same');
  const eye=dashboardCompetitors(rows,'Ketotifen','EYE');
  assert.equal(eye.market,20);assert.equal(eye.brands.find(b=>b.name==='TOFEN')!.share,25);
  assert.ok(eye.brands.every(b=>b.forms.every(f=>f==='EYE DROP')));
  assert.equal(dashboardCompetitors(rows,'Ketotifen','ORAL').market,70,'Unclassified oral competitors stay in the oral denominator');
  const assigned=mappedDashboardRows(rows,{[preparationKey('Ketotifen','TOFEN','BEXIMCO','EYE DROP')]:'TEST TG'},[ds]);
  assert.equal(assigned.find(r=>r.brand==='TOFEN'&&r.form==='TAB')!.tg,'ALLERGIC DISORDER');
  assert.equal(assigned.find(r=>r.brand==='TOFEN'&&r.form==='EYE DROP')!.tg,'TEST TG');
  assert.deepEqual(dashboardTotals(assigned),dashboardTotals(rows));
  const legacy={ [therapeuticGroupKey('Ketotifen','TOFEN','BEXIMCO')]:'WRONG GLOBAL TG' };
  const oralOnly=rows.filter(r=>r.form==='TAB');
  assert.equal(mappedDashboardRows(oralOnly,legacy,[ds])[0].tg,'ALLERGIC DISORDER','A different-route record outside the selected month blocks broad legacy mappings');
  const conflict=structuredClone(ds);conflict.preparationGroups![preparationKey('Ketotifen','TOFEN','BEXIMCO','EYE DROP')]='';
  assert.equal(dashboardData([conflict],'2026-06','2026-06').rows.find(r=>r.form==='EYE DROP'&&r.brand==='TOFEN')!.tg,'Unclassified');
});

test('form aliases are normalized without treating a bare Drop as an eye preparation', () => {
  assert.equal(normalizePreparation(' eye drops '),'EYE DROP');
  assert.equal(preparationMarket('tablets'),'ORAL');assert.equal(preparationMarket('syrup'),'ORAL');
  assert.equal(preparationMarket('ear drop'),'EAR');assert.equal(preparationMarket('nasal drop'),'NASAL');
  assert.equal(preparationMarket('DROP'),'FORM:DROP');assert.equal(preparationMarket(''),'FORM:UNKNOWN');
  assert.equal(preparationKey(' G ',' B ',' C ','TABLET'),preparationKey('g','b','c','TAB'));
});

test('Postgres preparation summaries, source mappings and manual assignments keep eye, ear and oral facts separate', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
    const migrations=await readdir(new URL('../supabase/migrations/',import.meta.url));
    for(const file of ['schema.sql','admin-reporting.sql','brand-catalogue.sql',...migrations.sort().map(f=>'migrations/'+f)]) await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
    const user='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${user}','owner@example.com',now());select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.email','owner@example.com',false);`);
    await db.query(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,complete,active,payload) values($1,'fixture','fixture','2026-06-01','2026-06-30',now(),true,true,$2::jsonb)`,[id,JSON.stringify({preparationGroups:groups,classificationVersion:2})]);
    const ds=source();
    for(const generic of ['Ketotifen','Ciprofloxacin']) await db.query(`insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values($1,'2026-06',$2,$3::jsonb)`,[id,generic,JSON.stringify(ds.facts.filter(f=>f.generic===generic))]);
    await db.query('insert into public.rxm_dashboard_taxonomy values($1,$2)',[therapeuticGroupKey('Ketotifen','TOFEN','BEXIMCO'),'ALLERGIC DISORDER']);
    await db.query('insert into public.rxm_dashboard_preparation_taxonomy values($1,$2)',[preparationKey('Ketotifen','TOFEN','BEXIMCO','EYE DROP'),'OPHTHALMIC']);
    await db.exec('set role authenticated');
    const call=async()=>(await db.query<{data:[string,string,string,string,number,string][]}>("select public.rxm_dashboard_preparations('2026-06','2026-06') data")).rows[0].data;
    let rows=await call();
    assert.equal(rows.reduce((n,r)=>n+Number(r[4]),0),106);
    assert.equal(rows.find(r=>r[2]==='TOFEN'&&r[5]==='EYE DROP')![0],'OPHTHALMIC');
    await db.query('select public.rxm_assign_dashboard_tg($1,$2,array[$3]::text[],$4)',['Ketotifen','TOFEN','BEXIMCO','ALLERGIC DISORDER']);
    assert.equal((await call()).find(r=>r[2]==='TOFEN'&&r[5]==='EYE DROP')![0],'OPHTHALMIC','Legacy whole-brand assignments do not override precise source data');
    await db.query('select public.rxm_assign_preparation_tg($1,$2,array[$3]::text[],array[$4]::text[],$5)',['Ketotifen','TOFEN','BEXIMCO','EYE DROPS','OPHTHALMIC']);
    rows=await call();assert.equal(rows.find(r=>r[2]==='TOFEN'&&r[5]==='TAB')![0],'ALLERGIC DISORDER');
    await assert.rejects(db.exec(`update public.rxm_fact_chunks set dashboard_preparation_summary='[]'`),/permission denied/);
    await assert.rejects(db.exec(`insert into public.rxm_dashboard_preparation_taxonomy values('FORGED','TG')`),/permission denied/);
    await db.exec(`reset role;insert into auth.users(id,email,email_confirmed_at) values('33333333-3333-4333-8333-333333333333','member@example.com',now());insert into public.rxm_members(email,role) values('member@example.com','member');select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);select set_config('request.jwt.claim.email','member@example.com',false);set role authenticated`);
    assert.equal((await call()).reduce((n,r)=>n+Number(r[4]),0),106);
    await assert.rejects(db.exec(`select public.rxm_assign_preparation_tg('Ketotifen','TOFEN',array['BEXIMCO'],array['TAB'],'OPHTHALMIC')`),/Admin or Editor/);
    await db.exec('reset role;set role anon');await assert.rejects(call(),/permission denied/);
    await db.exec('reset role');
    const sql=await db.query<{form:string,market:string}>("select rxm_private.preparation_form(' EYE DROPS ') form,rxm_private.preparation_market('DROP') market");
    assert.deepEqual(sql.rows[0],{form:'EYE DROP',market:'FORM:DROP'});
    await db.query('insert into public.rxm_dashboard_tg_overrides(key,tg) values($1,$2)',[therapeuticGroupKey('Ketotifen','OTHER EYE','OTHER'),'OPHTHALMIC']);
    assert.equal((await db.query<{n:number}>('select rxm_private.carry_preparation_overrides() n')).rows[0].n,1,'Only the single-route legacy mapping is carried');
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.rxm_dashboard_preparation_overrides where key=$1",[preparationKey('Ketotifen','TOFEN','BEXIMCO','TAB')])).rows[0].n,0,'Mixed-route Tofen is not copied to oral forms');
    await db.query('insert into public.rxm_dashboard_taxonomy(key,tg) values($1,$2)',[therapeuticGroupKey('Ketotifen','OTHER ORAL','OTHER'),'ALLERGIC DISORDER']);
    await db.query("update public.rxm_datasets set payload=jsonb_set(payload,'{preparationGroups}',(payload->'preparationGroups')-$1) where id=$2",[preparationKey('Ketotifen','OTHER ORAL','OTHER','SYP'),id]);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.email','owner@example.com',false);set role authenticated`);
    assert.equal((await call()).find(r=>r[2]==='OTHER ORAL')![0],'Unclassified','A brand-only reference cannot guess the TG of a missing preparation');
    // Compare the optimized range RPC with the former implementation on repeated
    // chunks, normalized aliases, explicit mapping conflicts and inactive data.
    await db.exec('reset role');
    const reference=(await readFile(new URL('../supabase/migrations/20261024101246_dashboard_preparation_classification_strict.sql',import.meta.url),'utf8'))
      .replaceAll('public.rxm_dashboard_preparations(', 'public.rxm_dashboard_preparations_reference(');
    await db.exec(reference);
    for (const [month,active] of [['07',true],['08',true],['09',false]] as const) {
      const nextId=`44444444-4444-4444-8444-4444444444${month}`;
      const mapping={...groups,[preparationKey('Ketotifen','TOFEN','BEXIMCO','SYP')]:''};
      await db.query(`insert into public.rxm_datasets(id,name,hash,from_date,to_date,imported_at,complete,active,payload) values($1,$2,$2,$3::date,$4::date,now(),true,$5,$6::jsonb)`,
        [nextId,'range-'+month,`2026-${month}-01`,`2026-${month}-${month==='09'?'30':'31'}`,active,JSON.stringify({preparationGroups:mapping})]);
      for (const count of [11,17]) await db.query(`insert into public.rxm_fact_chunks(dataset_id,month,generic,payload) values($1,$2,$3,$4::jsonb)`,
        [nextId,'2026-'+month,' Ketotifen  ',JSON.stringify([
          {generic:' Ketotifen  ',brand:' tofen ',company:' beximco ',form:'syrup',count},
          {generic:' Ketotifen  ',brand:' tofen ',company:' beximco ',form:'eye drops',count:3}
        ])]);
    }
    await db.exec('set role authenticated');
    for (const [from,to] of [['2026-03','2026-10'],['2026-07','2026-08'],['2026-08','2026-08'],['2026-09','2026-10']]) {
      const optimized=(await db.query<{data:unknown[]}>(`select public.rxm_dashboard_preparations($1,$2) data`,[from,to])).rows[0].data;
      const original=(await db.query<{data:unknown[]}>(`select public.rxm_dashboard_preparations_reference($1,$2) data`,[from,to])).rows[0].data;
      assert.deepEqual(optimized.map(r=>JSON.stringify(r)).sort(),original.map(r=>JSON.stringify(r)).sort(),`Range ${from}–${to} matches original classifications and totals`);
    }
    await assert.rejects(db.query(`select public.rxm_dashboard_preparations($1,$2)`,['2026-10','2026-03']),/valid month range/);

  } finally {await db.close();}
});

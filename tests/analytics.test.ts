import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparableMonths, divisionShares, emptyAnalysisFilters, ffPerformance, filterFacts, prescribers, specialtyProductivity, opportunities, csvText, strengthKey, type AnalyticsFact } from '../src/analytics-model';
import { fullMarketSource, planSourceImports } from '../src/import-flow';
import { demoWorkspace } from '../src/demo';
const fact=(patch:Partial<AnalyticsFact>={}):AnalyticsFact=>({date:'2026-06-10',generic:'Bilastine',brand:'BILAN',company:'OTHER',form:'TAB',strength:'20 MG',doctorCode:'D1',doctorName:'Doctor One',specialty:'MEDICINE',acdRegion:'A1',acdAse:'A10',acdMpe:'A11',ccdRegion:'C1',ccdAse:'C10',ccdMpe:'C11',count:1,sourceRow:1,sheet:'TRD',tg:'ALLERGY',datasetId:'source',...patch});
const market={generic:'Bilastine',brand:'BILLI',marketKey:'ORAL'};
test('specialty productivity includes non-prescribers and retains benchmark under product and specialty filters',()=>{
  const facts=[fact({count:4}),fact({brand:'BILLI',company:'BEXIMCO',count:2}),fact({doctorCode:'D2',generic:'Other generic',count:10}),fact({doctorCode:'D3',specialty:'ENT',count:2}),fact({doctorCode:'D4',specialty:'ENT',generic:'Other generic',count:4})];
  const rows=specialtyProductivity(facts,{...emptyAnalysisFilters,form:'TAB',strength:'20 MG'},market);
  const med=rows.find(r=>r.specialty==='MEDICINE')!;
  assert.equal(med.doctors,2);assert.equal(med.generic,6);assert.equal(med.brand,2);
  assert.equal(med.genericProductivity,3);assert.equal(med.brandProductivity,1);
  assert.equal(med.doctorPct,50);assert.equal(med.genericPct,75);assert.equal(med.genericIndex,1.5);assert.equal(med.brandIndex,2);
  assert.deepEqual(specialtyProductivity(facts,{...emptyAnalysisFilters,specialty:'MEDICINE'},market),[med]);
  assert.equal(rows.find(r=>r.specialty==='ENT')!.brandProductivity,0);
});
test('latest specialty assigns each doctor once and zero denominators return N/A',()=>{
  const facts=[fact(),fact({date:'2026-06-20',specialty:'ENT',generic:'Other'})];
  const rows=specialtyProductivity(facts,emptyAnalysisFilters,market);
  assert.equal(rows.length,1);assert.equal(rows[0].specialty,'ENT');assert.equal(rows[0].generic,1);assert.equal(rows[0].doctors,1);assert.equal(rows[0].brandIndex,null);
});
test('prescriber brand selection changes ranking without shrinking the Beximco share denominator',()=>{
  const facts=[fact({count:2}),fact({brand:'BILFAST'}),fact({brand:'BILLI',company:'BEXIMCO'}),fact({doctorCode:'D2',count:5})];
  const filtered=prescribers(facts,market,JSON.stringify(['BILAN','OTHER']));
  assert.equal(filtered[0].code,'D2');assert.equal(filtered[0].own,0);assert.equal(filtered[0].share,0);
  assert.equal(filtered[1].ranked,2);assert.equal(filtered[1].total,4);assert.equal(filtered[1].share,25);
  assert.equal(prescribers([...facts,fact({form:'EYE DROP',count:100})],market)[1].total,4);
});
test('ACD and CCD shares use independent eligible populations without doubling overall Rx',()=>{
  const facts=[fact({company:'BEXIMCO',brand:'BILLI',count:3}),fact({count:7,ccdRegion:''}),fact({count:2,acdRegion:''})];
  const [acd,ccd]=divisionShares(facts);
  assert.deepEqual([acd.total,acd.own,acd.share],[10,3,30]);
  assert.deepEqual([ccd.total,ccd.own,ccd.share],[5,3,60]);
  assert.equal(ffPerformance(facts,'ACD','region')[0].total,10);
});
test('brand FF numerator excludes other Beximco brands and filters combine exactly',()=>{
  const facts=[fact({company:'BEXIMCO',brand:'BILLI',count:2}),fact({company:'BEXIMCO',brand:'OTHERBEX',count:3}),fact({count:5}),fact({form:'SYP',strength:'10 MG',count:99})];
  const selected=filterFacts(facts,{...emptyAnalysisFilters,form:'TAB',strength:'20 MG',structure:'ACD',region:'A1'});
  assert.equal(selected.length,3);
  const row=ffPerformance(selected,'ACD','mpe','BILLI')[0];assert.equal(row.total,10);assert.equal(row.own,2);assert.equal(row.share,20);
  assert.equal(strengthKey('20mg'),'20 MG');assert.equal(strengthKey(), 'Not specified');
});
test('targeting matches route, respects minimum sample, and includes zero brand prescribers',()=>{
  const profiles=[{id:'billi',brand:'BILLI',generic:'Bilastine',company:'BEXIMCO',forms:['TAB']}];
  const rows=opportunities([fact({count:5}),fact({doctorCode:'D2',form:'EYE DROP',count:50})],profiles,3);
  assert.equal(rows.length,1);assert.equal(rows[0].code,'D1');assert.equal(rows[0].own,0);assert.equal(rows[0].brand,'BILLI');
});
test('enriched re-import replaces earlier source safely and remains duplicate-safe',async()=>{
  const old=await fullMarketSource(demoWorkspace().datasets[0]);
  const fresh=await fullMarketSource({...old,analyticsVersion:1});
  assert.notEqual(old.hash,fresh.hash);assert.equal((await fullMarketSource(fresh)).hash,fresh.hash);
  const plan=planSourceImports([fresh],[old]);assert.equal(plan[0].status,'ready');assert.match(plan[0].message,/Replaces/);
  assert.equal(planSourceImports([fresh],[fresh])[0].status,'skip');
});
test('CSV export escapes quotes and formula-like doctor text',()=>{
  const csv=csvText(['Doctor'],[['=cmd()'],['A "B"']]);assert.ok(csv.includes('"\'=cmd()"'));assert.ok(csv.includes('"A ""B"""'));
});
test('matched-day comparison uses daily counts inside monthly cloud aggregates',()=>{
  const facts=[fact({date:'2026-06-20',count:20,dailyCounts:{'2026-06-01':5,'2026-06-20':15},brand:'BILLI',company:'BEXIMCO'}),fact({date:'2026-07-01',count:10})];
  const comparison=comparableMonths(facts,['2026-06-01','2026-06-20','2026-07-01'],'2026-06','2026-07');
  assert.deepEqual(comparison.days,['01']);assert.equal(comparison.previous.total,5);assert.equal(comparison.current.total,10);assert.equal(comparison.change,-100);
});
test('targeting does not recommend a tablet-only brand for syrup-only doctors or a known mismatched strength',()=>{
  const profiles=[{id:'billi',brand:'BILLI',generic:'Bilastine',forms:['TAB'],variants:[{form:'TAB',strength:'20 MG'}]}];
  assert.equal(opportunities([fact({form:'SYP',count:10})],profiles,1).length,0);
  assert.equal(opportunities([fact({strength:'10 MG',count:10})],profiles,1).length,0);
});

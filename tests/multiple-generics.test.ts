import { test } from "node:test";
import assert from "node:assert/strict";
import { reports, nationalRxShare, makeMail, selectReportDoctors } from "../src/engine";
import { marketLabel, missingMarketCoverage, datasetGenericNames, reportGenericNames } from "../src/markets";
import { emlPackage, outlookPackage } from "../src/export";
import { defaultSettings } from "../src/types";
import type { BrandProfile, Dataset, RxFact, Hierarchy, Batch } from "../src/types";
import { unzipSync, strFromU8 } from "fflate";

// Synthetic direct-generic name avoids making a product-composition claim.
const profile: BrandProfile = { id: 'napadol', brand: 'NAPADOL', generic: 'Direct generic', forms: [], aliases: ['Direct alias'], targetGenerics: ['Tramadol',' direct generic ','TRAMADOL'] };
const fact: RxFact = { date:'2026-07-15',generic:'Direct generic',brand:'NAPADOL',company:'BEXIMCO',form:'TAB',doctorCode:'D1',doctorName:'Doctor One',specialty:'Medicine',acdRegion:'D5',acdMpe:'D501',acdAse:'D500',ccdRegion:'C1',ccdMpe:'C101',ccdAse:'C100',count:10,sourceRow:2,sheet:'TRD' };
const dataset: Dataset = { id:'ds',name:'Source',hash:'hash',importedAt:'2026-08-01',active:true,rows:50,invalidRows:0,from:'2026-07-01',to:'2026-07-31',dates:['2026-07-15'],includedGenerics:['Direct generic','Tramadol'],sheets:['TRD'],catalog:[],facts:[fact,{...fact,generic:'Tramadol',brand:'OTHER',form:'CAP',count:30,sourceRow:3},{...fact,generic:'Tramadol',brand:'OTHER',doctorCode:'D2',count:10,sourceRow:4}] };
test('multiple generics use a union of markets, merge each doctor within territory, and keep national counts independent of ACD/CCD', () => {
  const result = reports([dataset],'2026-07',profile,['ACD','CCD']);
  assert.equal(result.length,2);
  for (const report of result) {
    assert.equal(report.total,50); assert.equal(report.own,10); assert.equal(report.doctors.length,2);
    assert.equal(report.doctors[0].code,'D1'); assert.equal(report.doctors[0].genericCount,40);
    assert.equal(report.doctors[0].ownCount,10); assert.equal(report.doctors[0].otherBrands.OTHER,30);
    assert.equal(report.aseShares?.[0].genericCount,50); assert.equal(report.mpeShares?.[0].genericCount,50);
    assert.equal(selectReportDoctors(report,{limit:1}).doctors.length,1);
  }
  assert.deepEqual(nationalRxShare([dataset],'2026-07',profile).total,50);
  assert.equal(nationalRxShare([dataset],'2026-07',profile).share,20);
  assert.equal(marketLabel(profile),'Direct generic + Tramadol');
});
test('single-generic reports and form filters still work; same brand name in an added generic is not counted as the target brand', () => {
  assert.equal(reports([dataset],'2026-07',{...profile,targetGenerics:[]},['ACD'])[0].total,10);
  assert.equal(reports([dataset],'2026-07',{...profile,forms:['TAB']},['ACD'])[0].total,20);
  const collision = { ...dataset, facts:[...dataset.facts,{...fact,generic:'Tramadol',count:5}] };
  assert.equal(reports([collision],'2026-07',profile,['ACD'])[0].own,10);
  assert.equal(nationalRxShare([collision],'2026-07',profile).own,10);
  assert.equal(reports([dataset],'2026-07',profile,['ACD'],'first').length,0);
});
test('omitted secondary market blocks complete reporting and aliases do not duplicate fact counts', () => {
  assert.deepEqual(missingMarketCoverage([{...dataset,includedGenerics:['Direct generic']}],['2026-07'],profile),[{generic:'Tramadol',month:'2026-07'}]);
  assert.deepEqual(missingMarketCoverage([dataset],['2026-07'],profile),[]);
  const overlappingNames = {...profile,aliases:['Tramadol','Direct alias']};
  assert.equal(reportGenericNames(overlappingNames).filter(name => name==='TRAMADOL').length,1);
  assert.equal(reports([dataset],'2026-07',overlappingNames,['ACD'])[0].total,50);
  assert.ok(datasetGenericNames({...dataset,availableGenerics:['Competitor-only market']}).includes('Competitor-only market'));
});
test('combined market names and totals are frozen into region-specific emails and existing exports', () => {
  const hierarchy: Hierarchy = {id:'h',name:'Hierarchy',effectiveFrom:'2026-01-01',createdAt:'2026-01-01',rows:[{structure:'ACD',region:'D5',rseName:'RSE',rseEmail:'rse@example.com',salutation:'RSE Bhai',active:true,cc:[]}]};
  const report=reports([dataset],'2026-07',profile,['ACD'])[0];
  const settings={...defaultSettings,name:'Sender',email:'sender@example.com'};
  const mail=makeMail(report,profile,"July'26",hierarchy,settings,report.national);
  assert.match(mail.subject,/Direct generic \+ Tramadol/); assert.match(mail.html,/Combined selected markets/);
  assert.match(mail.html,/Selected markets Rx/); assert.equal(mail.doctorCount,2);
  const batch: Batch={id:'batch',createdAt:'2026-08-01T00:00:00Z',month:'2026-07',generic:marketLabel(profile),brand:profile.brand,sourceIds:['ds'],hierarchyId:'h',settings,profile:structuredClone(profile),mails:[mail]};
  const oldHtml=mail.html; profile.targetGenerics!.push('Another market');
  assert.equal(batch.mails[0].html,oldHtml); assert.ok(!batch.profile.targetGenerics!.includes('Another market'));
  assert.ok(Object.keys(unzipSync(emlPackage(batch))).some(name=>name.endsWith('.eml')));
  assert.ok(Object.values(unzipSync(outlookPackage(batch))).some(bytes=>strFromU8(bytes).includes('Combined selected markets')));
});

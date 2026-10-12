import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { reports, makeMail, selectReportDoctors } from "../src/engine.ts";
import { defaultEmailTemplate, defaultSettings, starterProfiles } from "../src/types.ts";
import { templateError, emailTemplateFor } from "../src/email-template.ts";

const profile = starterProfiles[0];
const fact = (brand, count, mpe, ase, extra = {}) => ({ date: "2026-07-05", generic: "Ketotifen", brand, form: "SYP", company: "Example", doctorCode: mpe, doctorName: "Dr. " + mpe, specialty: "Medicine", acdRegion: "A1", acdMpe: mpe, acdAse: ase, ccdRegion: "C1", ccdMpe: "C" + mpe, ccdAse: "C" + ase, count, sourceRow: 2, sheet: "Rx", ...extra });
const dataset = { id: "d", name: "Rx", hash: "test", active: true, importedAt: "2026-08-01", from: "2026-07-01", to: "2026-07-31", rows: 4, invalidRows: 0, sheets: ["Rx"], catalog: [], facts: [fact("TOFEN",5,"A11","A10"),fact("FENAT",17,"A11","A10"),fact("TOFEN",8,"A21","A20"),fact("FENAT",12,"A21","A20")] };
const hierarchy = { id: "h", name: "Example", effectiveFrom: "2026-01-01", createdAt: "2026-01-01", rows: ["A1","A2"].map(region => ({ structure:"ACD", region, active:true, rseName:"Example RSE", salutation:"Zakir", rseEmail:"rse@example.com", cc:[] })) };
const settings = { ...defaultSettings, name:"Example sender", email:"sender@example.com" };
const n = { total:100, own:32, share:32, available:true };

test("full-market ASE/MPE summaries use actual codes and survive specialty filtering and doctor limits", () => {
  for (const report of reports([dataset],"2026-07",profile,["ACD","CCD"])) {
    const limited = selectReportDoctors(report,{specialty:"Medicine",limit:1});
    assert.deepEqual(limited.aseShares,report.aseShares);
    assert.deepEqual(limited.mpeShares,report.mpeShares);
    for (const groups of [limited.aseShares,limited.mpeShares]) {
      assert.equal(groups.reduce((sum,g)=>sum+g.genericCount,0),report.total);
      assert.equal(groups.reduce((sum,g)=>sum+g.ownCount,0),report.own);
    }
    assert.ok(report.aseShares.every(g=>g.code.startsWith(report.structure==="ACD" ? "A" : "C")));
  }
  const old = { ...dataset, facts:dataset.facts.map(({acdAse,ccdAse,...f})=>f), aseByMpe:{ACD:{'["A1","A11"]':"A10",'["A1","A21"]':"A20"},CCD:{'["C1","CA11"]':"CA10",'["C1","CA21"]':"CA20"}} };
  assert.deepEqual(reports([old],"2026-07",profile,["ACD"])[0].aseShares,reports([dataset],"2026-07",profile,["ACD"])[0].aseShares);
  const explicitBlank = { ...old, facts:old.facts.map(f=>({...f,acdAse:""})) };
  assert.equal(reports([explicitBlank],"2026-07",profile,["ACD"])[0].aseShares[0].code,"Unassigned","An explicitly missing source ASE must not be guessed");
});
test("default mail matches the requested opening and horizontal three-line cells without a generic-brand heading", () => {
  const report = selectReportDoctors(reports([dataset],"2026-07",profile,["ACD"])[0],{limit:1});
  const mail = makeMail(report,profile,"July'26",hierarchy,settings,n);
  assert.equal(mail.subject, "Ketotifen (TOFEN) Prescriber List of A1 Region for July'26");
  const doc = new JSDOM(mail.html).window.document;
  assert.match(doc.body.textContent,/Dear Zakir Bhai,/);
  assert.equal(doc.querySelector('[data-email-opening]').textContent,"Please find below the prescription share and prescribers list of Ketotifen and TOFEN Rx scenario in A1 Region for July'26.");
  assert.ok(!doc.body.textContent.includes("Ketotifen · TOFEN"));
  assert.deepEqual([...doc.querySelectorAll('[data-email-section]')].map(d=>d.dataset.emailSection),["RegionalShare","ASEShare","MPEShare","Prescribers"]);
  const ase = doc.querySelector('table[aria-label="ASE wise Rx share"]');
  assert.equal(ase.rows.length,1);
  assert.equal(ase.querySelectorAll('td').length,2);
  const a10 = ase.querySelector('[data-territory-code="A10"]');
  assert.equal(a10.querySelectorAll('br').length,2);
  assert.match(a10.textContent,/22\/5/);
  assert.match(a10.textContent,/22.7%/);
  assert.equal(a10.lastElementChild.style.color,"rgb(180, 35, 53)");
  assert.equal(ase.querySelector('[data-territory-code="A20"]').lastElementChild.style.color,"rgb(0, 117, 104)");
  assert.equal(doc.querySelectorAll('table[aria-label="Prescriber list"] tbody tr').length,1);
});
test("custom wording merges each region safely, preserves calculated tables and freezes generated content", () => {
  const r = reports([dataset],"2026-07",profile,["ACD"])[0];
  const custom = { ...settings,emailTemplate:{...defaultEmailTemplate,subject:"Review {Brand} for {Region}",opening:"{RSE}, please review {Generic} <script>danger</script>.",body:"Team note for {Region}.\n"+defaultEmailTemplate.body+"\nDiscuss priority doctors."} };
  const mail = makeMail(r,profile,"2026-07",hierarchy,custom,n);
  const doc = new JSDOM(mail.html).window.document;
  assert.equal(mail.subject,"Review TOFEN for A1");
  assert.equal(makeMail({...r,region:"A2"},profile,"2026-07",hierarchy,custom,n).subject,"Review TOFEN for A2");
  assert.equal(doc.querySelector('script'),null);
  assert.match(doc.querySelector('[data-email-opening]').textContent,/Zakir, please review Ketotifen <script>danger<\/script>/);
  assert.match(doc.body.textContent,/Team note for A1/);
  assert.match(doc.body.textContent,/Discuss priority doctors/);
  custom.emailTemplate.opening="Changed after generation";
  assert.ok(!mail.html.includes(custom.emailTemplate.opening));
  assert.ok(templateError({...defaultEmailTemplate,body:"{RegionalShare}"}));
  assert.ok(templateError({...defaultEmailTemplate,subject:"Injected\r\nBcc: somebody@example.com"}));
  assert.ok(templateError({...defaultEmailTemplate,opening:"{Invalid}"}));
  assert.deepEqual(emailTemplateFor(settings),defaultEmailTemplate);
});
test("horizontal summary wraps to another row only when needed, without empty filler cells", () => {
  const facts = Array.from({length:9},(_,i)=>fact("TOFEN",1,`A${i+1}1`,`A${i+1}0`));
  const r = reports([{...dataset,facts}],"2026-07",profile,["ACD"])[0];
  const doc = new JSDOM(makeMail(r,profile,"2026-07",hierarchy,settings,n).html).window.document;
  for (const label of ["ASE","MPE"]) {
    const table = doc.querySelector(`table[aria-label="${label} wise Rx share"]`);
    assert.equal(table.rows.length,2);
    assert.equal(table.rows[0].querySelectorAll("td").length,8);
    assert.equal(table.rows[1].querySelectorAll("td").length,1);
    assert.equal(table.querySelectorAll('td').length,9);
    assert.ok([...table.querySelectorAll('td')].every(td=>td.textContent.trim()));
  }
});

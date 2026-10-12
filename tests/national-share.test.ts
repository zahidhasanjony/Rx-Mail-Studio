import { test } from "node:test";
import assert from "node:assert/strict";
import { belowNational, nationalRxShare, reports, makeMail } from "../src/engine";
import { defaultSettings, starterProfiles } from "../src/types";
import type { Dataset, Hierarchy, RxFact } from "../src/types";
import { JSDOM } from "jsdom";
const profile = starterProfiles[0];
const fact = (brand: string, count: number, region = "R1", extra: Partial<RxFact> = {}): RxFact => ({
  date: "2026-08-05", generic: "Ketotifen", brand, company: "Example", form: "SYP",
  doctorCode: "D1", doctorName: "Example doctor", specialty: "Medicine", acdRegion: region,
  acdMpe: "M1", ccdRegion: "C1", ccdMpe: "CM1", count, sourceRow: 2, sheet: "Rx", ...extra,
});
const source = (facts: RxFact[], extra: Partial<Dataset> = {}): Dataset => ({
  id: "source", name: "Rx", hash: "test", importedAt: "2026-08-11", active: true,
  from: "2026-08-01", to: "2026-08-10", rows: facts.length, invalidRows: 0,
  sheets: ["Rx"], catalog: [], dates: [...new Set(facts.map(f => f.date))], facts, ...extra,
});
const hierarchy: Hierarchy = { id: "h", name: "Q3", effectiveFrom: "2026-07-01", createdAt: "2026-07-01",
  rows: [{ structure: "ACD", region: "R1", rseName: "Example RSE", rseEmail: "rse@example.com", salutation: "Zakir Bhai", cc: [], active: true }] };
const settings = { ...defaultSettings, name: "Example sender", email: "sender@example.com", intro: "Long boilerplate to omit" };
test("national counts every eligible record once, independent of ACD/CCD routing and chosen recipients", () => {
  const ds = source([fact("TOFEN", 25), fact("FENAT", 75), fact("TOFEN", 39, "R2"), fact("FENAT", 61, "R2")]);
  const n = nationalRxShare([ds], "2026-08", profile, "first");
  assert.equal(n.total, 200); assert.equal(n.own, 64); assert.equal(n.share, 32);
  for (const structures of [["ACD"], ["CCD"], ["ACD", "CCD"]] as ("ACD" | "CCD")[][]) {
    const result = reports([ds], "2026-08", profile, structures, "first");
    assert.ok(result.every(r => r.national?.total === 200 && r.national?.share === 32));
  }
  const r = reports([ds], "2026-08", profile, ["ACD"], "first").find(r => r.region === "R1")!;
  assert.equal(r.own / r.total * 100, 25);
  assert.equal(makeMail(r, profile, "August 2026 · 1–10", hierarchy, settings).national?.share, 32);
});
test("national market uses exact generic aliases, form, month, cycle and active versions", () => {
  const ds = source([fact("TOFEN", 32), fact("FENAT", 68), fact("TOFEN", 999, "R1", { form: "TAB" }),
    fact("TOFEN", 999, "R1", { generic: "Other generic" }), fact("TOFEN", 999, "R1", { date: "2026-08-15" }),
    fact("TOFEN", 999, "R1", { date: "2026-07-05" })]);
  const n = nationalRxShare([ds, source([fact("TOFEN", 999)], { active: false })], "2026-08", { ...profile, forms: ["SYP"] }, "first");
  assert.equal(n.share, 32); assert.equal(n.total, 100);
});
test("strict below comparison includes zero own Rx, excludes equality and missing denominator, and never compares rounded displays", () => {
  const n = { total: 10000, own: 3204, share: 32.04, available: true };
  assert.equal(belowNational({ ownCount: 3203, genericCount: 10000 }, n), true);
  assert.equal(belowNational({ ownCount: 3204, genericCount: 10000 }, n), false);
  assert.equal(belowNational({ ownCount: 0, genericCount: 100 }, n), true);
  assert.equal(belowNational({ ownCount: 0, genericCount: 0 }, n), false);
  assert.equal(belowNational({ ownCount: 1, genericCount: 100 }, { ...n, available: false, share: null }), false);
});
test("missing national route coverage, empty markets and overlapping source dates do not produce a misleading benchmark", () => {
  const ds = source([fact("TOFEN", 32), fact("FENAT", 68)]);
  const missing = nationalRxShare([ds], "2026-08", profile, "first", [...hierarchy.rows, { structure: "ACD", region: "R2", active: true }]);
  assert.equal(missing.available, false); assert.equal(missing.share, null); assert.match(missing.reason!, /no source coverage/);
  assert.equal(nationalRxShare([ds, { ...ds, id: "duplicate" }], "2026-08", profile).available, false);
  assert.equal(nationalRxShare([source([])], "2026-08", profile).share, null);
  const coveredZero = source([fact("TOFEN", 32), fact("FENAT", 68)], { regions: { ACD: ["R1", "R2"], CCD: ["C1"] }, regionDates: { ACD: { R1: ["2026-08-05"], R2: ["2026-08-05"] }, CCD: { C1: ["2026-08-05"] } } });
  assert.equal(nationalRxShare([coveredZero], "2026-08", profile, "first", [{ structure: "ACD", region: "R2", active: true }]).available, true);
});
test("clean email has five centered brand cells, doctor codes, exact red rows and a frozen national benchmark", () => {
  const records = [fact("TOFEN", 25), fact("FENAT", 75), fact("TOFEN", 16, "R1", { doctorCode: "D2" }), fact("FENAT", 34, "R1", { doctorCode: "D2" }),
    fact("TOFEN", 40, "R1", { doctorCode: "D3" }), fact("FENAT", 40, "R1", { doctorCode: "D3" }),
    fact("FENAT", 60, "R1", { doctorCode: "D4" })];
  const r = reports([source(records)], "2026-08", profile, ["ACD"])[0];
  const n = { total: 100, own: 32, share: 32, available: true };
  const mail = makeMail(r, profile, "August 2026 · 1–10", hierarchy, settings, n);
  n.share = 90; n.own = 90;
  assert.equal(mail.national?.share, 32);
  assert.ok(!mail.html.includes(settings.intro));
  const doc = new JSDOM(mail.html).window.document;
  assert.equal(doc.querySelector('table[role="presentation"]')!.querySelectorAll("td").length, 5);
  const table = doc.querySelector('table[aria-label="Prescriber list"]')!;
  assert.equal(table.querySelectorAll('tr[data-below-national="true"]').length, 2);
  assert.ok([...table.querySelectorAll("th,td")].every(c => c.getAttribute("style")?.includes("text-align:center;vertical-align:middle")));
  assert.deepEqual([...table.querySelectorAll('tr[data-below-national="true"]')].map(r => r.children[1].textContent), ["D1", "D4"]);
  assert.match(mail.html, /National TOFEN share 32.0%/);
  assert.ok(mail.html.indexOf("Regional Rx share") < mail.html.indexOf("Prescriber list"));
});

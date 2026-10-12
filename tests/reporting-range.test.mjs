import { test } from "node:test";
import assert from "node:assert/strict";
import { reportingMonths, reportingPeriod } from "../src/reporting.ts";
import { reports, nationalRxShare, coverage, regionalQueue } from "../src/engine.ts";
import { extraHierarchyCcMappings, mapHierarchy } from "../src/excel.ts";
import { hierarchyCsv } from "../src/export.ts";
import { parseCsv } from "../src/csv.ts";
import { defaultEmailTemplate } from "../src/types.ts";

test("month ranges cross years and label each reporting Flash consistently", () => {
  assert.deepEqual(reportingMonths("2025-12", "2026-02"), ["2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(reportingMonths("2026-07", "2026-06"), []);
  assert.deepEqual(reportingMonths("2026-00"), []);
  assert.equal(reportingPeriod("2026-07"), "July'26");
  for (const [cycle, ordinal] of [["first", "1st"], ["second", "2nd"], ["third", "3rd"]]) {
    assert.equal(reportingPeriod("2026-07", "2026-07", cycle), `July'26 ${ordinal} Flash`);
    assert.equal(reportingPeriod("2026-06", "2026-07", cycle), `June'26–July'26 ${ordinal} Flash`);
  }
  assert.match(defaultEmailTemplate.subject, /\{Generic\} \(\{Brand\}\).*\{Region\}.*\{Period\}/);
});
const profile = { generic: "Ketotifen", brand: "Tofen", forms: ["TAB"] };
const fact = (month, brand, count, day = "05") => ({ date: `${month}-${day}`, generic: "Ketotifen", brand, form: "TAB", count,
  doctorCode: "D1", doctorName: "Dr. Example", specialty: "Medicine", acdRegion: "A1", acdMpe: "A11", acdAse: "A10", ccdRegion: "C1", ccdMpe: "C11", ccdAse: "C10" });
const source = (month, own, other) => ({ id: month, active: true, from: `${month}-01`, to: `${month}-28`, includedGenerics: ["Ketotifen"],
  dates: [`${month}-05`, `${month}-15`, `${month}-25`], regions: { ACD: ["A1"], CCD: ["C1"] }, regionDates: { ACD: { A1: [`${month}-05`] }, CCD: { C1: [`${month}-05`] } },
  facts: [fact(month, "Tofen", own), fact(month, "Fenat", other), fact(month, "Tofen", 500, "15"), fact(month, "Tofen", 600, "25")] });
test("range totals sum Rx once, use weighted national counts and filter the Flash in each month", () => {
  const sources = [source("2026-06", 5, 5), source("2026-07", 10, 80)];
  const n = nationalRxShare(sources, "2026-06", profile, "first", [], "2026-07");
  assert.deepEqual(n, { total: 100, own: 15, share: 15, available: true });
  const regional = reports(sources, "2026-06", profile, ["ACD", "CCD"], "first", "2026-07");
  assert.equal(regional.length, 2);
  for (const r of regional) {
    assert.equal(r.total, 100); assert.equal(r.own, 15);
    assert.equal(r.doctors[0].genericCount, 100);
    assert.deepEqual(r.aseShares[0], { code: r.structure === "ACD" ? "A10" : "C10", genericCount: 100, ownCount: 15 });
  }
  assert.equal(nationalRxShare(sources, "2026-06", profile, "second", [], "2026-07").own, 1000);
  assert.equal(nationalRxShare(sources, "2026-06", profile, "third", [], "2026-07").own, 1200);
  assert.equal(coverage(sources, "2026-06", "2026-07").length, 6);
  assert.equal(nationalRxShare([...sources, source("2026-07", 1, 1)], "2026-06", profile, "first", [], "2026-07").available, false);
  const hierarchy = { rows: [{ structure: "ACD", region: "A1", active: true, rseName: "Example", rseEmail: "rse@example.com", salutation: "Example", cc: [] }] };
  const dates = ["2026-06-05", "2026-07-05"];
  assert.equal(regionalQueue(regional, sources, hierarchy, ["ACD"], "Tofen", true, dates, ["2026-06", "2026-07"])[0].error, undefined);
  assert.match(regionalQueue(regional, sources.slice(0, 1), hierarchy, ["ACD"], "Tofen", true, dates, ["2026-06", "2026-07"])[0].error, /every selected month/);
});
test("custom hierarchy roles skip blanks, deduplicate addresses and round-trip a full version through CSV", () => {
  const rows = [["Structure", "Region", "RSE Name", "RSE Email", "Salutation", "Active", "MDR Name", "MDR Email", "Director Name", "Director Email", "Director Title"],
    ["ACD", "A1", "Example", "rse@example.com", "Example", "Yes", "Manager", "m@example.com", 'Person, "Two"', "d@example.com", "Regional Director"],
    ["CCD", "C1", "Example", "rse@example.com", "Example", "No", "Manager", "m@example.com", "Duplicate", "M@EXAMPLE.COM", "Extra"],
    ["ACD", "A2", "Example", "rse@example.com", "Example", "Yes", "", "", "", "", ""]];
  const mapping = Object.fromEntries(rows[0].map((h, i) => [h, i]));
  const hierarchy = { rows: mapHierarchy(rows, mapping, extraHierarchyCcMappings(rows[0])) };
  assert.equal(hierarchy.rows[0].cc[1].title, "Regional Director");
  assert.equal(hierarchy.rows[1].cc.length, 1);
  assert.equal(hierarchy.rows[2].cc.length, 0);
  const imported = parseCsv(hierarchyCsv(hierarchy));
  const mappings = Object.fromEntries(imported[0].map((h, i) => [h, i]));
  assert.deepEqual(mapHierarchy(imported, mappings, extraHierarchyCcMappings(imported[0])), hierarchy.rows);
  const formula = hierarchyCsv({ rows: [{ ...hierarchy.rows[0], rseName: "=HYPERLINK(test)" }] });
  assert.match(formula, /'=HYPERLINK/);
});

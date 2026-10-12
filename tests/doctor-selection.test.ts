import { test } from "node:test";
import assert from "node:assert/strict";
import { reports, selectReportDoctors, reportSpecialties } from "../src/engine";
import { starterProfiles } from "../src/types";
import type { Dataset, RxFact } from "../src/types";

const fact = (code: string, name: string, mpe: string, count: number, specialty = "Medicine"): RxFact => ({
  date: "2026-07-05", generic: "Ketotifen", brand: "TOFEN", form: "SYP", company: "Example",
  doctorCode: code, doctorName: name, acdRegion: "A1", acdMpe: mpe, ccdRegion: "C1", ccdMpe: mpe,
  count, specialty, sheet: "Rx", sourceRow: 2,
});
const dataset: Dataset = { id: "test", name: "Example", hash: "test", active: true, importedAt: "2026-08-01", from: "2026-07-01", to: "2026-07-31", rows: 5, invalidRows: 0, sheets: ["Rx"], catalog: [], facts: [
  fact("A", "Dr. A", "A11", 8), fact("X", "Dr. X", "A12", 19), fact("B", "Dr. B", "A11", 13),
  fact("Y", "Dr. Y", "A2", 2, "Pediatrics"), fact("Z", "Dr. Z", "A11", 12, " medicine "),
] };

test("MPE is the first sort key; highest generic Rx comes first inside the same MPE in both structures", () => {
  for (const report of reports([dataset], "2026-07", starterProfiles[0], ["ACD", "CCD"])) {
    assert.deepEqual(report.doctors.map(d => d.name), ["Dr. Y", "Dr. B", "Dr. Z", "Dr. A", "Dr. X"]);
    const selected = selectReportDoctors(report, { specialty: "MEDICINE", limit: 2 });
    assert.deepEqual(selected.doctors.map(d => d.name), ["Dr. B", "Dr. Z"]);
    assert.equal(selected.total, report.total);
    assert.equal(selected.own, report.own);
    assert.deepEqual(selected.shares, report.shares);
    assert.deepEqual(selected.national, report.national);
    assert.equal(report.doctors.length, 5, "Selection must not mutate the source report");
  }
});
test("All doctors, arbitrary positive limits, specialty normalization and unmatched filters", () => {
  const result = reports([dataset], "2026-07", starterProfiles[0], ["ACD"]);
  const r = result[0];
  assert.equal(selectReportDoctors(r).doctors.length, 5);
  assert.equal(selectReportDoctors(r, { limit: 3 }).doctors.length, 3);
  assert.equal(selectReportDoctors(r, { limit: 30 }).doctors.length, 5);
  assert.equal(selectReportDoctors(r, { specialty: "Pediatrics" }).doctors[0].name, "Dr. Y");
  assert.equal(selectReportDoctors(r, { specialty: "Unmatched" }).doctors.length, 0);
  assert.deepEqual(reportSpecialties(result), [{ value: "MEDICINE", label: "Medicine" }, { value: "PEDIATRICS", label: "Pediatrics" }]);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => selectReportDoctors(r, { limit }), /positive whole number/);
});

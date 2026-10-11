import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { inspectWorkbook, importRx } from "../src/excel";
import { reports } from "../src/engine";
import { starterProfiles } from "../src/types";
const path = process.argv[2];
if (!path) throw new Error("Provide a source .xlsx path");
const file = new File([await readFile(path)], path.split("/").pop()!);
const sheets = await inspectWorkbook(file);
const main = sheets.find((s) => /^TRD/.test(s.name));
if (!main) throw new Error("No primary TRD sheet found");
const d = await importRx(
  file,
  [main],
  () => {},
  starterProfiles.map((p) => p.generic),
);
const month = process.argv[3] || d.from.slice(0, 7);
const result = reports([d], month, starterProfiles[0], ["ACD"]);
for (const r of result) {
  assert.ok(r.own <= r.total);
  assert.equal(
    r.doctors.reduce((n, doctor) => n + doctor.genericCount, 0),
    r.total,
  );
  assert.ok(r.shares.length <= 5);
}
console.log(
  JSON.stringify({
    sourceRows: d.rows,
    regionsChecked: result.length,
    verified: true,
  }),
);

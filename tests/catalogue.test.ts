import { test } from "node:test";
import assert from "node:assert/strict";
import { appendBrandPairs, reconcileBrandPairs, sourceBrandPairs, searchBrandPairs } from "../src/catalogue";
import { starterProfiles } from "../src/types";
import type { BrandProfile } from "../src/types";

const fresh: BrandProfile = { id: "new", brand: "NEW BRAND", generic: "Example Generic", company: "Beximco Pharmaceuticals PLC", forms: ["TAB"] };
test("partial cloud catalogue restores all eight defaults without widening saved market definitions", () => {
  const saved = { ...fresh, forms: ["SYP"], aliases: ["Exact alias"], favorite: true };
  const result = reconcileBrandPairs([saved], [{ catalog: [...starterProfiles, fresh] }]);
  assert.equal(result.length, 9);
  for (const p of starterProfiles) assert.ok(result.some(r => r.id === p.id));
  assert.deepEqual(result.find(p => p.id === saved.id), saved);
  assert.deepEqual(result.find(p => p.brand === "TOFEN")?.forms, ["SYP", "TAB"]);
});
test("add-only discovery ignores competitor companies, normalizes pairs and preserves IDs, forms, aliases and favourites", () => {
  const edited = { ...starterProfiles[0], forms: ["SYP"], aliases: ["Ketotifen Fumarate"], favorite: false };
  const candidates = sourceBrandPairs([{ catalog: [fresh, { ...fresh, id: "duplicate", brand: " new   brand ", generic: " example generic " },
    { ...edited, id: "source-tofen", forms: ["SYP", "TAB", "EYE DROP"] },
    { ...fresh, id: "competitor", company: "Other manufacturer", brand: "FENAT" },
    { ...fresh, id: "substring", company: "NOTBEXIMCO", brand: "WRONG" }] }]);
  const result = appendBrandPairs([edited], candidates);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], edited);
  assert.deepEqual(appendBrandPairs(result, candidates), result, "Repeated refreshes add nothing twice");
  assert.equal(sourceBrandPairs([{ catalog: [{ ...fresh, company: undefined }] }]).length, 1, "Legacy Beximco-only catalogues remain compatible");
});
test("device/cloud merge retains cloud definitions and handles reused IDs without duplicate pairs", () => {
  const cloud = { ...fresh, forms: ["SYP"], favorite: true };
  const copied = appendBrandPairs([cloud], [{ ...fresh, forms: ["TAB"] }, { ...fresh, brand: "OTHER BRAND" }]);
  assert.equal(copied.length, 2);
  assert.deepEqual(copied[0], cloud);
  assert.notEqual(copied[0].id, copied[1].id);
  const editedDefault = { ...starterProfiles[0], generic: "Admin-defined generic" };
  assert.equal(reconcileBrandPairs([editedDefault], []).filter(p => p.id === "tofen").length, 1);
  assert.equal(reconcileBrandPairs([editedDefault], []).find(p => p.id === "tofen")?.generic, "Admin-defined generic");
});
test("library search matches brand and generic across case and whitespace with clear/unmatched states", () => {
  assert.equal(searchBrandPairs(starterProfiles, " tOfEn ")[0].id, "tofen");
  assert.equal(searchBrandPairs(starterProfiles, "ketotifen")[0].brand, "TOFEN");
  assert.equal(searchBrandPairs([fresh], "new   generic").length, 1);
  assert.equal(searchBrandPairs(starterProfiles, "unknown").length, 0);
  assert.deepEqual(searchBrandPairs(starterProfiles, ""), starterProfiles);
});

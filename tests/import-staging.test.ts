import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { stageFacts, stagedChunks, importFactBatches, clearStagedImport } from "../src/import-staging";
import { emptyWorkspace, type Dataset, type RxFact } from "../src/types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const fact = (i: number): RxFact => ({ date: i % 3 ? "2026-07-01" : "2026-06-01", generic: i % 2 ? "Tramadol Hydrochloride" : "Paracetamol+Tramadol Hydrochloride", brand: i % 2 ? "OTHER" : "NAPADOL", doctorCode: "D" + i, doctorName: "Test", specialty: "Medicine", company: "Test", form: "TAB", acdRegion: "D5", acdMpe: "D501", ccdRegion: "D6", ccdMpe: "D601", count: i % 5 + 1, sourceRow: i + 2, sheet: "TRD" });
const dataset = (id: string, count: number): Dataset => ({ id, name: "July.xlsx", hash: id, active: true, importedAt: "2026-10-17", from: "2026-06-01", to: "2026-07-31", rows: count, invalidRows: 0, sheets: ["TRD"], catalog: [], includedGenerics: ["Tramadol Hydrochloride", "Paracetamol+Tramadol Hydrochloride"], facts: [], stagedImportId: id, stagedFactCount: count });

test("staged imports preserve every record across pages and isolate months, markets and jobs", async () => {
  const id = crypto.randomUUID(), other = crypto.randomUUID();
  const expected = new Map<string, number>();
  let sequence = 0;
  try {
    for (let i = 0; i < 9200; i += 100) {
      const facts = Array.from({ length: 100 }, (_, n) => fact(i + n));
      for (const f of facts) expected.set(f.doctorCode, f.count);
      sequence = await stageFacts(id, sequence, facts);
    }
    await stageFacts(other, 0, [fact(99999)]);
    let total = 0;
    const seen = new Map<string, number>();
    for await (const batch of importFactBatches(dataset(id, 9200))) {
      assert.ok(batch.payload.length > 0 && batch.payload.length <= 1000);
      for (const f of batch.payload) {
        assert.equal(f.generic.toUpperCase(), batch.generic);
        assert.equal(f.date.slice(0, 7), batch.month);
        assert.ok(!seen.has(f.doctorCode), "pagination must not duplicate records");
        seen.set(f.doctorCode, f.count); total += f.count;
      }
    }
    assert.deepEqual(seen, expected);
    assert.equal(total, [...expected.values()].reduce((a, b) => a + b, 0));
    await clearStagedImport(id);
    let remaining = 0, unrelated = 0;
    for await (const chunk of stagedChunks(id)) { remaining++; }
    for await (const chunk of stagedChunks(other)) { unrelated++; }
    assert.equal(remaining, 0);
    assert.equal(unrelated, 1);
  } finally { await clearStagedImport(id); await clearStagedImport(other); }
});

test("cloud uploads stream staged chunks, strip device handoffs and never finish incomplete imports", async () => {
  const output = await mkdtemp(join(tmpdir(), "rxm-stream-save-"));
  try {
    await build({ logLevel: "silent", define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://rx-project.test"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("public-test-key") }, build: { outDir: output, lib: { entry: new URL("../src/storage.ts", import.meta.url).pathname, formats: ["es"], fileName: () => "storage.mjs" }, minify: false } });
    const { cloudSave, supabase } = await import(pathToFileURL(join(output, "storage.mjs")).href);
    supabase.auth.getUser = async () => ({ data: { user: { id: "test-user" } }, error: null });
    for (const scenario of ["success", "missing", "network-error"]) {
      const id = crypto.randomUUID();
      const facts = Array.from({ length: 2105 }, (_, i) => ({ ...fact(i), date: "2026-07-01", generic: "Tramadol Hydrochloride" }));
      await stageFacts(id, 0, facts);
      const d = dataset(id, scenario === "missing" ? 2106 : 2105);
      const inserts: { table: string; row: any }[] = [], rpcs: string[] = [];
      supabase.from = (table: string) => ({
        insert: async (row: any) => {
          inserts.push({ table, row });
          return { error: scenario === "network-error" && table === "rxm_fact_chunks" ? { message: "Upload interrupted" } : null };
        },
        select() { return this; }, order() { return this; }, range: async () => ({ data: [], error: null }),
      });
      supabase.rpc = async (name: string) => { rpcs.push(name); return { data: null, error: null }; };
      const previous = emptyWorkspace();
      const next = { ...previous, datasets: [d] };
      try {
        if (scenario === "success") {
          await cloudSave(next, previous);
          const chunks = inserts.filter(v => v.table === "rxm_fact_chunks");
          assert.deepEqual(chunks.map(v => v.row.payload.length), [1000, 1000, 105]);
          assert.equal(chunks.flatMap(v => v.row.payload).reduce((n, f) => n + f.count, 0), facts.reduce((n, f) => n + f.count, 0));
          assert.ok(rpcs.includes("rxm_finish_import"));
          assert.ok(!rpcs.includes("rxm_cleanup_import"));
        } else {
          await assert.rejects(cloudSave(next, previous), scenario === "missing" ? /incomplete/ : /Upload interrupted/);
          assert.ok(!rpcs.includes("rxm_finish_import"));
          assert.ok(rpcs.includes("rxm_cleanup_import"));
        }
        const metadata = inserts.find(v => v.table === "rxm_datasets")!.row;
        assert.equal(metadata.active, false); assert.equal(metadata.complete, false);
        assert.equal(metadata.payload.stagedImportId, undefined);
        assert.equal(metadata.payload.stagedFactCount, undefined);
        assert.equal(metadata.payload.facts, undefined);
        assert.equal(d.facts.length, 0, "full upload never needs to enter the reporting state");
      } finally { await clearStagedImport(id); }
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});

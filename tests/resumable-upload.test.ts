import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { stageFacts, clearStagedImport } from "../src/import-staging";
import { prepareUpload, runUpload, saveUploadJob, loadUploadJobs, UploadRequestError, UPLOAD_REQUEST_BYTES, type UploadJob, type UploadTransport } from "../src/upload";
import type { RxFact, Dataset } from "../src/types";
Object.assign(globalThis, { indexedDB, IDBKeyRange });
const fact = (i: number): RxFact => ({ date: '2026-07-01', generic: 'GENERIC ' + i % 60, brand: 'Brand', company: 'Test', form: 'TAB', doctorCode: 'D' + i, doctorName: 'Test ڈاکٹر বাংলা 😀'.repeat(5), specialty: 'Medicine', acdRegion: 'D5', acdMpe: 'D501', ccdRegion: 'D6', ccdMpe: 'D601', count: i % 3 + 1, sourceRow: i + 2, sheet: 'TRD' });
async function job(count = 6000): Promise<UploadJob> {
  const id = crypto.randomUUID();
  let sequence = 0;
  for (let i = 0; i < count; i += 500) sequence = await stageFacts(id, sequence, Array.from({ length: Math.min(500, count - i) }, (_, n) => fact(i + n)));
  const source: Dataset = { id: crypto.randomUUID(), stagedImportId: id, name: 'July.xlsx', hash: 'test-' + id, from: '2026-07-01', to: '2026-07-31', importedAt: new Date().toISOString(), active: false, sheets: ['TRD'], rows: count, invalidRows: 0, catalog: [], facts: [] };
  return { id, source, ownerId: 'test-owner', manifest: await prepareUpload(source), createdAt: new Date().toISOString() };
}
const instant = async () => {};

test('packets combine markets, respect UTF-8 byte caps and use at most two in-flight requests', async () => {
  const j = await job(); let active = 0, peak = 0, requests = 0, finished = false;
  const saved = new Set<number>(), views: number[] = [];
  try {
    await runUpload(j, {
      begin: async () => ({ complete: false, uploaded: [] }),
      send: async (_job, parts) => {
        requests++; active++; peak = Math.max(peak, active);
        assert.ok(new TextEncoder().encode(JSON.stringify({ dataset: j.source.id, parts })).length <= UPLOAD_REQUEST_BYTES);
        await new Promise(r => setTimeout(r, 100));
        for (const p of parts) { assert.ok(!saved.has(p.part)); saved.add(p.part); }
        active--;
      },
      finish: async () => { assert.equal(active, 0); assert.equal(saved.size, j.manifest.parts.length); finished = true; },
    }, new AbortController().signal, p => views.push(p.saved));
    assert.equal(peak, 2);
    assert.ok(requests < j.manifest.parts.length / 2, `${requests} requests for ${j.manifest.parts.length} generic parts`);
    assert.ok(views.every((v, i) => !i || v >= views[i - 1]));
    assert.equal(views.at(-1), 6000); assert.ok(finished);
  } finally { await clearStagedImport(j.id); }
});

test('pause and reopen resume acknowledged parts; lost responses retry idempotently', async () => {
  const j = await job(3000), acknowledged = new Map<number, string>();
  const controller = new AbortController(); let finishes = 0, loseResponse = true, resumedRequests = 0;
  try {
    await saveUploadJob(j);
    assert.equal((await loadUploadJobs(j.ownerId))[0].id, j.id);
    const transport: UploadTransport = {
      begin: async () => ({ complete: false, uploaded: [...acknowledged].map(([part, hash]) => ({ part, hash })) }),
      send: async (_job, parts) => {
        for (const p of parts) acknowledged.set(p.part, j.manifest.parts[p.part].hash);
        if (loseResponse) { loseResponse = false; controller.abort(); throw new UploadRequestError('Lost response'); }
      },
      finish: async () => { finishes++; },
    };
    await assert.rejects(runUpload(j, transport, controller.signal, () => {}, instant), { name: 'AbortError' });
    assert.equal(finishes, 0); assert.ok(acknowledged.size > 0);
    const previouslySaved = new Set(acknowledged.keys());
    const resumed = (await loadUploadJobs(j.ownerId))[0];
    await runUpload(resumed, { ...transport, send: async (_job, parts) => { resumedRequests++; for (const p of parts) { assert.ok(!previouslySaved.has(p.part)); acknowledged.set(p.part, j.manifest.parts[p.part].hash); } } }, new AbortController().signal, () => {}, instant);
    assert.equal(acknowledged.size, j.manifest.parts.length); assert.equal(finishes, 1); assert.ok(resumedRequests > 0);
  } finally { await clearStagedImport(j.id); }
});

test('transient errors retry with backoff; permanent errors and mismatched checkpoints never activate', async () => {
  const j = await job(500); let sends = 0, finishes = 0; const waits: number[] = [];
  const base: UploadTransport = { begin: async () => ({ complete: false, uploaded: [] }), send: async () => { if (++sends < 3) throw new UploadRequestError('Busy', 503); }, finish: async () => { finishes++; } };
  try {
    await runUpload(j, base, new AbortController().signal, () => {}, async n => { waits.push(n); });
    assert.deepEqual(waits, [1000, 2000]); assert.equal(finishes, 1);
    finishes = 0;
    await assert.rejects(runUpload(j, { ...base, send: async () => { throw new UploadRequestError('Sign in again', 401); } }, new AbortController().signal, () => {}, instant), /Sign in again/);
    assert.equal(finishes, 0);
    await assert.rejects(runUpload(j, { ...base, begin: async () => ({ complete: false, uploaded: [{ part: 0, hash: 'wrong' }] }) }, new AbortController().signal, () => {}, instant), /does not match/);
    assert.equal(finishes, 0);
  } finally { await clearStagedImport(j.id); }
});

test('preparing a narrowed scope keeps all Rx counts, and completed uploads send nothing', async () => {
  const j = await job(500);
  try {
    const selected = { ...j.source, includedGenerics: ['GENERIC 1'] };
    const m = await prepareUpload(selected);
    assert.equal(m.records, 9); assert.equal(m.rx, 18); assert.ok(m.parts.every(p => p.generic === 'GENERIC 1'));
    await runUpload(j, { begin: async () => ({ complete: true, uploaded: [] }), send: async () => assert.fail('must not upload twice'), finish: async () => assert.fail('already complete') }, new AbortController().signal, () => {});
  } finally { await clearStagedImport(j.id); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createAnalyticsLoader } from '../src/analytics-loader';
import { createAnalyticsCache, type AnalyticsCacheEntry } from '../src/analytics-cache';
import { demoWorkspace } from '../src/demo';
import type { Dataset, RxFact } from '../src/types';

globalThis.indexedDB = new IDBFactory();
const source = (patch: Partial<Dataset> = {}): Dataset => ({ ...demoWorkspace().datasets[0], id: 'source', hash: 'v1', importedAt: '2026-10-01', from: '2026-06-01', to: '2026-07-31', active: true, facts: [], ...patch });
const fact = (patch: Partial<RxFact> = {}): RxFact => ({ date: '2026-06-01', doctorCode: 'D1', doctorName: 'One', specialty: 'MEDICINE', generic: 'Bilastine', brand: 'BILLI', company: 'BEXIMCO', form: 'TAB', strength: '20 MG', acdRegion: 'A1', acdMpe: 'A11', ccdRegion: 'C1', ccdMpe: 'C11', count: 1, sheet: 'TRD', sourceRow: 1, ...patch });
const chunk = (id: number, month = '2026-06', payload = [fact({ date: month + '-01' })]) => ({ id, dataset_id: 'source', month, payload });
function fixture(rows = [chunk(1)], delay = 0) {
  let requests = 0, active = 0, peak = 0, manifestCalls = 0;
  const requested: number[] = [];
  const reader = {
    async manifest(ids: string[], months: string[], cursor: number) {
      manifestCalls++;
      // Deliberately lower than 1,000: server-side caps must not truncate data.
      return rows.filter(c => ids.includes(c.dataset_id) && months.includes(c.month) && c.id > cursor).slice(0, 7);
    },
    async chunks(ids: number[]) {
      requests++; requested.push(...ids); active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, delay)); active--;
      return rows.filter(c => ids.includes(c.id)).reverse();
    },
  };
  return { reader, requested, stats: () => ({ requests, peak, manifestCalls }) };
}
const load = (loader: ReturnType<typeof createAnalyticsLoader>, from = '2026-06', to = from, owner = 'user-a', datasets = [source()], signal = new AbortController().signal) => loader.load(datasets, from, to, signal, () => {}, owner);
const cache = () => createAnalyticsCache('test-' + crypto.randomUUID());

test('first load runs three requests together, handles capped manifests, and preserves every Rx', async () => {
  const f = fixture(Array.from({ length: 77 }, (_, i) => chunk(i + 1)), 2);
  const loader = createAnalyticsLoader(f.reader, cache());
  const result = await load(loader);
  assert.equal(f.stats().peak, 3);
  assert.equal(f.stats().requests, 7);
  assert.equal(result[0].facts[0].count, 77);
  assert.equal(result[0].facts[0].dailyCounts!['2026-06-01'], 77);
  assert.equal(new Set(f.requested).size, 77);
});

test('monthly cache reuses overlapping ranges without fetching a loaded month again', async () => {
  const f = fixture([chunk(1), chunk(2, '2026-07')]), loader = createAnalyticsLoader(f.reader, cache());
  await load(loader);
  const range = await load(loader, '2026-06', '2026-07');
  assert.equal(range[0].facts.length, 2); assert.deepEqual(f.requested, [1, 2]);
  const calls = f.stats();
  await load(loader, '2026-07'); await load(loader); await load(loader, '2026-06', '2026-07');
  assert.deepEqual(f.stats(), calls);
});

test('cached aggregates preserve doctor identity, strength, specialty, daily dates and independent ACD/CCD assignments', async () => {
  const rows = [fact({ count: 2, sourceRows: [1, 2] }), fact({ date: '2026-06-10', doctorName: 'Updated', count: 3 }), fact({ ccdRegion: '', count: 7 }), fact({ strength: '10 MG', count: 11 }), fact({ specialty: 'ENT', count: 13 })];
  const f = fixture([chunk(1, '2026-06', rows)]), loader = createAnalyticsLoader(f.reader, cache());
  const result = (await load(loader))[0].facts;
  assert.equal(result.length, 4); assert.equal(result.reduce((sum, r) => sum + r.count, 0), 36);
  assert.equal(result[0].doctorName, 'Updated'); assert.equal(result[0].count, 5);
  assert.deepEqual(result[0].dailyCounts, { '2026-06-01': 2, '2026-06-10': 3 });
  assert.equal(result[0].sourceRows, undefined);
});

test('disk cache survives loader recreation and account/source versions are isolated', async () => {
  const name = 'persist-' + crypto.randomUUID(), disk = createAnalyticsCache(name), f = fixture();
  const first = createAnalyticsLoader(f.reader, disk); await load(first);
  // A read of an absent key drains queued persistence before simulating a reload.
  await disk.get('flush');
  const next = createAnalyticsLoader(f.reader, createAnalyticsCache(name)); await load(next);
  assert.equal(f.stats().requests, 1);
  await load(next, '2026-06', '2026-06', 'user-b'); assert.equal(f.stats().requests, 2);
  await load(next, '2026-06', '2026-06', 'user-a', [source({ hash: 'v2' })]); assert.equal(f.stats().requests, 3);
  await load(next, '2026-06', '2026-06', 'user-a', [source({ importedAt: '2026-10-02' })]); assert.equal(f.stats().requests, 4);
  await first.clear();
  await load(createAnalyticsLoader(f.reader, createAnalyticsCache(name))); assert.equal(f.stats().requests, 5);
});

test('aborted or cleared in-flight loads cannot publish or cache results', async () => {
  for (const invalidate of ['abort', 'clear']) {
    const f = fixture(), disk = cache();
    let release!: () => void, started!: () => void;
    const start = new Promise<void>(r => { started = r; });
    const pause = new Promise<void>(r => { release = r; });
    const loader = createAnalyticsLoader({ ...f.reader, chunks: async ids => { started(); await pause; return f.reader.chunks(ids); } }, disk);
    const controller = new AbortController();
    const pending = load(loader, '2026-06', '2026-06', 'user-a', [source()], controller.signal);
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    await start;
    if (invalidate === 'abort') controller.abort(); else await loader.clear();
    release(); await rejection;
    await load(loader); assert.equal(f.stats().requests, 2);
  }
});

test('missing chunks fail visibly and partial results are not cached', async () => {
  const f = fixture([chunk(1), chunk(2)]), disk = cache();
  const broken = createAnalyticsLoader({ ...f.reader, chunks: async () => [chunk(1)] }, disk);
  await assert.rejects(load(broken), /Source data changed/);
  const fixed = createAnalyticsLoader(f.reader, disk);
  const result = await load(fixed); assert.deepEqual(f.requested, [1, 2]); assert.equal(result[0].facts[0].count, 2);
});

test('inactive and out-of-range sources are excluded even when cached', async () => {
  const f = fixture(), loader = createAnalyticsLoader(f.reader, cache()); await load(loader);
  assert.deepEqual(await load(loader, '2026-06', '2026-06', 'user-a', [source({ active: false })]), []);
  assert.deepEqual(await load(loader, '2026-08'), []);
  assert.equal(f.stats().requests, 1);
});

test('unavailable IndexedDB falls back to network and in-memory reuse', async () => {
  const original = globalThis.indexedDB;
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  try {
    const f = fixture(), loader = createAnalyticsLoader(f.reader, cache());
    await load(loader); await load(loader); assert.equal(f.stats().requests, 1);
  } finally { globalThis.indexedDB = original; }
});

test('cache bounds entries and clear removes saved doctor data', async () => {
  const disk = cache(), entry: AnalyticsCacheEntry = { facts: [fact()], count: 1 };
  for (let i = 0; i < 26; i++) { await disk.put(String(i), entry); await new Promise(r => setTimeout(r, 1)); }
  assert.equal(await disk.get('0'), undefined); assert.equal((await disk.get('25'))?.count, 1);
  await disk.clear(); assert.equal(await disk.get('25'), undefined);
});

test('last complete selection stays instant even when a partition cannot be persisted', async () => {
  const f = fixture(), loader = createAnalyticsLoader(f.reader, {
    get: async () => undefined, put: async () => {}, clear: async () => {},
  });
  const first = await load(loader);
  const next = await load(loader, '2026-06', '2026-06', 'user-a', [source({ name: 'Updated metadata' })]);
  assert.equal(f.stats().requests, 1); assert.equal(next[0].facts, first[0].facts);
  assert.equal(next[0].name, 'Updated metadata');
  await loader.clear(); await load(loader); assert.equal(f.stats().requests, 2);
});

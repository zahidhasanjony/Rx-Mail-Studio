import { performance } from 'node:perf_hooks';
import { IDBFactory } from 'fake-indexeddb';
import { createAnalyticsLoader } from '../src/analytics-loader';
import { createAnalyticsCache } from '../src/analytics-cache';
import { demoWorkspace } from '../src/demo';
import type { RxFact } from '../src/types';

globalThis.indexedDB = new IDBFactory();
const records = 43_118;
const facts: RxFact[] = Array.from({length: records}, (_, i) => ({
  date: `2026-06-${String(1 + i % 30).padStart(2, '0')}`, generic: 'Bilastine', brand: i % 4 ? 'OTHER' : 'BILLI', company: i % 4 ? 'OTHER' : 'BEXIMCO',
  form: 'TAB', strength: '20 MG', doctorCode: String(i), doctorName: `Doctor ${i}`, specialty: 'MEDICINE',
  acdRegion: 'A1', acdAse: 'A10', acdMpe: 'A11', ccdRegion: 'C1', ccdAse: 'C10', ccdMpe: 'C11', count: 1, sheet: 'TRD', sourceRow: i,
}));
const source = {...demoWorkspace().datasets[0], id: 'benchmark', hash: 'synthetic', active: true, from: '2026-06-01', to: '2026-06-30', facts: []};
const chunks = Array.from({length: Math.ceil(records / 500)}, (_, i) => ({id: i + 1, dataset_id: source.id, month: '2026-06', payload: facts.slice(i * 500, (i + 1) * 500)}));
let requests = 0;
const reader = {
  async manifest(ids: string[], months: string[], cursor: number) { requests++; return chunks.filter(c => c.id > cursor).map(({id, dataset_id, month}) => ({id, dataset_id, month})); },
  async chunks(ids: number[]) { requests++; return chunks.filter(c => ids.includes(c.id)); },
};
const name = 'benchmark-' + crypto.randomUUID(), cache = createAnalyticsCache(name), loader = createAnalyticsLoader(reader, cache);
const run = (l = loader) => l.load([source], '2026-06', '2026-06', new AbortController().signal, () => {}, 'benchmark-account');
let start = performance.now(); await run(); const coldMs = performance.now() - start;
const coldRequests = requests;
const samples: number[] = [];
for (let i = 0; i < 10; i++) { start = performance.now(); await run(); samples.push(performance.now() - start); }
await cache.get('drain-persistence');
const reload = createAnalyticsLoader(reader, createAnalyticsCache(name));
start = performance.now(); await run(reload); const diskMs = performance.now() - start;
console.log(JSON.stringify({records, coldAggregationMs: Math.round(coldMs), warmMedianMs: +samples.sort((a,b) => a-b)[5].toFixed(2), simulatedDiskRestoreMs: +diskMs.toFixed(2), coldRequests, cachedRequests: requests - coldRequests, note: 'Synthetic records in Node; fake IndexedDB. No real network, browser render, phone, or live database timing included.'}, null, 2));
await loader.clear();

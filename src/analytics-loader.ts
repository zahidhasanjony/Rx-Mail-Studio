import type { Dataset, RxFact } from './types';
import { reportingMonths } from './reporting';
import { normalize } from './engine';
import { normalizePreparation } from './preparations';
import { strengthKey } from './analytics-model';
import { createAnalyticsCache, type AnalyticsCacheEntry } from './analytics-cache';

interface ChunkRef { id: number; dataset_id: string; month: string }
interface Chunk extends ChunkRef { payload: RxFact[] }
interface Reader {
  manifest(ids: string[], months: string[], cursor: number, signal: AbortSignal): Promise<ChunkRef[]>;
  chunks(ids: number[], signal: AbortSignal): Promise<Chunk[]>;
}
const partitionKey = (id: string, month: string) => JSON.stringify([id, month]);

function aggregate(group: Map<string, RxFact>, f: RxFact) {
  // Preserve the original dimensions and daily counts. ACD and CCD are never added together.
  const key = JSON.stringify([f.date.slice(0, 7), normalize(f.doctorCode), normalize(f.generic), normalize(f.brand), normalize(f.company), normalizePreparation(f.form), strengthKey(f.strength), normalize(f.specialty), f.acdRegion, f.acdAse, f.acdMpe, f.ccdRegion, f.ccdAse, f.ccdMpe]);
  const previous = group.get(key);
  if (previous) {
    previous.count += f.count;
    previous.dailyCounts![f.date] = (previous.dailyCounts![f.date] || 0) + f.count;
    if (f.date > previous.date) { previous.date = f.date; previous.doctorName = f.doctorName; }
  } else group.set(key, {
    date: f.date, generic: f.generic, brand: f.brand, company: f.company, form: f.form, strength: f.strength,
    doctorCode: f.doctorCode, doctorName: f.doctorName, specialty: f.specialty,
    acdRegion: f.acdRegion, acdAse: f.acdAse, acdMpe: f.acdMpe,
    ccdRegion: f.ccdRegion, ccdAse: f.ccdAse, ccdMpe: f.ccdMpe,
    count: f.count, dailyCounts: { [f.date]: f.count }, sourceRow: 0, sheet: '',
  });
}

export function createAnalyticsLoader(reader: Reader, cache = createAnalyticsCache()) {
  let generation = 0;
  // Keep the current complete selection even when it exceeds the disk-cache
  // budget. Reopening that selection must retain the old loader's fast path.
  let last: { key: string; facts: Map<string, RxFact[]> } | undefined;
  return {
    clear() { generation++; last = undefined; return cache.clear(); },
    async load(datasets: Dataset[], from: string, to: string, signal: AbortSignal, progress: (count: number) => void, owner: string): Promise<Dataset[]> {
      const currentGeneration = generation;
      const check = () => { if (signal.aborted || generation !== currentGeneration) throw new DOMException('Cancelled', 'AbortError'); };
      check();
      const sources = datasets.filter(d => d.active && d.from.slice(0, 7) <= to && d.to.slice(0, 7) >= from);
      const months = reportingMonths(from, to);
      const parts = sources.flatMap(d => months.filter(m => m >= d.from.slice(0, 7) && m <= d.to.slice(0, 7)).map(month => ({
        id: d.id, month, key: partitionKey(d.id, month),
        cacheKey: JSON.stringify(['v1', owner, d.id, d.hash, d.importedAt, d.from, d.to, month]),
      })));
      const selectionKey = JSON.stringify([owner, from, to, parts.map(p => p.cacheKey)]);
      if (last?.key === selectionKey) return sources.map(d => ({ ...d, facts: last!.facts.get(d.id) || [] }));
      const completed = new Map<string, AnalyticsCacheEntry>();
      await Promise.all(parts.map(async p => { const entry = await cache.get(p.cacheKey); check(); if (entry) completed.set(p.key, entry); }));
      check();
      let count = [...completed.values()].reduce((sum, entry) => sum + entry.count, 0);
      progress(count);
      const missing = parts.filter(p => !completed.has(p.key));
      if (missing.length) {
        const groups = new Map(missing.map(p => [p.key, new Map<string, RxFact>()]));
        const counts = new Map<string, number>();
        const ids = [...new Set(missing.map(p => p.id))], neededMonths = [...new Set(missing.map(p => p.month))];
        const manifest: ChunkRef[] = [];
        let cursor = 0;
        // Small IDs first; payload requests no longer wait for the previous payload.
        // Continue to an empty page even when the server imposes a lower row limit.
        while (true) {
          const page = await reader.manifest(ids, neededMonths, cursor, signal); check();
          if (!page.length) break;
          const next = page.at(-1)!.id;
          if (next <= cursor) throw new Error('Analysis pagination did not advance. Retry analysis.');
          manifest.push(...page.filter(c => groups.has(partitionKey(c.dataset_id, c.month))));
          cursor = next;
        }
        // Three bounded requests at once, even for one month. Process in ID order
        // so ties retain the same doctor name as the former loader.
        for (let start = 0; start < manifest.length; start += 36) {
          const window = manifest.slice(start, start + 36);
          const requests: Promise<Chunk[]>[] = [];
          for (let i = 0; i < window.length; i += 12) requests.push(reader.chunks(window.slice(i, i + 12).map(c => c.id), signal));
          const received = (await Promise.all(requests)).flat(); check();
          const byId = new Map(received.map(c => [c.id, c]));
          for (const expected of window) {
            const chunk = byId.get(expected.id);
            if (!chunk || chunk.dataset_id !== expected.dataset_id || chunk.month !== expected.month || !Array.isArray(chunk.payload))
              throw new Error('Source data changed while loading. Refresh the workspace and retry analysis.');
            const key = partitionKey(chunk.dataset_id, chunk.month), group = groups.get(key)!;
            for (const fact of chunk.payload) aggregate(group, fact);
            counts.set(key, (counts.get(key) || 0) + chunk.payload.length);
            count += chunk.payload.length;
            check();
          }
          progress(count);
          await new Promise<void>(resolve => setTimeout(resolve, 0)); check();
        }
        // Cache only complete results. Errors/cancellation cannot poison later loads.
        for (const p of missing) {
          const entry = { facts: [...groups.get(p.key)!.values()], count: counts.get(p.key) || 0 };
          completed.set(p.key, entry);
          void cache.put(p.cacheKey, entry);
        }
      }
      check();
      const result = sources.map(d => ({ ...d, facts: parts.filter(p => p.id === d.id).flatMap(p => completed.get(p.key)!.facts) }));
      last = { key: selectionKey, facts: new Map(result.map(d => [d.id, d.facts])) };
      return result;
    },
  };
}

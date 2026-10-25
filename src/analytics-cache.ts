import type { RxFact } from './types';

export interface AnalyticsCacheEntry { facts: RxFact[]; count: number }
const MAX_ROWS = 250_000, MAX_ENTRIES = 24, MAX_AGE = 7 * 24 * 60 * 60 * 1000;
interface Metadata { key: string; rows: number; saved: number }

// Disposable cache, separate from device-mode source files. Storage failures must
// not block cloud reads (private browsing, quota, or blocked upgrades).
export function createAnalyticsCache(name = 'rxm-analytics-v1') {
  const memory = new Map<string, AnalyticsCacheEntry>();
  let connection: Promise<IDBDatabase | undefined> | undefined;
  let writes = Promise.resolve();
  let generation = 0;
  function open() {
    if (!connection) connection = new Promise<IDBDatabase | undefined>(resolve => {
      if (typeof indexedDB === 'undefined') { resolve(undefined); return; }
      let finished = false;
      const finish = (db?: IDBDatabase) => { if (finished) { db?.close(); return; } finished = true; clearTimeout(timer); resolve(db); };
      const timer = setTimeout(() => finish(), 500);
      try {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('entries'); r.result.createObjectStore('metadata', { keyPath: 'key' }); };
        r.onsuccess = () => finish(r.result);
        r.onerror = r.onblocked = () => finish();
      } catch { finish(); }
    });
    return connection;
  }
  function remember(key: string, entry: AnalyticsCacheEntry) {
    if (entry.facts.length > MAX_ROWS) return;
    memory.delete(key); memory.set(key, entry);
    let rows = [...memory.values()].reduce((sum, v) => sum + v.facts.length, 0);
    for (const [oldKey, old] of memory) {
      if (rows <= MAX_ROWS && memory.size <= MAX_ENTRIES) break;
      memory.delete(oldKey); rows -= old.facts.length;
    }
  }
  function enqueue(work: (db: IDBDatabase) => Promise<void>) {
    writes = writes.then(async () => { const db = await open(); if (db) await work(db); }).catch(() => {});
    return writes;
  }
  return {
    async get(key: string): Promise<AnalyticsCacheEntry | undefined> {
      const currentGeneration = generation;
      const cached = memory.get(key);
      if (cached) { memory.delete(key); memory.set(key, cached); return cached; }
      await writes;
      const db = await open();
      if (!db) return undefined;
      try {
        const meta = await new Promise<Metadata | undefined>((resolve, reject) => {
          const r = db.transaction('metadata').objectStore('metadata').get(key);
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        if (!meta || Date.now() - meta.saved > MAX_AGE) return undefined;
        const entry = await new Promise<AnalyticsCacheEntry | undefined>((resolve, reject) => {
          const r = db.transaction('entries').objectStore('entries').get(key);
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        if (generation !== currentGeneration) return undefined;
        if (entry) remember(key, entry);
        return entry;
      } catch { return undefined; }
    },
    put(key: string, entry: AnalyticsCacheEntry) {
      remember(key, entry);
      if (entry.facts.length > MAX_ROWS) return Promise.resolve();
      return enqueue(db => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['entries', 'metadata'], 'readwrite');
        const entries = tx.objectStore('entries'), metadata = tx.objectStore('metadata');
        entries.put(entry, key);
        metadata.put({ key, rows: entry.facts.length, saved: Date.now() } satisfies Metadata);
        const all = metadata.getAll();
        all.onsuccess = () => {
          const records = (all.result as Metadata[]).sort((a, b) => b.saved - a.saved);
          let rows = 0, count = 0;
          for (const record of records) {
            rows += record.rows; count++;
            if (rows > MAX_ROWS || count > MAX_ENTRIES || Date.now() - record.saved > MAX_AGE) {
              entries.delete(record.key); metadata.delete(record.key);
            }
          }
        };
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
      }));
    },
    clear() {
      generation++;
      memory.clear();
      return enqueue(db => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['entries', 'metadata'], 'readwrite');
        tx.objectStore('entries').clear(); tx.objectStore('metadata').clear();
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
      }));
    },
  };
}

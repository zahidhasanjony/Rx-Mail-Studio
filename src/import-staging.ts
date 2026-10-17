import type { Dataset, RxFact } from "./types";

interface StagedChunk {
  importId: string;
  generic: string;
  month: string;
  sequence: number;
  payload: RxFact[];
}
type ChunkKey = [string, string, string, number];

export async function stagingDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("rx-mail-studio-imports", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chunks", { keyPath: ["importId", "generic", "month", "sequence"] });
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

// A separate DB avoids blocking an older app tab that still has the raw
// staging database open while uploading.
export async function uploadDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("rx-mail-studio-upload-jobs", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("parts", { keyPath: ["importId", "part"] });
      request.result.createObjectStore("jobs", { keyPath: "id" });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close older app tabs and try again."));
  });
}

// Keep the large import on device storage. The worker and main thread exchange
// metadata only, rather than cloning a full month's prescription objects.
export async function stageFacts(importId: string, sequence: number, facts: RxFact[]) {
  const groups = new Map<string, RxFact[]>();
  for (const fact of facts) {
    const key = JSON.stringify([fact.generic.trim().replace(/\s+/g, " ").toUpperCase(), fact.date.slice(0, 7)]);
    const group = groups.get(key) || [];
    group.push(fact);
    groups.set(key, group);
  }
  const db = await stagingDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      for (const [key, payload] of groups) {
        const [generic, month] = JSON.parse(key);
        for (let i = 0; i < payload.length; i += 1000)
          store.put({ importId, generic, month, sequence: sequence++, payload: payload.slice(i, i + 1000) } satisfies StagedChunk);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Not enough device storage to prepare this import."));
    });
    return sequence;
  } finally { db.close(); }
}

export async function* stagedChunks(importId: string): AsyncGenerator<StagedChunk> {
  const db = await stagingDb();
  let after: ChunkKey | undefined;
  try {
    while (true) {
      const range = IDBKeyRange.bound(after || [importId], [importId, "\uffff"], !!after);
      const rows = await new Promise<StagedChunk[]>((resolve, reject) => {
        const request = db.transaction("chunks").objectStore("chunks").getAll(range, 16);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!rows.length) return;
      for (const row of rows) yield row;
      const last = rows[rows.length - 1];
      after = [last.importId, last.generic, last.month, last.sequence];
    }
  } finally { db.close(); }
}

export async function clearRawStaging(importId: string) {
  const db = await stagingDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      tx.objectStore("chunks").delete(IDBKeyRange.bound([importId], [importId, "\uffff"]));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function clearStagedImport(importId: string) {
  await clearRawStaging(importId);
  const uploads = await uploadDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = uploads.transaction(["parts", "jobs"], "readwrite");
      tx.objectStore("parts").delete(IDBKeyRange.bound([importId], [importId, Number.MAX_SAFE_INTEGER]));
      tx.objectStore("jobs").delete(importId);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { uploads.close(); }
}

export async function* importFactBatches(dataset: Dataset) {
  let buffer: RxFact[] = [], generic = "", month = "";
  if (dataset.stagedImportId) {
    const included = dataset.includedGenerics ? new Set(dataset.includedGenerics.map(g => g.trim().replace(/\s+/g, " ").toUpperCase())) : undefined;
    for await (const chunk of stagedChunks(dataset.stagedImportId)) {
      if (included && !included.has(chunk.generic)) continue;
      if (buffer.length && (generic !== chunk.generic || month !== chunk.month)) {
        yield { generic, month, payload: buffer };
        buffer = [];
      }
      generic = chunk.generic; month = chunk.month;
      for (const fact of chunk.payload) {
        buffer.push(fact);
        if (buffer.length === 1000) {
          yield { generic, month, payload: buffer };
          buffer = [];
        }
      }
    }
    if (buffer.length) yield { generic, month, payload: buffer };
    return;
  }
  const groups = new Map<string, RxFact[]>();
  for (const fact of dataset.facts) {
    const key = JSON.stringify([fact.date.slice(0, 7), fact.generic.trim().replace(/\s+/g, " ").toUpperCase()]);
    const group = groups.get(key) || [];
    group.push(fact); groups.set(key, group);
  }
  for (const [key, facts] of groups) {
    const [month, generic] = JSON.parse(key);
    for (let i = 0; i < facts.length; i += 1000)
      yield { generic, month, payload: facts.slice(i, i + 1000) };
  }
}

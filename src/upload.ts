import type { Dataset, RxFact } from "./types";
import { uploadDb, importFactBatches } from "./import-staging";

export interface UploadPartMeta { part: number; generic: string; month: string; hash: string; records: number; rx: number; bytes: number }
export interface UploadManifest { version: 1; records: number; rx: number; parts: UploadPartMeta[] }
export interface UploadJob { id: string; ownerId: string; source: Dataset; manifest: UploadManifest; createdAt: string; batchId?: string; batchIndex?: number }
export interface UploadPart { importId: string; part: number; payload_text: string }
export interface UploadPacketPart { part: number; payload: RxFact[] }
export interface UploadProgress { phase: "preparing" | "uploading" | "verifying" | "paused" | "failed" | "complete"; saved: number; total: number; percent: number; message?: string }
export interface UploadState { complete: boolean; uploaded: { part: number; hash: string }[] }
export interface UploadTransport {
  begin(job: UploadJob, signal: AbortSignal): Promise<UploadState>;
  send(job: UploadJob, parts: UploadPacketPart[], signal: AbortSignal): Promise<void>;
  finish(job: UploadJob, signal: AbortSignal): Promise<void>;
}
let encoder: TextEncoder | undefined;
const encodeText = (text: string) => (encoder ??= new TextEncoder()).encode(text);
export const UPLOAD_REQUEST_BYTES = 512 * 1024;
export const UPLOAD_PART_BYTES = 220 * 1024;
// An ordered array of known fact fields gives JS and Postgres the same digest
// without sending an escaped copy of the JSON text over the network.
const factFields: (keyof RxFact)[] = ["date","generic","brand","company","form","doctorCode","doctorName","specialty","acdRegion","acdMpe","acdAse","ccdRegion","ccdMpe","ccdAse","count","sourceRow","sourceRows","sheet"];
const arrayText = (value: unknown): string => Array.isArray(value) ? "[" + value.map(arrayText).join(", ") + "]" : JSON.stringify(value ?? null);
const hashUploadFacts = async (facts: RxFact[]) => {
  const text = arrayText(facts.map(f => factFields.map(key => f[key] ?? null)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encodeText(text)))).map(x => x.toString(16).padStart(2, "0")).join("");
};
export const hashUploadText = async (text: string) => hashUploadFacts(JSON.parse(text));

export async function saveUploadJobs(jobs: UploadJob[]) {
  const db = await uploadDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("jobs", "readwrite");
      for (const job of jobs) tx.objectStore("jobs").put(job);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function saveUploadJob(job: UploadJob) { await saveUploadJobs([job]); }
export async function loadUploadJobs(ownerId: string): Promise<UploadJob[]> {
  const db = await uploadDb();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("jobs").objectStore("jobs").getAll();
    request.onsuccess = () => resolve(request.result.filter((j: UploadJob) => j.ownerId === ownerId).sort((a: UploadJob, b: UploadJob) => a.batchId && a.batchId === b.batchId ? (a.batchIndex || 0) - (b.batchIndex || 0) : a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}

// Runs in the import worker. Only the small manifest is returned to the UI.
export async function prepareUpload(source: Dataset, onProgress: (done: number) => void = () => {}): Promise<UploadManifest> {
  if (!source.stagedImportId) throw new Error("Prepared data is missing. Select the workbook again.");
  const db = await uploadDb();
  const manifest: UploadManifest = { version: 1, records: 0, rx: 0, parts: [] };
  try {
    for await (const batch of importFactBatches(source)) {
      let values: string[] = [], bytes = 2, rx = 0;
      const flush = async () => {
        if (!values.length) return;
        const payload_text = "[" + values.join(",") + "]";
        const part = manifest.parts.length;
        const meta: UploadPartMeta = { part, month: batch.month, generic: batch.generic, hash: await hashUploadText(payload_text), records: values.length, rx, bytes };
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("parts", "readwrite");
          tx.objectStore("parts").put({ importId: source.stagedImportId!, part, payload_text } satisfies UploadPart);
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
        manifest.parts.push(meta); manifest.records += meta.records; manifest.rx += rx;
        onProgress(manifest.records); values = []; bytes = 2; rx = 0;
      };
      for (const fact of batch.payload) {
        const text = JSON.stringify(fact), size = encodeText(text).length;
        if (size + 2 > UPLOAD_PART_BYTES) throw new Error("A prescription record is too large to upload safely.");
        if (bytes + size + (values.length ? 1 : 0) > UPLOAD_PART_BYTES) await flush();
        values.push(text); bytes += size + (values.length > 1 ? 1 : 0); rx += fact.count;
      }
      await flush();
    }
    if (!manifest.records) throw new Error("No prescription data was prepared for the selected markets.");
    return manifest;
  } finally { db.close(); }
}

async function* packets(job: UploadJob, acknowledged: Set<number>) {
  const db = await uploadDb();
  let group: UploadPacketPart[] = [], bytes = 2;
  try {
    for (const meta of job.manifest.parts) {
      if (acknowledged.has(meta.part)) continue;
      const row = await new Promise<UploadPart | undefined>((resolve, reject) => {
        const request = db.transaction("parts").objectStore("parts").get([job.id, meta.part]);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (!row) throw new Error("Prepared data is unavailable on this device. Discard this upload and select the original workbook again.");
      const payload = JSON.parse(row.payload_text) as RxFact[];
      if (await hashUploadFacts(payload) !== meta.hash) throw new Error("Prepared data is damaged. Discard this upload and select the original workbook again.");
      const value = { part: row.part, payload }, size = encodeText(JSON.stringify(value)).length;
      if (size + 2 > UPLOAD_REQUEST_BYTES) throw new Error("An upload batch exceeds the request limit.");
      if (group.length && (bytes + size + 1 > UPLOAD_REQUEST_BYTES - 128 || group.length === 64)) { yield group; group = []; bytes = 2; }
      group.push(value); bytes += size + 1;
    }
    if (group.length) yield group;
  } finally { db.close(); }
}

export const uploadPaused = () => new DOMException("Upload paused", "AbortError");
export class UploadRequestError extends Error { constructor(message: string, public status = 0) { super(message); } }
const retryable = (e: unknown) => e instanceof UploadRequestError && (e.status === 0 || [408, 429, 500, 502, 503, 504].includes(e.status));
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(uploadPaused()); return; }
  const onAbort = () => { clearTimeout(timer); reject(uploadPaused()); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
});

export async function runUpload(job: UploadJob, transport: UploadTransport, signal: AbortSignal, onProgress: (p: UploadProgress) => void, wait = delay) {
  const state = await transport.begin(job, signal);
  if (state.complete) { onProgress({ phase: "complete", saved: job.manifest.records, total: job.manifest.records, percent: 100 }); return; }
  const acknowledged = new Set<number>();
  for (const row of state.uploaded) {
    if (job.manifest.parts[row.part]?.hash !== row.hash) throw new Error("The saved upload does not match this prepared file.");
    acknowledged.add(row.part);
  }
  let saved = [...acknowledged].reduce((n, part) => n + job.manifest.parts[part].records, 0), concurrency = 2, failure: unknown;
  const report = (phase: UploadProgress["phase"], message?: string) => onProgress({ phase, saved, total: job.manifest.records, percent: saved / job.manifest.records * 100, message });
  report("uploading");
  const pending = new Set<Promise<void>>();
  const send = async (parts: UploadPacketPart[]) => {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw uploadPaused();
      const start = performance.now();
      try {
        await transport.send(job, parts, signal);
        for (const p of parts) if (!acknowledged.has(p.part)) { acknowledged.add(p.part); saved += job.manifest.parts[p.part].records; }
        if (performance.now() - start > 8000) concurrency = 1;
        report("uploading"); return;
      } catch (error) {
        if (signal.aborted) throw uploadPaused();
        if (!retryable(error) || attempt >= 3) throw error;
        concurrency = 1;
        report("uploading", "Connection slowed. Retrying a saved batch…");
        await wait(1000 * 2 ** attempt, signal);
      }
    }
  };
  try {
    for await (const packet of packets(job, acknowledged)) {
      if (signal.aborted) throw uploadPaused();
      if (failure) throw failure;
      while (pending.size >= concurrency) { await Promise.race(pending); if (failure) throw failure; }
      const task = send(packet).catch(error => { failure = error; }).finally(() => pending.delete(task));
      pending.add(task);
    }
  } catch (error) { failure = error; }
  await Promise.all(pending);
  if (signal.aborted) throw uploadPaused();
  if (failure) throw failure;
  if (saved !== job.manifest.records) throw new Error("The upload is incomplete. Resume to send the remaining records.");
  report("verifying");
  await transport.finish(job, signal);
  report("complete");
}

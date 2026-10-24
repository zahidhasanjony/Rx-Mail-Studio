import { supabase, cloudCatalogue } from "./storage";
import { coversSource } from "./import-flow";
import type { Dataset } from "./types";
import { reconcileBrandPairs } from "./catalogue";
import { runUpload, UploadRequestError, type UploadJob, type UploadProgress, type UploadState } from "./upload";

export async function pendingCloudImports() {
  if (!supabase) return [];
  const user = await supabase.auth.getUser();
  if (user.error) throw user.error;
  if (!user.data.user) return [];
  const result = await supabase.from("rxm_datasets").select("id,name,imported_at").eq("complete", false).eq("imported_by", user.data.user.id).order("imported_at", { ascending: false });
  if (result.error) throw result.error;
  return result.data as { id: string; name: string; imported_at: string }[];
}
export async function discardCloudImport(dataset: string) {
  if (!supabase) throw new Error("Cloud connection missing");
  const result = await supabase.rpc("rxm_cleanup_import", { dataset });
  if (result.error) throw result.error;
}
export async function uploadCloudSource(job: UploadJob, signal: AbortSignal, onProgress: (p: UploadProgress) => void) {
  if (!supabase) throw new Error("Cloud connection missing");
  const client = supabase;
  const user = await client.auth.getUser();
  if (user.error || user.data.user?.id !== job.ownerId) throw new Error("Sign in with the account that prepared this upload.");
  const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const result = await client.rpc(name, args).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(45000)]));
    if (result.error) throw new UploadRequestError(result.error.message, result.status);
    return result.data;
  };
  const { facts, stagedImportId, stagedFactCount, ...metadata } = job.source;
  await runUpload(job, {
    begin: async (_job, signal) => await rpc("rxm_begin_upload", { source: { ...metadata, active: false }, manifest: job.manifest }, signal) as UploadState,
    send: async (_job, parts, signal) => { await rpc("rxm_upload_batch", { dataset: job.source.id, parts }, signal); },
    finish: async (_job, signal) => {
      // Resolve current overlaps at activation time, since another source may
      // have finished while this upload was paused.
      const rows = await client.from("rxm_datasets").select("id,from_date,to_date,payload").eq("active", true).lte("from_date", job.source.to).gte("to_date", job.source.from).abortSignal(signal);
      if (rows.error) throw new UploadRequestError(rows.error.message, rows.status);
      const partial = (rows.data || []).find(d => d.id !== job.source.id && !coversSource(job.source, d.payload || { ...job.source, from: d.from_date, to: d.to_date, dates: undefined }));
      if (partial) throw new Error("A saved source now contains dates or markets outside this file. Cancel this upload and review the complete replacement.");
      await rpc("rxm_finish_import", { dataset: job.source.id, replace_ids: (rows.data || []).filter(d => d.id !== job.source.id).map(d => d.id) }, signal);
    },
  }, signal, onProgress);
  const [sources, catalogue] = await Promise.all([
    client.from("rxm_datasets").select("id,active,payload").eq("complete", true).order("imported_at", { ascending: false }),
    cloudCatalogue(),
  ]);
  if (sources.error) throw sources.error;
  const datasets: Dataset[] = (sources.data || []).map(d => ({ ...d.payload, id: d.id, active: d.active, facts: [] }));
  return { datasets, ...catalogue, profiles: reconcileBrandPairs(catalogue.profiles, datasets, catalogue.deletedBrandPairs) };
}

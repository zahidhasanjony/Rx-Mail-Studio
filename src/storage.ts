import { createClient } from "@supabase/supabase-js";
import type { Dataset, Workspace, RxFact, BrandProfile } from "./types";
import { defaultSettings, emptyWorkspace, settingsForNewUser } from "./types";
import { reconcileBrandPairs, brandPairKey } from "./catalogue";
import { reportGenericNames } from "./markets";
import { reportingMonths } from "./reporting";
import { templateError } from "./email-template";
import type { EmailTemplate, Hierarchy } from "./types";
import { normalize, overlaps } from "./engine";
import { importFactBatches } from "./import-staging";
import type { DashboardRow } from './dashboard-model';
export async function cloudDashboard(from: string, to: string, signal: AbortSignal): Promise<DashboardRow[]> {
  if (!supabase) throw new Error('Cloud connection missing');
  const result = await supabase.rpc('rxm_dashboard', { from_month: from, to_month: to }).abortSignal(signal);
  if (result.error) throw new Error(result.error.message);
  return (result.data as [string, string, string, string, number][] || []).map(([tg, generic, brand, company, count]) => {
    const rx = Number(count);
    if (!Number.isSafeInteger(rx) || rx < 0) throw new Error('The dashboard returned an invalid Rx count.');
    return { tg, generic, brand, company, rx };
  });
}
export async function cloudDashboardTGs(signal: AbortSignal): Promise<string[]> {
  if (!supabase) throw new Error('Cloud connection missing');
  const result = await supabase.rpc('rxm_dashboard_tg_options').abortSignal(signal);
  if (result.error) throw new Error(result.error.message);
  return result.data as string[] || [];
}
export async function assignCloudDashboardTG(generic: string, brand: string, companies: string[], tg: string): Promise<void> {
  if (!supabase) throw new Error('Cloud connection missing');
  const result = await supabase.rpc('rxm_assign_dashboard_tg', { generic_name: generic, brand_name: brand, company_names: companies, target_tg: tg });
  if (result.error) throw new Error(result.error.message);
}
export const cloudConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const supabase = cloudConfigured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
  : null;
export type Mode = "local" | "cloud" | "demo";
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("rx-mail-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const mappingRecord = (value: unknown): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && !!v)) : {};
export async function localDashboardTGs(): Promise<Record<string, string>> {
  const d = await db();
  try { return await new Promise((resolve, reject) => {
    const request = d.transaction('workspace').objectStore('workspace').get('dashboard-tgs');
    request.onsuccess = () => resolve(mappingRecord(request.result)); request.onerror = () => reject(request.error);
  }); } finally { d.close(); }
}
export async function assignLocalDashboardTG(keys: string[], tg: string): Promise<Record<string, string>> {
  const d = await db();
  try { return await new Promise((resolve, reject) => {
    const tx = d.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace');
    const request = store.get('dashboard-tgs');
    let saved: Record<string, string>;
    request.onsuccess = () => { saved = { ...mappingRecord(request.result), ...Object.fromEntries(keys.map(key => [key, tg])) }; store.put(saved, 'dashboard-tgs'); };
    tx.oncomplete = () => resolve(saved); tx.onerror = tx.onabort = () => reject(tx.error);
  }); } finally { d.close(); }
}
export async function localLoad(): Promise<Workspace> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d.transaction("workspace").objectStore("workspace").get("main");
      r.onsuccess = () => {
        const saved = r.result as Workspace | undefined;
        resolve(saved ? { ...saved, profiles: reconcileBrandPairs(saved.profiles, saved.datasets, saved.deletedBrandPairs), settings: { ...defaultSettings, ...saved.settings } } : emptyWorkspace());
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}
export async function localSave(workspace: Workspace) {
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(workspace, "main");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
async function requireAdmin() {
  if (!supabase) throw new Error("Cloud connection missing");
  const user = await supabase.auth.getUser();
  fail(user.error);
  const membership = await supabase.from("rxm_members").select("role").eq("email", user.data.user?.email || "").maybeSingle();
  fail(membership.error);
  if (membership.data?.role !== "owner") throw new Error("Admin access required");
  return supabase;
}
export async function cloudPublishEmailTemplate(template: EmailTemplate) {
  const error = templateError(template);
  if (error) throw new Error(error);
  const client = await requireAdmin();
  const result = await client.from("rxm_workspace_defaults").upsert({ id: "email", payload: template, updated_at: new Date().toISOString() });
  fail(result.error);
}
export async function cloudDeleteSource(id: string) {
  const client = await requireAdmin();
  const result = await client.from("rxm_datasets").delete().eq("id", id).select("id");
  fail(result.error);
  if (!result.data?.length) throw new Error("This source could not be deleted. Refresh your workspace.");
}
export async function cloudExportHierarchy(id: string): Promise<Hierarchy> {
  const client = await requireAdmin();
  const result = await client.rpc("rxm_export_hierarchy", { hierarchy_id: id });
  fail(result.error);
  if (!result.data) throw new Error("Hierarchy version not found");
  return result.data as Hierarchy;
}
export async function cloudProfiles(): Promise<BrandProfile[]> {
  if (!supabase) throw new Error("Cloud connection missing");
  const profiles: BrandProfile[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("rxm_profiles").select("id,payload").order("id").range(offset, offset + 499);
    fail(result.error);
    profiles.push(...(result.data || []).map(row => ({ ...row.payload, id: row.id })));
    if ((result.data?.length || 0) < 500) return profiles;
  }
}
export async function cloudDeletedBrandPairs(): Promise<string[]> {
  if (!supabase) throw new Error("Cloud connection missing");
  const keys: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("rxm_deleted_brand_pairs").select("generic,brand").order("generic").order("brand").range(offset, offset + 499);
    fail(result.error);
    keys.push(...(result.data || []).map(row => brandPairKey(row)));
    if ((result.data?.length || 0) < 500) return keys;
  }
}
export async function cloudCatalogue() {
  const profiles = await cloudProfiles();
  // Read deletion markers after profiles so a concurrent deletion cannot make
  // reconciliation restore a built-in from an older marker snapshot.
  const deletedBrandPairs = await cloudDeletedBrandPairs();
  return { profiles, deletedBrandPairs, persistedProfileIds: profiles.map(profile => profile.id) };
}
export async function cloudDeleteBrandPair(id: string) {
  const client = await requireAdmin();
  const result = await client.from("rxm_profiles").delete().eq("id", id).select("id");
  fail(result.error);
  if (!result.data?.length) throw new Error("This pair is no longer available. Refresh the workspace.");
  return cloudCatalogue();
}
export async function cloudUpdateCatalogue() {
  const client = await requireAdmin();
  const result = await client.rpc("rxm_refresh_catalogue");
  fail(result.error);
  return { added: Number(result.data || 0), ...await cloudCatalogue() };
}
export async function cloudLoad(): Promise<Workspace> {
  if (!supabase) throw new Error("Cloud connection is not configured");
  const { data: user, error: ue } = await supabase.auth.getUser();
  fail(ue);
  if (!user.user) throw new Error("Please sign in");
  const membership = await supabase
    .from("rxm_members")
    .select("email,role")
    .eq("email", user.user.email)
    .maybeSingle();
  fail(membership.error);
  if (!membership.data)
    throw new Error(
      "Your account is not active in this SBM workspace. Ask your admin to check your access.",
    );
  const catalogue = cloudCatalogue();
  const values = await Promise.all([
    supabase
      .from("rxm_datasets")
      .select("id,active,payload")
      .eq("complete", true)
      .order("imported_at", { ascending: false }),
    supabase
      .from("rxm_hierarchies")
      .select("*")
      .order("created_at", { ascending: false }),
    catalogue.then(value => ({ data: value.profiles, error: null })),
    supabase
      .from("rxm_batches")
      .select("*")
      .eq("user_id", user.user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("rxm_settings")
      .select("payload")
      .eq("user_id", user.user.id)
      .maybeSingle(),
    supabase
      .from("rxm_user_templates")
      .select("payload")
      .eq("email", (user.user.email || "").toLowerCase())
      .maybeSingle(),
    supabase.from("rxm_workspace_defaults").select("payload").eq("id", "email").maybeSingle(),
    catalogue.then(value => ({ data: value.deletedBrandPairs, error: null })),
  ]);
  values.forEach((v) => fail(v.error));
  const base = emptyWorkspace();
  const storedProfiles = values[2].data as BrandProfile[];
  const deletedBrandPairs = values[7].data as string[];
  const datasets: Dataset[] = (values[0].data || []).map(d => ({ ...d.payload, id: d.id, active: d.active, facts: [] }));
  return {
    ...base,
    deletedBrandPairs,
    sharedEmailTemplate: values[6].data?.payload,
    datasets,
    persistedProfileIds: storedProfiles.map(p => p.id),
    hierarchies: (values[1].data || []).map((h) => h.payload),
    profiles: reconcileBrandPairs(storedProfiles, datasets, deletedBrandPairs),
    batches: (values[3].data || []).map((b) => b.payload),
    settings: { ...settingsForNewUser(user.user.email || ""), ...(
      (values[4].data as { payload?: Workspace["settings"] } | null)?.payload ||
      (values[5].data as { payload?: Workspace["settings"] } | null)?.payload ||
      {}), ...(values[6].data?.payload ? { emailTemplate: values[6].data.payload } : {}) },
  };
}
export async function cloudHydrate(
  datasets: Dataset[],
  month: string,
  profile: BrandProfile,
  endMonth = month,
) {
  if (!supabase) throw new Error("Cloud connection missing");
  const generics = reportGenericNames(profile);
  const ids = datasets
    .filter(
      (d) =>
        d.active && d.from.slice(0, 7) <= endMonth && d.to.slice(0, 7) >= month,
    )
    .map((d) => d.id);
  if (!ids.length) return datasets;
  const facts = new Map<string, RxFact[]>();
  let offset = 0;
  while (true) {
    const r = await supabase
      .from("rxm_fact_chunks")
      .select("dataset_id,payload")
      .in("dataset_id", ids)
      .in("month", reportingMonths(month, endMonth))
      .in("generic", generics)
      .order("id")
      .range(offset, offset + 99);
    fail(r.error);
    for (const chunk of r.data || [])
      facts.set(chunk.dataset_id, [
        ...(facts.get(chunk.dataset_id) || []),
        ...chunk.payload,
      ]);
    if ((r.data?.length || 0) < 100) break;
    offset += 100;
  }
  return datasets.map((d) => ({ ...d, facts: facts.get(d.id) || [] }));
}
export async function cloudSave(
  next: Workspace,
  previous: Workspace,
  onProgress: (s: string) => void = () => {},
) {
  if (!supabase) throw new Error("Cloud connection missing");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again");
  for (const d of next.datasets) {
    const old = previous.datasets.find((p) => p.id === d.id);
    if (!old) {
      onProgress("Saving import metadata");
      const { facts, stagedImportId, stagedFactCount, ...payload } = d;
      const r = await supabase.from("rxm_datasets").insert({
        id: d.id,
        name: d.name,
        hash: d.hash,
        active: false,
        complete: false,
        from_date: d.from,
        to_date: d.to,
        imported_at: d.importedAt,
        payload,
      });
      fail(r.error);
      try {
        let saved = 0;
        for await (const batch of importFactBatches(d)) {
          const r = await supabase.from("rxm_fact_chunks").insert({ dataset_id: d.id, ...batch });
          fail(r.error);
          saved += batch.payload.length;
          onProgress(`Saving Rx records ${saved.toLocaleString()}${stagedFactCount !== undefined ? " / " + stagedFactCount.toLocaleString() : ""}`);
        }
        if (stagedImportId && saved !== stagedFactCount)
          throw new Error("The prepared import is incomplete. Select the original workbook again.");
        const replaceIds = previous.datasets
          .filter(
            (o) =>
              o.active &&
              overlaps(o, d) &&
              next.datasets.some((n) => n.id === o.id && !n.active),
          )
          .map((o) => o.id);
        const finish = await supabase.rpc("rxm_finish_import", {
          dataset: d.id,
          replace_ids: replaceIds,
        });
        fail(finish.error);
      } catch (e) {
        await supabase.rpc("rxm_cleanup_import", { dataset: d.id });
        throw e;
      }
    } else if (old.active !== d.active) {
      if (
        !d.active &&
        next.datasets.some(
          (n) =>
            !previous.datasets.some((o) => o.id === n.id) && overlaps(n, d),
        )
      )
        continue;
      const r = await supabase
        .from("rxm_datasets")
        .update({ active: d.active })
        .eq("id", d.id);
      fail(r.error);
    }
    if (old && JSON.stringify(old.aseByMpe) !== JSON.stringify(d.aseByMpe)) {
      const { facts, ...payload } = d;
      const r = await supabase.from("rxm_datasets").update({ payload }).eq("id", d.id);
      fail(r.error);
    }
  }
  for (const h of next.hierarchies)
    if (!previous.hierarchies.some((p) => p.id === h.id)) {
      const r = await supabase.from("rxm_hierarchies").insert({
        id: h.id,
        effective_from: h.effectiveFrom,
        created_at: h.createdAt,
        payload: h,
      });
      fail(r.error);
    }
  const importing = next.datasets.some(d => !previous.datasets.some(old => old.id === d.id));
  const changedProfiles = next.profiles.filter(p => JSON.stringify(previous.profiles.find(old => old.id === p.id)) !== JSON.stringify(p));
  const storedIds = new Set(previous.persistedProfileIds || previous.profiles.map(p => p.id));
  const missing = next.profiles.filter(p => !storedIds.has(p.id) && (importing || changedProfiles.some(c => c.id === p.id)));
  if (missing.length) {
    const result = await supabase.rpc("rxm_add_brand_profiles", { profiles: missing });
    fail(result.error);
  }
  for (const p of changedProfiles.filter(p => storedIds.has(p.id))) {
    const result = await supabase.from("rxm_profiles").update({ payload: p }).eq("id", p.id).select("id");
    fail(result.error);
    if (!result.data?.length) throw new Error("This brand pair is no longer available. Refresh your workspace.");
  }
  if (JSON.stringify(next.settings) !== JSON.stringify(previous.settings)) {
    const r = await supabase
      .from("rxm_settings")
      .upsert({ user_id: user.id, payload: next.settings });
    fail(r.error);
  }
  for (const b of next.batches)
    if (
      JSON.stringify(previous.batches.find((p) => p.id === b.id)) !==
      JSON.stringify(b)
    ) {
      const r = await supabase.from("rxm_batches").upsert({
        id: b.id,
        user_id: user.id,
        created_at: b.createdAt,
        payload: b,
      });
      fail(r.error);
    }
  if (importing || changedProfiles.length) {
    const catalogue = await cloudCatalogue();
    return { ...catalogue, profiles: reconcileBrandPairs(catalogue.profiles, next.datasets, catalogue.deletedBrandPairs) };
  }
}

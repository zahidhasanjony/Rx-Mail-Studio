import { createClient } from "@supabase/supabase-js";
import type { Dataset, Workspace, RxFact, BrandProfile } from "./types";
import { emptyWorkspace, settingsForNewUser } from "./types";
import { normalize, overlaps } from "./engine";
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
export async function localLoad(): Promise<Workspace> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d.transaction("workspace").objectStore("workspace").get("main");
      r.onsuccess = () => resolve(r.result || emptyWorkspace());
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
  const values = await Promise.all([
    supabase
      .from("rxm_datasets")
      .select("*")
      .eq("complete", true)
      .order("imported_at", { ascending: false }),
    supabase
      .from("rxm_hierarchies")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("rxm_profiles").select("*"),
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
  ]);
  values.forEach((v) => fail(v.error));
  const base = emptyWorkspace();
  return {
    ...base,
    datasets: (values[0].data || []).map((d) => ({
      ...d.payload,
      id: d.id,
      active: d.active,
      facts: [],
    })),
    hierarchies: (values[1].data || []).map((h) => h.payload),
    profiles: values[2].data?.length
      ? values[2].data.map((p) => p.payload)
      : base.profiles,
    batches: (values[3].data || []).map((b) => b.payload),
    settings:
      (values[4].data as { payload?: Workspace["settings"] } | null)?.payload ||
      (values[5].data as { payload?: Workspace["settings"] } | null)?.payload ||
      settingsForNewUser(user.user.email || ""),
  };
}
export async function cloudHydrate(
  datasets: Dataset[],
  month: string,
  profile: BrandProfile,
) {
  if (!supabase) throw new Error("Cloud connection missing");
  const generics = [profile.generic, ...(profile.aliases || [])].map(normalize);
  const ids = datasets
    .filter(
      (d) =>
        d.active && d.from.slice(0, 7) <= month && d.to.slice(0, 7) >= month,
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
      .eq("month", month)
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
      const { facts, ...payload } = d;
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
        const groups = new Map<string, RxFact[]>();
        for (const fact of facts) {
          const key = JSON.stringify([
            fact.date.slice(0, 7),
            normalize(fact.generic),
          ]);
          const g = groups.get(key) || [];
          g.push(fact);
          groups.set(key, g);
        }
        let saved = 0;
        for (const [key, list] of groups) {
          const [month, generic] = JSON.parse(key);
          for (let i = 0; i < list.length; i += 1000) {
            const r = await supabase.from("rxm_fact_chunks").insert({
              dataset_id: d.id,
              month,
              generic,
              payload: list.slice(i, i + 1000),
            });
            fail(r.error);
          }
          onProgress(`Saving generic ${++saved} / ${groups.size}`);
        }
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
        await supabase.from("rxm_datasets").delete().eq("id", d.id);
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
  for (const p of next.profiles)
    if (
      JSON.stringify(previous.profiles.find((o) => o.id === p.id)) !==
      JSON.stringify(p)
    ) {
      const r = await supabase
        .from("rxm_profiles")
        .upsert({ id: p.id, payload: p });
      fail(r.error);
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
}

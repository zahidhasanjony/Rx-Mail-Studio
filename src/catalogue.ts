import type { BrandProfile, Dataset } from "./types";
import { starterProfiles } from "./types";
import { normalize } from "./engine";

export const brandPairKey = (p: Pick<BrandProfile, "brand" | "generic">) => JSON.stringify([normalize(p.generic), normalize(p.brand)]);
export const isBeximcoCompany = (company: string) => /\bBEXIMCO\b/i.test(company);
// Older imports already constructed their catalogue exclusively from Beximco rows.
export function sourceBrandPairs(datasets: Pick<Dataset, "catalog">[]) {
  return datasets.flatMap(d => d.catalog).filter(p => !p.company || isBeximcoCompany(p.company));
}
export function appendBrandPairs(existing: BrandProfile[], candidates: BrandProfile[], deleted: string[] = []) {
  const removed = new Set(deleted);
  const result = existing.filter(p => !removed.has(brandPairKey(p))), pairs = new Set(result.map(brandPairKey)), ids = new Set(result.map(p => p.id));
  for (const candidate of candidates) {
    const pair = brandPairKey(candidate);
    if (!candidate.brand.trim() || !candidate.generic.trim() || pairs.has(pair) || removed.has(pair)) continue;
    let id = candidate.id || pair;
    if (ids.has(id)) id = "discovered:" + pair;
    result.push({ ...candidate, id, forms: [...candidate.forms], ...(candidate.aliases ? { aliases: [...candidate.aliases] } : {}) });
    pairs.add(pair); ids.add(id);
  }
  return result;
}
export function reconcileBrandPairs(saved: BrandProfile[], datasets: Pick<Dataset, "catalog">[], deleted: string[] = []) {
  // Saved definitions win by ID as well as pair: an edited built-in must not be reset.
  const savedIds = new Set(saved.map(p => p.id));
  const defaults = starterProfiles.filter(p => !savedIds.has(p.id));
  return appendBrandPairs(appendBrandPairs(saved, defaults, deleted), sourceBrandPairs(datasets), deleted);
}
export function searchBrandPairs(profiles: BrandProfile[], query: string) {
  const words = normalize(query).split(" ").filter(Boolean);
  return profiles.filter(p => words.every(w => normalize(p.brand + " " + p.generic).includes(w)));
}

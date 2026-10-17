import type { BrandProfile, Dataset } from "./types";
import { normalize } from "./engine";

export function targetGenericNames(profile: BrandProfile): string[] {
  const names = [profile.generic, ...(profile.targetGenerics || [])];
  return names.filter((name, index) => name.trim() && names.findIndex(value => normalize(value) === normalize(name)) === index);
}
export function reportGenericNames(profile: BrandProfile): string[] {
  return [...new Set([...targetGenericNames(profile), ...(profile.aliases || [])].map(normalize))];
}
export const marketLabel = (profile: BrandProfile) => targetGenericNames(profile).join(" + ");
export function datasetGenericNames(dataset: Pick<Dataset, "catalog" | "availableGenerics" | "includedGenerics"> & Partial<Pick<Dataset, "facts">>) {
  const names = [...(dataset.availableGenerics || []), ...(dataset.includedGenerics || []), ...dataset.catalog.map(p => p.generic), ...(dataset.availableGenerics ? [] : dataset.facts || []).map(f => f.generic)];
  return [...new Map(names.filter(Boolean).map(name => [normalize(name), name.trim()])).values()];
}
export function missingMarketCoverage(datasets: Dataset[], months: string[], profile: BrandProfile, cycle = "all") {
  const groups = targetGenericNames(profile).map((generic, index) => ({ generic, names: [generic, ...(index === 0 ? profile.aliases || [] : [])].map(normalize) }));
  const inCycle = (date: string) => cycle === "all" || (cycle === "first" && +date.slice(8) <= 10) || (cycle === "second" && +date.slice(8) >= 11 && +date.slice(8) <= 20) || (cycle === "third" && +date.slice(8) >= 21);
  return groups.flatMap(group => months.filter(month => !datasets.some(dataset => {
    if (!dataset.active || dataset.from.slice(0, 7) > month || dataset.to.slice(0, 7) < month) return false;
    const included = dataset.includedGenerics?.map(normalize);
    if (included && !included.some(name => group.names.includes(name))) return false;
    return dataset.dates ? dataset.dates.some(date => date.startsWith(month) && inCycle(date)) : true;
  })).map(month => ({ generic: group.generic, month })));
}

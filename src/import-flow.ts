import type { Dataset } from './types';
import type { Sheet } from './excel';
import { normalize, overlaps } from './engine';
import { datasetGenericNames } from './markets';

export function automaticSourceSheet(sheets: Sheet[]): Sheet | undefined {
  const trd = sheets.filter(s => /^TRD\b/i.test(s.name));
  return trd.length === 1 ? trd[0] : trd.length === 0 && sheets.length === 1 ? sheets[0] : undefined;
}
export async function fullMarketSource(dataset: Dataset): Promise<Dataset> {
  const scope = datasetGenericNames(dataset).sort();
  const sourceHash = dataset.sourceHash || dataset.hash;
  const version = [dataset.sheets, scope, dataset.classificationVersion || 1, ...(dataset.analyticsVersion ? [dataset.analyticsVersion] : [])];
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceHash + JSON.stringify(version)));
  return { ...dataset, sourceHash, includedGenerics: scope, hash: Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2, '0')).join('') };
}
const includesMarkets = (a: Dataset, b: Dataset) => {
  const markets = new Set((a.includedGenerics || datasetGenericNames(a)).map(normalize));
  return (b.includedGenerics || datasetGenericNames(b)).every(g => markets.has(normalize(g)));
};
// Whole-file activation must not lose dates or markets from an older source.
export function coversSource(a: Dataset, b: Dataset): boolean {
  if (a.from > b.from || a.to < b.to || !includesMarkets(a, b)) return false;
  return !b.dates?.length || !!a.dates?.length && b.dates.every(d => a.dates!.includes(d));
}
export type ImportDecision = { source: Dataset; status: 'ready' | 'skip' | 'error'; message: string };
export function planSourceImports(sources: Dataset[], existing: Dataset[]): ImportDecision[] {
  const decisions: ImportDecision[] = sources.map((source, i) => {
    if (existing.some(d => d.hash === source.hash) || sources.slice(0, i).some(d => d.hash === source.hash))
      return { source, status: 'skip', message: 'Already imported. No duplicate will be added.' };
    const newer = sources.find(d => d !== source && d.hash !== source.hash && coversSource(d, source) && !coversSource(source, d));
    if (newer) return { source, status: 'skip', message: `Covered by ${newer.name}. Only the complete period will be imported.` };
    return { source, status: 'ready', message: 'All generics and competitor brands included.' };
  });
  for (const item of decisions.filter(d => d.status === 'ready')) {
    const other = decisions.find(d => d !== item && (d.status === 'ready' || d.status === 'error') && overlaps(d.source, item.source));
    if (other) {
      item.status = 'error'; item.message = `Overlapping files: ${other.source.name}. Remove one or upload a complete cumulative file.`;
      other.status = 'error'; other.message = `Overlapping files: ${item.source.name}. Remove one or upload a complete cumulative file.`;
      continue;
    }
    const partial = existing.find(d => d.active && overlaps(d, item.source) && !coversSource(item.source, d));
    if (partial) { item.status = 'error'; item.message = `This would remove dates or markets from ${partial.name}. Upload a complete replacement or remove this file.`; }
    else if (existing.some(d => d.active && overlaps(d, item.source))) item.message = 'Replaces the overlapping saved version after verification.';
  }
  return decisions;
}

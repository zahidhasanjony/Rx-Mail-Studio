import type { Dataset } from './types';
import { normalize, coverage, eligibleDatasets } from './engine';
import { reportingMonths } from './reporting';

import type { DashboardRow } from './components/generated/DashboardData';
export { dashboardTotals, dashboardGroups, dashboardBrands } from './components/generated/DashboardData';
export type { DashboardRow } from './components/generated/DashboardData';
export interface DashboardData { rows: DashboardRow[]; dates: string[]; missingMonths: string[]; limited: boolean }
export const therapeuticGroupKey = (generic: string, brand: string, company: string) => [generic, brand, company].map(normalize).join('\u001f');
export function mappedDashboardRows(rows: DashboardRow[], mappings: Record<string, string>): DashboardRow[] {
  return rows.map(row => {
    const tg = mappings[therapeuticGroupKey(row.generic, row.brand, row.company)];
    return tg ? { ...row, tg } : row;
  });
}
export function dashboardData(datasets: Dataset[], from: string, to: string): DashboardData {
  const sources = eligibleDatasets(datasets, from, to), rows = new Map<string, DashboardRow>();
  for (const [i, a] of sources.entries()) for (const b of sources.slice(i + 1)) {
    const aGenerics = new Set((a.includedGenerics || a.availableGenerics || a.facts.map(f => f.generic)).map(normalize));
    const sameMarket = (b.includedGenerics || b.availableGenerics || b.facts.map(f => f.generic)).some(g => aGenerics.has(normalize(g)));
    const bDates = new Set(coverage([b], from, to));
    if (sameMarket && coverage([a], from, to).some(d => bDates.has(d))) throw new Error('Active source dates overlap. Keep one version of each market before viewing the dashboard.');
  }
  for (const source of sources) for (const f of source.facts) {
    if (f.date.slice(0, 7) < from || f.date.slice(0, 7) > to) continue;
    const tg = source.therapeuticGroups?.[therapeuticGroupKey(f.generic, f.brand, f.company)] || 'Unclassified';
    const key = JSON.stringify([tg, normalize(f.generic), normalize(f.brand), normalize(f.company)]);
    const row = rows.get(key) || { tg, generic: f.generic, brand: f.brand, company: f.company, rx: 0 };
    row.rx += f.count; rows.set(key, row);
  }
  const dates = coverage(sources, from, to);
  return { rows: [...rows.values()], dates, missingMonths: reportingMonths(from, to).filter(m => !dates.some(d => d.startsWith(m))),
    limited: sources.some(s => !!s.includedGenerics && (!s.availableGenerics || s.availableGenerics.some(g => !s.includedGenerics!.map(normalize).includes(normalize(g))))) };
}

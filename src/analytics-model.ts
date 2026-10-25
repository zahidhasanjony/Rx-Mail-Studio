import type { BrandProfile, Dataset, RxFact, Structure } from './types';
import type { DashboardRow } from './dashboard-model';
import { dashboardData, mappedDashboardRows } from './dashboard-model';
import { normalize } from './engine';
import { isBeximcoCompany } from './catalogue';
import { normalizePreparation, preparationMarket, preparationKey } from './preparations';

export interface AnalyticsFact extends RxFact { tg: string; datasetId: string }
export interface AnalysisFilters {
  form: string; strength: string; specialty: string;
  structure: '' | Structure; region: string; ase: string; mpe: string;
}
export const emptyAnalysisFilters: AnalysisFilters = { form: '', strength: '', specialty: '', structure: '', region: '', ase: '', mpe: '' };
export const strengthKey = (v?: string) => normalize(v || '').replace(/(\d)\s*(MCG|MG|G|ML|IU|%)/g, '$1 $2') || 'Not specified';
export const ratio = (n: number, d: number) => d ? n / d : null;
export const share = (n: number, d: number) => d ? n / d * 100 : null;
export const sumRx = (facts: RxFact[]) => facts.reduce((s, f) => s + f.count, 0);
export function comparableMonths(facts: AnalyticsFact[], dates: string[], first: string, second: string, brand = '') {
  const a = new Set(dates.filter(d=>d.startsWith(first)).map(d=>d.slice(8))), b = new Set(dates.filter(d=>d.startsWith(second)).map(d=>d.slice(8)));
  const days = new Set([...a].filter(d=>b.has(d)));
  const tally=(month:string)=>{
    let total=0,own=0;
    for(const f of facts) for(const [date,count] of Object.entries(f.dailyCounts || {[f.date]:f.count})) if(date.startsWith(month)&&days.has(date.slice(8))){total+=count;if(isBeximcoCompany(f.company)&&(!brand||normalize(f.brand)===normalize(brand)))own+=count;}
    return {total,own,share:share(own,total)};
  };
  const previous=tally(first),current=tally(second);
  return {days:[...days].sort(),previous,current,change:previous.share===null||current.share===null?null:current.share-previous.share};
}
export const doctorKey = (f: RxFact) => normalize(f.doctorCode);
export const fieldCode = (f: RxFact, structure: Structure, level: 'region' | 'ase' | 'mpe') => normalize((structure === 'ACD'
  ? level === 'region' ? f.acdRegion : level === 'ase' ? f.acdAse : f.acdMpe
  : level === 'region' ? f.ccdRegion : level === 'ase' ? f.ccdAse : f.ccdMpe) || '');

export function analysisFacts(datasets: Dataset[], from: string, to: string, mappings: Record<string, string> = {}, classified?: DashboardRow[]): AnalyticsFact[] {
  // Reuse the existing overlap guard and preparation-specific TG classification.
  const rows = classified || mappedDashboardRows(dashboardData(datasets, from, to).rows, mappings, datasets);
  const tgs = new Map(rows.map(r => [preparationKey(r.generic, r.brand, r.company, r.form || ''), r.tg]));
  return datasets.filter(d => d.active).flatMap(d => d.facts.filter(f => f.date.slice(0, 7) >= from && f.date.slice(0, 7) <= to)
    .map(f => ({ ...f, form: normalizePreparation(f.form), strength: strengthKey(f.strength), specialty: normalize(f.specialty) || 'Not specified', datasetId: d.id,
      tg: tgs.get(preparationKey(f.generic, f.brand, f.company, f.form)) || 'Unclassified' })));
}
export function territoryFacts(facts: AnalyticsFact[], filters: AnalysisFilters) {
  if (!filters.structure) return facts;
  return facts.filter(f => !!fieldCode(f, filters.structure as Structure, 'region') &&
    (['region', 'ase', 'mpe'] as const).every(level => !filters[level] || fieldCode(f, filters.structure as Structure, level) === filters[level]));
}
export function filterFacts(facts: AnalyticsFact[], filters: AnalysisFilters, product = true, specialty = true) {
  return territoryFacts(facts, filters).filter(f => (!specialty || !filters.specialty || f.specialty === filters.specialty) &&
    (!product || ((!filters.form || normalizePreparation(f.form) === filters.form) && (!filters.strength || strengthKey(f.strength) === filters.strength))));
}
export function summaryRows(facts: AnalyticsFact[]): DashboardRow[] {
  const rows = new Map<string, DashboardRow>();
  for (const f of facts) {
    const key = JSON.stringify([f.tg, normalize(f.generic), normalize(f.brand), normalize(f.company), f.form]);
    const r = rows.get(key) || { tg: f.tg, generic: f.generic, brand: f.brand, company: f.company, form: f.form, rx: 0 };
    r.rx += f.count; rows.set(key, r);
  }
  return [...rows.values()];
}
export function divisionShares(facts: AnalyticsFact[]) {
  return (['ACD', 'CCD'] as const).map(structure => {
    const selected = facts.filter(f => !!fieldCode(f, structure, 'region'));
    const total = sumRx(selected), own = sumRx(selected.filter(f => isBeximcoCompany(f.company)));
    return { structure, total, own, share: share(own, total) };
  });
}
export interface Market { generic: string; brand: string; marketKey: string }
export const inMarket = (f: RxFact, market: Pick<Market, 'generic' | 'marketKey'>) => normalize(f.generic) === normalize(market.generic) && (!market.marketKey || preparationMarket(f.form) === market.marketKey);
export function brandCounts(facts: RxFact[]) {
  const counts = new Map<string, { brand: string; company: string; count: number }>();
  for (const f of facts) { const key = JSON.stringify([normalize(f.brand), normalize(f.company)]); const row = counts.get(key) || { brand: f.brand, company: f.company, count: 0 }; row.count += f.count; counts.set(key, row); }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}
export function prescribers(facts: AnalyticsFact[], market: Market, brandFilter = '') {
  const docs = new Map<string, AnalyticsFact[]>();
  for (const f of facts) if (inMarket(f, market)) { const key = doctorKey(f); const group = docs.get(key) || []; group.push(f); docs.set(key, group); }
  return [...docs].map(([code, rows]) => {
    const latest = rows.reduce((a, b) => a.date >= b.date ? a : b);
    const brands = brandCounts(rows), total = sumRx(rows);
    const own = sumRx(rows.filter(f => isBeximcoCompany(f.company) && normalize(f.brand) === normalize(market.brand)));
    const ranked = brandFilter ? brands.filter(b => JSON.stringify([normalize(b.brand), normalize(b.company)]) === brandFilter).reduce((s, b) => s + b.count, 0) : total;
    return { code, name: latest.doctorName, specialty: latest.specialty, total, own, share: share(own, total), ranked, brands, latest,
      assignments: [...new Set(rows.flatMap(f => (['ACD','CCD'] as const).filter(s => fieldCode(f,s,'region')).map(s => `${s}: ${fieldCode(f,s,'region')} / ${fieldCode(f,s,'ase') || '—'} / ${fieldCode(f,s,'mpe') || '—'}`)))] };
  }).filter(d => d.ranked > 0).sort((a, b) => b.ranked - a.ranked || a.code.localeCompare(b.code));
}
export function specialtyProductivity(allFacts: AnalyticsFact[], filters: AnalysisFilters, market: Market) {
  // Classify each doctor once using their latest observation within period/territory.
  // Product, brand, strength and specialty filters never shrink the benchmark population.
  const population = territoryFacts(allFacts, filters), doctors = new Map<string, AnalyticsFact>();
  for (const f of population) { const previous = doctors.get(doctorKey(f)); if (!previous || f.date > previous.date) doctors.set(doctorKey(f), f); }
  const rows = new Map<string, { specialty: string; doctors: number; generic: number; brand: number; genericPrescribers: Set<string>; brandPrescribers: Set<string> }>();
  for (const f of doctors.values()) { const row = rows.get(f.specialty) || { specialty: f.specialty, doctors: 0, generic: 0, brand: 0, genericPrescribers: new Set<string>(), brandPrescribers: new Set<string>() }; row.doctors++; rows.set(f.specialty, row); }
  for (const f of filterFacts(allFacts, filters, true, false)) if (inMarket(f, market)) {
    const row = rows.get(doctors.get(doctorKey(f))!.specialty)!;
    row.generic += f.count; row.genericPrescribers.add(doctorKey(f));
    if (isBeximcoCompany(f.company) && normalize(f.brand) === normalize(market.brand)) { row.brand += f.count; row.brandPrescribers.add(doctorKey(f)); }
  }
  const totalGeneric = [...rows.values()].reduce((s, r) => s + r.generic, 0), totalBrand = [...rows.values()].reduce((s, r) => s + r.brand, 0);
  return [...rows.values()].filter(r => !filters.specialty || r.specialty === filters.specialty).map(r => {
    const doctorPct = share(r.doctors, doctors.size), genericPct = share(r.generic, totalGeneric), brandPct = share(r.brand, totalBrand);
    return { ...r, genericPrescribers: r.genericPrescribers.size, brandPrescribers: r.brandPrescribers.size, doctorPct, genericPct, brandPct,
      genericIndex: genericPct === null || !doctorPct ? null : genericPct / doctorPct, brandIndex: brandPct === null || !doctorPct ? null : brandPct / doctorPct,
      genericProductivity: ratio(r.generic, r.doctors), brandProductivity: ratio(r.brand, r.doctors), brandShare: share(r.brand, r.generic) };
  }).sort((a, b) => b.generic - a.generic || a.specialty.localeCompare(b.specialty));
}
export function ffPerformance(facts: AnalyticsFact[], structure: Structure, level: 'region' | 'ase' | 'mpe', brand = '') {
  const groups = new Map<string, AnalyticsFact[]>();
  for (const f of facts) { const code = fieldCode(f, structure, level); if (!code) continue; const group = groups.get(code) || []; group.push(f); groups.set(code, group); }
  return [...groups].map(([code, rows]) => { const total = sumRx(rows), ownRows = rows.filter(f => isBeximcoCompany(f.company) && (!brand || normalize(f.brand) === normalize(brand))), own = sumRx(ownRows), doctors = new Set(rows.map(doctorKey)).size;
    return { code, total, own, share: share(own, total), doctors, ownDoctors: new Set(ownRows.map(doctorKey)).size, rxPerDoctor: ratio(own, doctors), activeMpes: new Set(rows.map(f => fieldCode(f,structure,'mpe')).filter(Boolean)).size }; }).sort((a,b) => b.own-a.own || a.code.localeCompare(b.code));
}
export function opportunities(facts: AnalyticsFact[], profiles: BrandProfile[], minimum: number, selectedGeneric = '') {
  const markets = new Map<string, Market>();
  const grouped = new Map<string, AnalyticsFact[]>();
  for (const f of facts) { const key = JSON.stringify([normalize(f.generic), preparationMarket(f.form)]); const group = grouped.get(key) || []; group.push(f); grouped.set(key, group); }
  for (const p of profiles) {
    if (p.company && !isBeximcoCompany(p.company)) continue;
    if (selectedGeneric && normalize(p.generic) !== normalize(selectedGeneric)) continue;
    for (const form of p.forms) { const market = { generic: p.generic, brand: p.brand, marketKey: preparationMarket(form) }; markets.set(JSON.stringify(market), market); }
  }
  return [...markets.values()].flatMap(market => {
    const definitions=profiles.filter(p=>normalize(p.generic)===normalize(market.generic)&&normalize(p.brand)===normalize(market.brand));
    const forms=new Set(definitions.flatMap(p=>p.forms.map(normalizePreparation)));
    const variants=definitions.flatMap(p=>p.variants||[]).filter(v=>v.strength.trim());
    const rows=(grouped.get(JSON.stringify([normalize(market.generic),market.marketKey])) || []).filter(f=>forms.has(normalizePreparation(f.form))&&(!variants.some(v=>normalizePreparation(v.form)===normalizePreparation(f.form))||strengthKey(f.strength)==='Not specified'||variants.some(v=>normalizePreparation(v.form)===normalizePreparation(f.form)&&strengthKey(v.strength)===strengthKey(f.strength))));
    const months=[...new Set(rows.map(f=>f.date.slice(0,7)))].sort();
    const recent=months.at(-1), previous=months.at(-2);
    const byDoctor=new Map<string,AnalyticsFact[]>();
    for(const f of rows){const group=byDoctor.get(doctorKey(f))||[];group.push(f);byDoctor.set(doctorKey(f),group);}
    return prescribers(rows,market).filter(d=>d.total>=minimum).map(d=>{
      const dr=byDoctor.get(d.code)||[];
      const periodShare=(m:string|undefined)=>{const fs=dr.filter(f=>m&&f.date.startsWith(m));return share(sumRx(fs.filter(f=>isBeximcoCompany(f.company)&&normalize(f.brand)===normalize(market.brand))),sumRx(fs));};
      const old=periodShare(previous), current=periodShare(recent);
      const declining=old!==null&&current!==null&&current<old;
      return {...d,...market,declining,reason:d.own===0?'Generic Rx recorded; no recorded brand Rx':d.own/d.total<.5?'Brand share below 50% of recorded generic Rx':declining?`Observed share fell from ${old!.toFixed(1)}% to ${current!.toFixed(1)}%; check period completeness`:'',priority:d.own===0?0:d.own/d.total<.5?1:2};
    }).filter(d=>!!d.reason);
  }).sort((a,b)=>a.priority-b.priority||b.total-a.total);
}
export function csvText(headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; };
  return '\uFEFF' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
}

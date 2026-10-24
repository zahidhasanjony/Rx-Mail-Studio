import { normalizePreparation, preparationMarket } from '../../preparations';
export interface DashboardRow { tg: string; generic: string; brand: string; company: string; rx: number; form?: string }
const normalize = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();
const isBeximcoCompany = (v: string) => /\bBEXIMCO\b/i.test(v);
export function dashboardTotals(rows: DashboardRow[]) {
  let market = 0, own = 0;
  for (const row of rows) { market += row.rx; if (isBeximcoCompany(row.company)) own += row.rx; }
  return { market, own, share: market ? own / market * 100 : null };
}
export function dashboardGroups(rows: DashboardRow[]) {
  const groups = new Map<string, DashboardRow[]>();
  for (const row of rows) { const key = normalize(row.tg); const group = groups.get(key) || []; group.push(row); groups.set(key, group); }
  return [...groups.values()].map(group => ({ name: group[0].tg, ...dashboardTotals(group),
    brands: new Set(group.filter(r => isBeximcoCompany(r.company)).map(r => normalize(r.brand))).size }))
    .sort((a, b) => b.own - a.own || a.name.localeCompare(b.name));
}
export function dashboardBrands(rows: DashboardRow[], tg: string) {
  const selected = rows.filter(r => normalize(r.tg) === normalize(tg)), markets = new Map<string, number>();
  const brands = new Map<string, { name: string; generic: string; own: number; companies: string[]; forms: string[]; marketKey: string }>();
  // A competitor with an unknown/different TG still belongs in its generic market.
  for (const row of rows) { const key = JSON.stringify([normalize(row.generic), preparationMarket(row.form || '')]); markets.set(key, (markets.get(key) || 0) + row.rx); }
  for (const row of selected) {
    const generic = normalize(row.generic);
    if (!isBeximcoCompany(row.company)) continue;
    const marketKey = preparationMarket(row.form || '');
    const key = JSON.stringify([generic, normalize(row.brand), marketKey]), brand = brands.get(key) || { name: row.brand, generic: row.generic, own: 0, companies: [], forms: [], marketKey };
    const form = normalizePreparation(row.form || '');
    if (!brand.forms.includes(form)) brand.forms.push(form);
    if (!brand.companies.some(company => normalize(company) === normalize(row.company))) brand.companies.push(row.company.trim());
    brand.own += row.rx; brands.set(key, brand);
  }
  return [...brands.values()].map(brand => { const market = markets.get(JSON.stringify([normalize(brand.generic), brand.marketKey])) || 0;
    return { ...brand, market, share: market ? brand.own / market * 100 : null }; });
}

export function dashboardCompetitors(rows: DashboardRow[], generic: string, marketKey = 'FORM:UNKNOWN') {
  const brands = new Map<string, { name: string; company: string; rx: number; beximco: boolean; forms: string[] }>();
  let market = 0;
  for (const row of rows) {
    if (normalize(row.generic) !== normalize(generic) || preparationMarket(row.form || '') !== marketKey) continue;
    market += row.rx;
    const key = JSON.stringify([normalize(row.brand), normalize(row.company)]);
    const brand = brands.get(key) || { name: row.brand.trim(), company: row.company.trim(), rx: 0, beximco: isBeximcoCompany(row.company), forms: [] };
    const form = normalizePreparation(row.form || '');
    if (!brand.forms.includes(form)) brand.forms.push(form);
    brand.rx += row.rx; brands.set(key, brand);
  }
  return { market, brands: [...brands.values()].map(brand => ({ ...brand, share: market ? brand.rx / market * 100 : null }))
    .sort((a, b) => b.rx - a.rx || a.name.localeCompare(b.name) || a.company.localeCompare(b.company)) };
}

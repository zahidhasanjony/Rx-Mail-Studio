import { useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, CircleHelp, Database, Grid2X2, Layers3, LoaderCircle, Mail, Search, Target, X } from 'lucide-react';
import { dashboardTotals, dashboardGroups, dashboardBrands } from './DashboardData';
import type { DashboardRow } from './DashboardData';
import { BrandTGAssignment } from './BrandTGAssignment';
import './RxDashboardTGToBrand.css';
export interface RxDashboardProps {
  rows: DashboardRow[];
  months: string[];
  from: string;
  to: string;
  range: boolean;
  periodLabel: string;
  loading?: boolean;
  error?: string;
  notices?: string[];
  sample?: boolean;
  embedded?: boolean;
  onPeriodChange: (from: string, to: string, range: boolean) => void;
  onRetry?: () => void;
  onMail?: () => void;
  tgOptions?: string[];
  tgOptionsError?: string;
  onAssignTG?: (brand: string, generic: string, tg: string) => Promise<void>;
}
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});
const number = (n: number) => n.toLocaleString('en-GB');
const compact = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : number(n);
const percent = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const displayTG = (name: string) => name === 'Unclassified' ? name : name.toLowerCase().replace(/(^|[\s-])\S/g, v => v.toUpperCase());
export function RxDashboardView({
  rows,
  months,
  from,
  to,
  range,
  periodLabel,
  loading,
  error,
  notices = [],
  sample,
  embedded,
  onPeriodChange,
  onRetry,
  onMail,
  tgOptions = [],
  tgOptionsError,
  onAssignTG
}: RxDashboardProps) {
  const [tg, setTG] = useState(''),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState('rx'),
    [help, setHelp] = useState(false),
    [section, setSection] = useState('overview');
  const groups = useMemo(() => dashboardGroups(rows), [rows]);
  const selectedRows = tg ? rows.filter(r => r.tg.toUpperCase() === tg.toUpperCase()) : rows;
  const totals = dashboardTotals(selectedRows);
  const brands = useMemo(() => dashboardBrands(rows, tg), [rows, tg]);
  const brandCount = new Set(brands.map(b => b.name.toUpperCase())).size;
  const groupCount = groups.filter(g => g.name !== 'Unclassified').length;
  const visibleBrands = brands.filter(b => `${b.name} ${b.generic}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'share' ? (b.share || 0) - (a.share || 0) : sort === 'name' ? a.name.localeCompare(b.name) : b.own - a.own);
  const openTG = (name: string) => {
    setTG(name);
    setSearch('');
    setSection('brands');
  };
  const overview = () => {
    setTG('');
    setSearch('');
    setSection('overview');
  };
  return <div className={`rx-dashboard ${embedded ? 'rx-embedded' : ''}`}>
    {!embedded && <header className="rx-topbar"><div className="rx-logo"><Activity size={20} /><span>Rx Mail<span className="rx-logo-light"> Studio</span></span></div><span className="rx-status"><i />{sample ? 'Preview' : 'Connected'}</span></header>}
    <div className="rx-content">
      <div className="rx-page-title"><div><span className="rx-eyebrow">BEXIMCO PHARMACEUTICALS</span><h1>{tg ? 'Brand performance' : 'Rx dashboard'}</h1></div><button className="rx-help" onClick={() => setHelp(!help)} aria-label="Explain Rx share" aria-expanded={help}><CircleHelp size={20} /></button></div>
      {sample && <div className="rx-sample">Design preview · sample figures</div>}
      {help && <div className="rx-info">Rx counts are product occurrences in imported MRW data. TG share = Beximco Rx ÷ all-company Rx within that TG. Brand share uses its generic market. Range shares use summed counts.</div>}
      <section className="rx-period" aria-label="Dashboard reporting period"><div className="rx-period-top"><span><CalendarDays size={15} /> Reporting period</span><div className="rx-segment"><button className={!range ? 'is-active' : ''} aria-pressed={!range} onClick={() => onPeriodChange(to, to, false)}>Month</button><button className={range ? 'is-active' : ''} aria-pressed={range} onClick={() => onPeriodChange(from, to, true)}>Range</button></div></div>
        <div className={`rx-months ${range ? 'rx-range' : ''}`}><label><span>{range ? 'From' : 'Month'}</span><select aria-label={range ? 'Dashboard from month' : 'Dashboard month'} value={from} onChange={e => onPeriodChange(e.target.value, range && to >= e.target.value ? to : e.target.value, range)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select><ChevronDown size={16} /></label>{range && <><ArrowRight className="rx-range-arrow" size={16} /><label><span>To</span><select aria-label="Dashboard to month" value={to} onChange={e => onPeriodChange(e.target.value < from ? e.target.value : from, e.target.value, true)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select><ChevronDown size={16} /></label></>}</div>
        <div className="rx-period-bottom"><span className="rx-live-dot" />{periodLabel}<span className="rx-period-scope">Imported markets</span></div>
      </section>
      {notices.map((notice, i) => <div className="rx-info" key={i}>{notice}</div>)}
      {tg && <div className="rx-tg-selector"><button onClick={overview} aria-label="Back to all therapeutic groups"><ArrowLeft size={18} /></button><label><span>THERAPEUTIC GROUP</span><select aria-label="Dashboard therapeutic group" value={tg} onChange={e => openTG(e.target.value)}>{!groups.some(g => g.name === tg) && <option value={tg}>{displayTG(tg)}</option>}{groups.map(g => <option key={g.name} value={g.name}>{displayTG(g.name)}</option>)}</select></label><ChevronDown size={18} /></div>}
      {loading ? <section className="rx-state" role="status"><LoaderCircle className="rx-spin" size={24} /><h2>Loading Rx summary</h2><p>You can continue using the app.</p></section> : error ? <section className="rx-state" role="alert"><h2>Summary unavailable</h2><p>{error}</p>{onRetry && <button className="rx-action" onClick={onRetry}>Try again</button>}</section> : !rows.length ? <section className="rx-state"><Database size={26} /><h2>No Rx data for this period</h2><p>Import or activate a source file to see your dashboard.</p></section> : <>
        <div className="rx-section-label"><span>{tg ? displayTG(tg) : 'Overall performance'}</span><span>{tg ? `${brandCount} Beximco brands` : `${groupCount} TGs`}</span></div>
        <section className="rx-kpis" aria-label="Overall Rx KPIs">
          <article className="rx-kpi rx-kpi-share"><div className="rx-kpi-top"><span className="rx-icon blue"><Target size={18} /></span><span className="rx-kpi-tag">Beximco</span></div><span className="rx-kpi-label">Rx share</span><strong>{percent(totals.share)}</strong><div className="rx-meter"><i style={{
                width: `${totals.share || 0}%`
              }} /></div></article>
          <article className="rx-kpi"><div className="rx-kpi-top"><span className="rx-icon green"><Activity size={18} /></span><span className="rx-kpi-tag green">Rx</span></div><span className="rx-kpi-label">Beximco Rx</span><strong title={number(totals.own)}>{compact(totals.own)}</strong><small>{number(totals.own)} occurrences</small></article>
          <article className="rx-kpi"><div className="rx-kpi-top"><span className="rx-icon"><Database size={18} /></span></div><span className="rx-kpi-label">Total market Rx</span><strong title={number(totals.market)}>{compact(totals.market)}</strong><small>All companies</small></article>
          <article className="rx-kpi"><div className="rx-kpi-top"><span className="rx-icon"><Layers3 size={18} /></span></div><span className="rx-kpi-label">{tg ? 'Beximco brands' : 'Therapeutic groups'}</span><strong>{tg ? brandCount : groupCount}</strong><small>{tg ? 'With Rx in this period' : 'With imported Rx data'}</small></article>
        </section>
        {!tg ? <section className="rx-performance" id="rx-tg-performance"><div className="rx-panel-heading"><div><h2>TG-wise Rx share</h2><span>Beximco within each therapeutic group</span></div><Grid2X2 size={18} /></div><div className="rx-list-heading"><span>Therapeutic group</span><span>Beximco share</span></div>{groups.map((group, i) => <button className="rx-tg-row" key={group.name} onClick={() => openTG(group.name)} aria-label={`View ${displayTG(group.name)} brands`}><div className="rx-row-main"><div className="rx-row-name"><span className={`rx-group-mark rx-tone-${i % 4}`}><Layers3 size={17} /></span><div><strong>{displayTG(group.name)}</strong><small>{group.brands} Beximco {group.brands === 1 ? 'brand' : 'brands'}</small></div></div><div className="rx-row-value"><strong>{percent(group.share)}</strong><ChevronRight size={16} /></div></div><div className="rx-row-sub"><span>{number(group.own)} <span className="rx-muted">/ {number(group.market)} Rx</span></span></div><div className="rx-meter"><i style={{
                width: `${group.share || 0}%`
              }} /></div></button>)}<div className="rx-panel-foot"><span className="rx-live-dot" />Tap a TG to view its brands</div></section> : <section className="rx-performance"><div className="rx-panel-heading"><div><h2>Brand-wise performance</h2><span>Beximco brands · share of generic market</span></div><BarChart3 size={19} /></div><div className="rx-brand-controls"><label className="rx-search"><Search size={15} /><input placeholder="Search brand or generic" aria-label="Search dashboard brands" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear brand search" onClick={() => setSearch('')}><X size={14} /></button>}</label><div className="rx-sort" aria-label="Sort dashboard brands">{[['rx', 'Rx count'], ['share', 'Rx share'], ['name', 'A–Z']].map(([key, name]) => <button key={key} className={sort === key ? 'is-active' : ''} aria-pressed={sort === key} onClick={() => setSort(key)}>{name}</button>)}</div></div>{visibleBrands.length ? visibleBrands.map(brand => <article className="rx-brand-row" key={JSON.stringify([brand.generic, brand.name])}><div className="rx-row-main"><strong>{brand.name}</strong><div className="rx-brand-count">{number(brand.own)} <small>Rx</small></div></div><div className="rx-generic">{brand.generic}</div><div className="rx-brand-bottom"><div className="rx-meter"><i style={{
                  width: `${brand.share || 0}%`
                }} /></div><strong>{percent(brand.share)}</strong></div><div className="rx-brand-market">Generic market: {number(brand.market)} Rx</div>{tg === 'Unclassified' && onAssignTG && <BrandTGAssignment brand={brand.name} generic={brand.generic} options={tgOptions} onSave={target => onAssignTG(brand.name, brand.generic, target)}/>}</article>) : <div className="rx-state"><h3>{search ? 'No matching brands' : 'No Beximco Rx in this TG'}</h3><p>{search ? 'Try another brand or generic name.' : 'The market total includes all companies.'}</p></div>}{tg === 'Unclassified' && (tgOptionsError ? <div className="rx-info" role="alert">{tgOptionsError}{onRetry && <button className="rx-action" onClick={onRetry}>Retry TG choices</button>}</div> : onAssignTG && !tgOptions.length ? <div className="rx-panel-foot">TG choices need source TG information. If still loading, try again shortly.</div> : !onAssignTG ? <div className="rx-panel-foot">TG assignment is available to Admins and Editors.</div> : null)}</section>}
        <footer className="rx-data-foot">Based on active MRW sources. Shares use Rx counts.</footer>
      </>}
    </div>
    {!embedded && <nav className="rx-bottom" aria-label="Dashboard navigation"><button className={section === 'overview' ? 'is-active' : ''} onClick={overview}><Activity size={21} /><span>Overview</span></button><button className={section === 'tg' ? 'is-active' : ''} onClick={() => {
        setTG('');
        setSection('tg');
        setTimeout(() => document.getElementById('rx-tg-performance')?.scrollIntoView({
          behavior: 'smooth'
        }), 0);
      }}><Grid2X2 size={21} /><span>TG share</span></button><button className={section === 'brands' ? 'is-active' : ''} onClick={() => groups[0] && openTG(tg || groups[0].name)}><BarChart3 size={21} /><span>Brands</span></button>{onMail && <button onClick={onMail}><Mail size={21} /><span>Mail</span></button>}</nav>}
  </div>;
}
const sampleRows: DashboardRow[] = [['ANTI-ALLERGY', 'Ketotifen', 'TOFEN', 2200, 4500], ['ANTI-ALLERGY', 'Bilastine', 'BILLI', 1450, 6200], ['ANTI-ALLERGY', 'Montelukast', 'MONOCAST', 2100, 12500], ['GI SYSTEM', 'Esomeprazole', 'REMMO', 6500, 32000], ['GI SYSTEM', 'Omeprazole', 'OMEX', 2800, 21000], ['MUSCULO-SKELETAL', 'Paracetamol', 'NAPA', 15000, 54000], ['MUSCULO-SKELETAL', 'Paracetamol+Tramadol', 'NAPADOL', 3100, 7700], ['ANTI-INFECTIVE', 'Cefuroxime', 'FURACLV', 3900, 20800], ['CARDIOVASCULAR', 'Amlodipine', 'AMDOCAL', 2900, 16000]].flatMap(([tg, generic, brand, own, total]) => [{
  tg: String(tg),
  generic: String(generic),
  brand: String(brand),
  company: 'BEXIMCO',
  rx: Number(own)
}, {
  tg: String(tg),
  generic: String(generic),
  brand: 'Other brands',
  company: 'OTHER COMPANIES',
  rx: Number(total) - Number(own)
}]);
export const RxDashboardTGToBrand = () => {
  const [scope, setScope] = useState({
    from: '2026-07',
    to: '2026-07',
    range: false
  });
  const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  const count = Number(scope.to.slice(0, 4)) * 12 + Number(scope.to.slice(5)) - (Number(scope.from.slice(0, 4)) * 12 + Number(scope.from.slice(5))) + 1;
  const scale = (0.85 + Number(scope.to.slice(5)) * 0.03) * count;
  const label = (m: string) => `${new Date(m + '-01').toLocaleDateString('en-GB', {
    month: 'long'
  })}'${m.slice(2, 4)}`;
  return <div className="rx-design-phone"><RxDashboardView rows={sampleRows.map(r => ({
    ...r,
    rx: Math.round(r.rx * scale)
  }))} months={months} {...scope} sample periodLabel={`${label(scope.from)}${scope.from === scope.to ? '' : '–' + label(scope.to)}`} onPeriodChange={(from, to, range) => setScope({
    from,
    to,
    range
  })} /></div>;
};

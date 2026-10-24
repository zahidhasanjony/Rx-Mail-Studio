import { BarChart3, Target, Activity, Database } from 'lucide-react';
import { dashboardCompetitors, type DashboardRow } from './DashboardData';
import { preparationLabel } from '../../preparations';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const number = (value: number) => value.toLocaleString('en-GB');
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export function CompetitorRxShare({ rows, brand, generic, marketKey, forms }: { rows: DashboardRow[]; brand: string; generic: string; marketKey: string; forms: string[] }) {
  const market = dashboardCompetitors(rows, generic, marketKey);
  const selected = market.brands.filter(row => row.beximco && normalize(row.name) === normalize(brand));
  const selectedForms = selected.length ? selected.flatMap(row => row.forms) : forms;
  const own = selected.reduce((total, row) => total + row.rx, 0);
  const share = market.market ? own / market.market * 100 : null;
  const companies = [...new Set(selected.map(row => row.company || 'Company unavailable'))];
  return <div className="rx-competitor-page">
    <div className="rx-market-title"><h2>{brand} {companies.length > 0 && <span className="rx-company">({companies.join(', ')})</span>}</h2><p>{generic} · {preparationLabel(selectedForms)}</p></div>
    <section className="rx-kpis rx-market-kpis" aria-label={`${brand} generic market KPIs`}>
      <article className="rx-kpi rx-kpi-share"><div className="rx-kpi-top"><span className="rx-icon blue"><Target size={18}/></span></div><span className="rx-kpi-label">{brand} Rx share</span><strong>{percent(share)}</strong><div className="rx-meter"><i style={{ width: `${share || 0}%` }}/></div></article>
      <article className="rx-kpi"><div className="rx-kpi-top"><span className="rx-icon green"><Activity size={18}/></span></div><span className="rx-kpi-label">{brand} Rx</span><strong title={number(own)}>{number(own)}</strong><small>Occurrences in this period</small></article>
      <article className="rx-kpi"><div className="rx-kpi-top"><span className="rx-icon"><Database size={18}/></span></div><span className="rx-kpi-label">Generic market Rx</span><strong title={number(market.market)}>{number(market.market)}</strong><small>All companies · {market.brands.length} brands</small></article>
    </section>
    <section className="rx-performance" aria-label="Generic market brand ranking">
      <div className="rx-panel-heading"><div><h2>All brands · Rx share</h2><span>Highest to lowest · {generic} · {marketKey.startsWith('FORM:') ? preparationLabel(forms) : marketKey.toLowerCase()}</span></div><BarChart3 size={19}/></div>
      {market.brands.length ? <ol className="rx-competitor-list">{market.brands.map((row, index) => {
        const highlighted = row.beximco && normalize(row.name) === normalize(brand);
        return <li className={`rx-competitor-row${highlighted ? ' rx-selected-brand' : ''}`} key={JSON.stringify([row.name, row.company])} aria-current={highlighted ? 'true' : undefined}>
          <span className="rx-rank">{index + 1}</span><div className="rx-competitor-content">
            <div className="rx-row-main"><div className="rx-market-brand"><strong>{row.name || 'Unnamed brand'}</strong> <span className="rx-company">({row.company || 'Company unavailable'})</span>{highlighted && <span className="rx-selected-tag">Selected brand</span>}</div><div className="rx-brand-count">{number(row.rx)} <small>Rx</small></div></div>
            <div className="rx-generic">{preparationLabel(row.forms)}</div><div className="rx-brand-bottom"><div className="rx-meter"><i style={{ width: `${row.share || 0}%` }}/></div><strong>{percent(row.share)}</strong></div>
          </div>
        </li>;
      })}</ol> : <div className="rx-state"><h3>No Rx in this generic market</h3><p>Select another month or range to see the brand ranking.</p></div>}
      <div className="rx-panel-foot">Rx share = brand Rx ÷ {number(market.market)} generic market Rx</div>
    </section>
  </div>;
}

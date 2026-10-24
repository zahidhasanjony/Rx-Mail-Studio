import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from './types';
import type { Mode } from './storage';
import { cloudDashboard } from './storage';
import { coverage, eligibleDatasets } from './engine';
import { reportingMonths, reportingPeriod } from './reporting';
import { dashboardData, type DashboardRow } from './dashboard-model';
import { RxDashboardView } from './components/generated/RxDashboardTGToBrand';

export default function DashboardPage({ datasets, mode }: { datasets: Dataset[]; mode: Mode }) {
  const months = useMemo(() => [...new Set(datasets.filter(d => d.active).flatMap(d => reportingMonths(d.from.slice(0, 7), d.to.slice(0, 7))))].sort(), [datasets]);
  const latest = months.at(-1) || '';
  const [scope, setScope] = useState({ from: latest, to: latest, range: false }), [retry, setRetry] = useState(0);
  const from = scope.from || latest, to = scope.to || latest;
  const sourceVersion = datasets.map(d => [d.id, d.active, d.hash, d.from, d.to].join(':')).sort().join('|');
  const requestKey = `${sourceVersion}|${from}|${to}|${retry}`;
  const cache = useRef(new Map<string, DashboardRow[]>());
  const [remote, setRemote] = useState<{ key: string; rows: DashboardRow[]; error?: string }>({ key: '', rows: [] });
  useEffect(() => {
    if (mode !== 'cloud' || !from || !to) return;
    const saved = cache.current.get(requestKey);
    if (saved) { setRemote({ key: requestKey, rows: saved }); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    cloudDashboard(from, to, controller.signal).then(rows => {
      if (!controller.signal.aborted) { cache.current.set(requestKey, rows); setRemote({ key: requestKey, rows }); }
    }).catch(error => {
      // A timeout is visible; navigating away or changing months cancels silently.
      if (alive) setRemote({ key: requestKey, rows: [], error: controller.signal.aborted ? 'The summary took too long. Try again.' : (error as Error).message });
    }).finally(() => clearTimeout(timeout));
    let alive = true;
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [mode, requestKey, from, to]);
  const metadata = useMemo(() => {
    const sources = eligibleDatasets(datasets, from, to), dates = coverage(sources, from, to);
    return { dates, missing: reportingMonths(from, to).filter(m => !dates.some(d => d.startsWith(m))), limited: sources.some(s => s.includedGenerics && (!s.availableGenerics || s.includedGenerics.length < s.availableGenerics.length)) };
  }, [datasets, from, to]);
  const local = useMemo<{ rows: DashboardRow[]; error?: string }>(() => {
    if (mode === 'cloud') return { rows: [] as DashboardRow[] };
    try { return dashboardData(datasets, from, to); } catch (e) { return { rows: [] as DashboardRow[], error: (e as Error).message }; }
  }, [datasets, mode, from, to]);
  const current = remote.key === requestKey, rows = mode === 'cloud' ? current ? remote.rows : [] : local.rows;
  const error = mode === 'cloud' ? current ? remote.error : undefined : local.error;
  const notices = [];
  if (metadata.missing.length) notices.push(`No active source for ${metadata.missing.map(m => reportingPeriod(m)).join(', ')}. Totals include the available months only.`);
  if (metadata.limited) notices.push('Some sources contain selected generics only. These shares cover the imported markets.');
  const unclassified = rows.filter(r => r.tg === 'Unclassified').reduce((n, r) => n + r.rx, 0);
  if (unclassified) notices.push(`${unclassified.toLocaleString()} Rx occurrences are unclassified. Their source TG is missing or ambiguous; they remain in the overall total.`);
  return <RxDashboardView embedded rows={rows} months={months} from={from} to={to} range={scope.range}
    sample={mode === 'demo'} periodLabel={from ? reportingPeriod(from, to, 'all', metadata.dates) : 'No active sources'}
    loading={mode === 'cloud' && !!from && !current} error={error} notices={notices}
    onRetry={() => setRetry(n => n + 1)} onPeriodChange={(from, to, range) => setScope({ from, to, range })}/>;
}

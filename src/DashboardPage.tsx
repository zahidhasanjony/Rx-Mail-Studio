import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from './types';
import type { Mode } from './storage';
import { cloudDashboard, cloudDashboardTGs, assignCloudDashboardTG, localDashboardTGs, assignLocalDashboardTG } from './storage';
import { coverage, eligibleDatasets, normalize } from './engine';
import { isBeximcoCompany } from './catalogue';
import { reportingMonths, reportingPeriod } from './reporting';
import { dashboardData, mappedDashboardRows, type DashboardRow } from './dashboard-model';
import { RxDashboardView } from './components/generated/RxDashboardTGToBrand';
import { preparationKey, normalizePreparation } from './preparations';

export default function DashboardPage({ datasets, mode, canEdit }: { datasets: Dataset[]; mode: Mode; canEdit: boolean }) {
  const months = useMemo(() => [...new Set(datasets.filter(d => d.active).flatMap(d => reportingMonths(d.from.slice(0, 7), d.to.slice(0, 7))))].sort(), [datasets]);
  const latest = months.at(-1) || '';
  const [scope, setScope] = useState({ from: latest, to: latest, range: false }), [retry, setRetry] = useState(0);
  const from = scope.from || latest, to = scope.to || latest;
  const sourceVersion = datasets.map(d => [d.id, d.active, d.hash, d.from, d.to].join(':')).sort().join('|');
  const requestKey = `${sourceVersion}|${from}|${to}|${retry}`;
  const cache = useRef(new Map<string, DashboardRow[]>());
  const [remote, setRemote] = useState<{ key: string; rows: DashboardRow[]; error?: string }>({ key: '', rows: [] });
  const [cloudTGs, setCloudTGs] = useState<string[]>([]), [tgOptionsError, setTGOptionsError] = useState('');
  const [mappings, setMappings] = useState<Record<string, string>>({}), [mappingReady, setMappingReady] = useState(mode !== 'local'), [mappingError, setMappingError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  useEffect(() => {
    if (mode !== 'local') return;
    let alive = true;
    localDashboardTGs().then(saved => { if (alive) { setMappings(saved); setMappingReady(true); setMappingError(''); } })
      .catch(e => { if (alive) { setMappingReady(true); setMappingError('Saved TG mappings could not load: ' + (e as Error).message); } });
    return () => { alive = false; };
  }, [mode, retry]);
  useEffect(() => {
    if (mode !== 'cloud' || !canEdit) return;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    let alive = true;
    setTGOptionsError('');
    cloudDashboardTGs(controller.signal).then(options => { if (alive) setCloudTGs(options); })
      .catch(() => { if (alive) setTGOptionsError('TG choices could not load. Retry to get the complete list.'); }).finally(() => clearTimeout(timeout));
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [mode, canEdit, sourceVersion, retry]);
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
    return { dates, missing: reportingMonths(from, to).filter(m => !dates.some(d => d.startsWith(m))), limited: sources.some(s => {
      if (!s.includedGenerics) return false;
      if (!s.availableGenerics) return true;
      const included = new Set(s.includedGenerics.map(normalize));
      return s.availableGenerics.some(g => !included.has(normalize(g)));
    }) };
  }, [datasets, from, to]);
  const local = useMemo<{ rows: DashboardRow[]; error?: string }>(() => {
    if (mode === 'cloud') return { rows: [] as DashboardRow[] };
    try { const data = dashboardData(datasets, from, to); return { rows: mappedDashboardRows(data.rows, mappings, datasets) }; } catch (e) { return { rows: [] as DashboardRow[], error: (e as Error).message }; }
  }, [datasets, mode, from, to, mappings]);
  const current = remote.key === requestKey, rows = mode === 'cloud' ? current ? remote.rows : [] : local.rows;
  const error = mode === 'cloud' ? current ? remote.error : undefined : mappingError || local.error;
  const tgOptions = [...new Set([...cloudTGs, ...rows.map(r => r.tg), ...datasets.flatMap(d => [...Object.values(d.therapeuticGroups || {}), ...Object.values(d.preparationGroups || {})])]
    .map(normalize).filter(tg => tg && tg !== 'UNCLASSIFIED'))].sort();
  async function assignTG(brand: string, generic: string, forms: string[], tg: string) {
    if (!canEdit) throw new Error('TG editing requires Admin or Editor access.');
    if (!tgOptions.includes(tg)) throw new Error('Select a TG from the list.');
    const companies = [...new Set(rows.filter(r => normalize(r.brand) === normalize(brand) && normalize(r.generic) === normalize(generic) && forms.includes(normalizePreparation(r.form || '')) && isBeximcoCompany(r.company)).map(r => normalize(r.company)))];
    if (!companies.length) throw new Error('This brand is no longer available. Refresh the dashboard.');
    const keys = companies.flatMap(company => forms.map(form => preparationKey(generic, brand, company, form)));
    if (mode === 'cloud') {
      await assignCloudDashboardTG(generic, brand, companies, forms, tg);
      cache.current.clear(); setRetry(n => n + 1);
    } else if (mode === 'local') setMappings(await assignLocalDashboardTG(keys, tg));
    else setMappings(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, tg])) }));
    setSavedNotice(`${brand} assigned to ${tg}.${mode === 'demo' ? ' This is a sample-only change.' : ''}`);
  }
  const notices = [];
  if (savedNotice) notices.push(savedNotice);
  if (metadata.missing.length) notices.push(`No active source for ${metadata.missing.map(m => reportingPeriod(m)).join(', ')}. Totals include the available months only.`);
  if (metadata.limited) notices.push('Some sources contain selected generics only. These shares cover the imported markets.');
  return <RxDashboardView embedded rows={rows} months={months} from={from} to={to} range={scope.range}
    sample={mode === 'demo'} periodLabel={from ? reportingPeriod(from, to, 'all', metadata.dates) : 'No active sources'}
    loading={mode === 'cloud' ? !!from && !current : !mappingReady} error={error} notices={notices}
    tgOptions={tgOptions} tgOptionsError={tgOptionsError} onAssignTG={canEdit ? assignTG : undefined}
    onRetry={() => setRetry(n => n + 1)} onPeriodChange={(from, to, range) => { setSavedNotice(''); setScope({ from, to, range }); }}/>;
}

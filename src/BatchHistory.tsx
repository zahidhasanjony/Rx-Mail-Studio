import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, FileSpreadsheet, History, Mail, RefreshCw } from 'lucide-react';
import type { Batch } from './types';
import type { Mode } from './storage';
import { cloudBatch, cloudBatchHistory, HISTORY_PAGE_SIZE } from './storage';
import { summarizeBatch, type BatchSummary } from './batch-history';
import { reportingPeriod } from './reporting';
export default function BatchHistory({ batches, mode, ownerId, onLoaded, onView, onEml, onExcel, onGenerate }: {
  batches: Batch[]; mode: Mode; ownerId?: string; onLoaded: (batch: Batch) => void;
  onView: (batch: Batch) => void; onEml: (batch: Batch) => void; onExcel: (batch: Batch) => Promise<void>; onGenerate: () => void;
}) {
  const [remote, setRemote] = useState<BatchSummary[]>([]), [offset, setOffset] = useState(0), [more, setMore] = useState(false);
  const [loading, setLoading] = useState(mode === 'cloud'), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (mode !== 'cloud' || !ownerId) return;
    const controller = new AbortController(); let alive = true;
    setLoading(true); setError('');
    cloudBatchHistory(ownerId, offset, controller.signal).then(rows => {
      if (!alive) return;
      setRemote(previous => offset ? [...previous, ...rows] : rows); setMore(rows.length === HISTORY_PAGE_SIZE);
    }).catch(e => { if (alive) setError('Batch history could not load. ' + (e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [mode, ownerId, offset, retry]);
  useEffect(() => () => { active.current?.abort(); }, []);
  const rows = [...new Map([...remote, ...batches.map(summarizeBatch)].map(b => [b.id, b])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  async function open(id: string, action: 'view' | 'eml' | 'excel') {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setOpening(id); setError('');
    try {
      const batch = batches.find(b => b.id === id) || await cloudBatch(id, controller.signal);
      if (controller.signal.aborted) return;
      onLoaded(batch);
      if (action === 'view') onView(batch);
      else if (action === 'eml') onEml(batch);
      else await onExcel(batch);
    } catch (e) { if (!controller.signal.aborted) setError('This batch could not open. ' + (e as Error).message); }
    finally { if (active.current === controller) { active.current = null; setOpening(''); } }
  }
  return <section className="card">
    <div className="card-header"><h2>Prepared batches</h2><span className="count-badge">{rows.length}{more ? '+' : ''}</span></div>
    {error && <div className="notice warning" role="alert"><span>{error}</span><button onClick={() => setRetry(v => v + 1)} disabled={loading}><RefreshCw size={15}/>Retry history</button></div>}
    {loading && <p className="muted" role="status" style={{ padding: 20 }}>Loading batch history…</p>}
    {!!rows.length && <div className="batch-list">{rows.map(b => <div className="batch-row" key={b.id}>
      <div className="file-icon"><Mail size={21}/></div>
      <div className="source-info"><strong>{b.brand} · {b.generic}</strong>
        <small>{b.periodLabel || reportingPeriod(b.month, b.endMonth || b.month, b.period)} · {b.mailCount} regional emails · {new Date(b.createdAt).toLocaleString('en-GB')}</small>
        <small>{b.openedCount} opened · {b.failedCount} failed · {b.preparedCount} prepared</small></div>
      <button className="button secondary" disabled={!!opening} aria-label={`Download ${b.brand} ${b.month} .eml ZIP`} onClick={() => void open(b.id, 'eml')}><Download size={15}/>.eml ZIP</button>
      <button className="button secondary" disabled={!!opening} aria-label={`Download ${b.brand} ${b.month} Outlook Excel`} onClick={() => void open(b.id, 'excel')}><FileSpreadsheet size={15}/>Outlook Excel</button>
      <button className="button secondary" disabled={!!opening} onClick={() => void open(b.id, 'view')}>{opening === b.id ? 'Opening batch…' : 'View batch'}<ArrowRight size={15}/></button>
    </div>)}</div>}
    {more && !loading && <div style={{ padding: 20 }}><button className="button secondary" onClick={() => error ? setRetry(v => v + 1) : setOffset(n => n + HISTORY_PAGE_SIZE)}>Load older batches</button></div>}
    {!loading && !error && !rows.length && <div className="empty"><div className="empty-icon"><History size={26}/></div><h3>Your batch history lives here</h3><p>Generate your first regional update to keep a frozen record of its recipients, market definition and email content.</p><button className="button" onClick={onGenerate}>Generate emails<ArrowRight size={16}/></button></div>}
  </section>;
}

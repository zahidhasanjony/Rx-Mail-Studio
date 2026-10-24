import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Dataset } from './types';
import type { Sheet } from './excel';
import { clearStagedImport } from './import-staging';
import { automaticSourceSheet, fullMarketSource, planSourceImports } from './import-flow';
import { datasetGenericNames } from './markets';

type Entry = { key: string; file: File; sheets?: Sheet[]; source?: Dataset; error?: string };
export type SourceImportControl = { selectFiles(files: File[]): void };
type Props = {
  control: React.RefObject<SourceImportControl | null>;
  progress: number; progressText: string;
  cloud: boolean; disabled: boolean; demo: boolean; datasets: Dataset[];
  runWorker<T>(file: File | undefined, action: string, sheets?: Sheet[]): Promise<T>;
  onCommit(sources: Dataset[]): Promise<void>;
  onBusy(busy: boolean): void;
  notify(text: string, error?: boolean): void;
};
export default function SourceImportFlow({ control, cloud, disabled, demo, datasets, progress, progressText, runWorker, onCommit, onBusy, notify }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]), [working, setWorking] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const locked = useRef(false), dialog = useRef<HTMLDivElement>(null);
  const open = entries.length > 0;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close import review"]')?.click(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') || [])];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.isConnected && previous.focus(); };
  }, [open]);
  const decisions = useMemo(() => planSourceImports(entries.flatMap(e => e.source ? [e.source] : []), datasets), [entries, datasets]);
  const cleanup = async (items: Entry[]) => { for (const e of items) if (e.source?.stagedImportId) await clearStagedImport(e.source.stagedImportId).catch(() => {}); };
  async function prepare(entry: Entry, sheet: Sheet): Promise<Entry> {
    let source: Dataset | undefined;
    try {
      source = await runWorker<Dataset>(entry.file, cloud ? 'source-staged' : 'source', [sheet]);
      if (source.invalidRows) throw new Error(`${source.invalidRows.toLocaleString()} invalid rows. Correct missing doctor codes, generic names or dates and select the file again.`);
      source = await fullMarketSource(source);
      return { ...entry, source, error: undefined };
    } catch (e) {
      if (source?.stagedImportId) await clearStagedImport(source.stagedImportId).catch(() => {});
      return { ...entry, error: (e as Error).message };
    }
  }
  useImperativeHandle(control, () => ({ selectFiles: files => { void selectFiles(files); } }));
  async function selectFiles(files: File[]) {
    if (!files.length) return;
    if (disabled || locked.current || entries.length) { notify('Finish or cancel the current import before selecting more files.', true); return; }
    if (demo) { notify('Switch to your device workspace to import real data.', true); return; }
    locked.current = true; setWorking(true); onBusy(true);
    const next: Entry[] = files.map(file => ({ key: crypto.randomUUID(), file }));
    setEntries([...next]);
    try {
      for (let i = 0; i < next.length; i++) {
        setMessage(`Checking file ${i + 1} of ${next.length}: ${next[i].file.name}`);
        try {
          if (!next[i].file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Select an .xlsx workbook.');
          const sheets = await runWorker<Sheet[]>(next[i].file, 'inspect');
          next[i] = { ...next[i], sheets };
          if (!sheets.length) throw new Error('No worksheets found.');
          const sheet = automaticSourceSheet(sheets);
          if (sheet) next[i] = await prepare(next[i], sheet);
        } catch (e) { next[i] = { ...next[i], error: (e as Error).message }; }
        setEntries([...next]);
      }
    } finally { locked.current = false; setWorking(false); onBusy(false); setMessage(''); }
  }
  async function chooseSheet(key: string, path: string) {
    const entry = entries.find(e => e.key === key), sheet = entry?.sheets?.find(s => s.path === path);
    if (!entry || !sheet || locked.current) return;
    locked.current = true; setWorking(true); onBusy(true); setMessage(`Checking ${entry.file.name}`);
    try { const prepared = await prepare(entry, sheet); setEntries(rows => rows.map(e => e.key === key ? prepared : e)); }
    finally { locked.current = false; setWorking(false); onBusy(false); setMessage(''); }
  }
  if (!entries.length) return null;
  const ready = decisions.filter(d => d.status === 'ready');
  const blocked = entries.some(e => !e.source || e.error) || decisions.some(d => d.status === 'error');
  const close = async () => { if (locked.current) return; locked.current = true; await cleanup(entries); setEntries([]); locked.current = false; };
  async function commit() {
    if (locked.current || blocked) return;
    locked.current = true; setSaving(true); onBusy(true);
    try {
      await onCommit(ready.map(d => d.source));
      await cleanup(entries.filter(e => decisions.find(d => d.source.id === e.source?.id)?.status === 'skip'));
      setEntries([]);
    } catch (e) { notify((e as Error).message, true); }
    finally { locked.current = false; setSaving(false); onBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="source-review-title">
    <header><h2 id="source-review-title">Review Rx files</h2><button aria-label="Close import review" disabled={working || saving} onClick={() => void close()}>×</button></header>
    <div className="modal-body">
      <p>All generics and competitor brands are included automatically. Saved TG mappings apply to each preparation.</p>
      {(working || saving) && <p role="status">{saving ? 'Preparing import queue…' : message}{progressText && <> · {progressText} ({Math.max(0, Math.round(progress))}%)</>}</p>}
      <div className="source-batch-list">{entries.map(entry => {
        const decision = decisions.find(d => d.source.id === entry.source?.id);
        return <div className="source-batch-row" key={entry.key}>
          <strong>{entry.file.name}</strong>
          {entry.source && <><small>{entry.source.from} — {entry.source.to} · {entry.source.rows.toLocaleString()} Rx · {datasetGenericNames(entry.source).length} generics</small><small>{entry.source.sheets.join(', ')}</small></>}
          {!entry.source && entry.sheets?.length && !entry.error ? <label>Choose the sheet containing the complete Rx records<select aria-label={`Source sheet for ${entry.file.name}`} value="" disabled={working || saving} onChange={e => void chooseSheet(entry.key, e.target.value)}><option value="">Select sheet</option>{entry.sheets.map(s => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label> : null}
          {(entry.error || decision) && <p className={entry.error || decision?.status === 'error' ? 'error-text' : 'muted'}>{entry.error || decision?.message}</p>}
          <button className="text-link" disabled={working || saving} aria-label={`Remove ${entry.file.name}`} onClick={() => { void cleanup([entry]); setEntries(rows => rows.filter(e => e.key !== entry.key)); }}>Remove</button>
        </div>;
      })}</div>
      {blocked && !working && <p role="alert">Resolve the items above or remove those files to continue.</p>}
      {!blocked && <p className="tiny">{ready.length} file{ready.length === 1 ? '' : 's'} to import. Dashboard and mail analysis update after each file is verified. Unmapped TGs remain available under Unclassified.</p>}
    </div>
    <div className="modal-footer"><button className="button secondary" disabled={working || saving} onClick={() => void close()}>Cancel</button><button className="button primary" disabled={working || saving || blocked} onClick={() => void commit()}>{ready.length ? 'Import & Sync' : 'Done'}</button></div>
  </div></div>;
}

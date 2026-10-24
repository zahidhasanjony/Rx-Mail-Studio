import { useEffect, useRef, useState } from 'react';
import { MousePointer2, X, Trash2, Copy, ChevronUp } from 'lucide-react';
import './page-review.css';

type Request = { id: string; page: string; target: string; locator: string; action: 'Remove' | 'Change'; note: string };
const key = 'rx-page-review-v1';
function read(): Request[] {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(r => r && typeof r.id === 'string' && typeof r.target === 'string' && typeof r.page === 'string' && typeof r.locator === 'string' && typeof r.note === 'string' && ['Remove', 'Change'].includes(r.action)).slice(0, 100) : []; } catch { return []; }
}
function label(el: Element) {
  const heading = el.matches('h1,h2,h3,h4') ? el : el.querySelector('h1,h2,h3,h4');
  // Read visible labels only, never input values, password fields or embedded email documents.
  if (heading?.textContent?.trim()) return heading.textContent.trim().slice(0, 500);
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('input,textarea,select,iframe,script,style').forEach(n => n.remove());
  return (clone.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || el.tagName.toLowerCase()).slice(0, 500);
}
function locator(el: Element) {
  const parts: string[] = [];
  for (let n: Element | null = el; n && !n.matches('[data-review-root]'); n = n.parentElement) {
    const index = n.parentElement ? Array.from(n.parentElement.children).indexOf(n) + 1 : 1;
    parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return '[data-review-root] > ' + parts.join(' > ');
}
export default function PageReview() {
  const [active, setActive] = useState(false), [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<Request[]>(read);
  const [selected, setSelected] = useState<Element | null>(null);
  const [action, setAction] = useState<'Remove' | 'Change'>('Remove'), [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const highlighted = useRef<Element | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(requests)); } catch { setMessage('Browser storage is unavailable. Copy your list before closing.'); } }, [requests]);
  useEffect(() => {
    const clear = () => { highlighted.current?.classList.remove('review-highlight'); highlighted.current = null; };
    clear();
    if (selected?.isConnected) { selected.classList.add('review-highlight'); highlighted.current = selected; }
    return clear;
  }, [selected]);
  useEffect(() => { if (selected && open) panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [selected, open]);
  useEffect(() => {
    if (!active) return;
    function click(event: MouseEvent) {
      const el = event.target instanceof Element ? event.target : null;
      if (!el || el.closest('[data-review-ui],.sidebar,.mobile-bottom,.breadcrumbs')) return;
      if (!el.closest('[data-review-root]')) return;
      event.preventDefault(); event.stopPropagation();
      const target = el.closest('p,h1,h2,h3,h4,label,button,a,small,li,[role="status"],.notice,section,article') || el;
      setSelected(target); setNote(''); setAction('Remove'); setOpen(true); setMessage('');
    }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { setActive(false); setSelected(null); setOpen(false); } }
    document.addEventListener('click', click, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('keydown', escape); };
  }, [active]);
  function save() {
    if (!selected?.isConnected) { setSelected(null); setMessage('The page changed. Select the item again.'); return; }
    const page = [document.querySelector('.breadcrumbs strong')?.textContent || 'Login', ...Array.from(document.querySelectorAll('[data-review-root] h1')).map(n => n.textContent)].filter(Boolean).join(' / ');
    const path = locator(selected);
    const request: Request = { id: crypto.randomUUID(), page, target: label(selected), locator: path, action, note: note.trim() };
    setRequests(rows => [...rows.filter(r => !(r.page === page && r.locator === path)), request].slice(-100));
    setSelected(null); setOpen(false); setMessage('Added to your change list.');
  }
  const output = requests.map((r, i) => `${i + 1}. ${r.page}\n${r.action}: ${r.target}\n${r.note ? `Requested change: ${r.note}\n` : ''}Location: ${r.locator}`).join('\n\n');
  async function copy() {
    try { await navigator.clipboard.writeText(output); setMessage('Copied. Paste the list into our chat.'); }
    catch { setMessage('Copy is unavailable. Select and copy the text below.'); }
  }
  return <aside className="page-review" data-review-ui ref={panel} aria-label="Page change selection">
    {open && <section className="review-panel" aria-label={selected ? 'Selected item' : 'Change list'}>
      <div className="review-row"><strong>{selected ? 'Selected item' : `Change list (${requests.length})`}</strong><button type="button" aria-label="Close change panel" onClick={() => { setOpen(false); setSelected(null); }}><X size={18}/></button></div>
      {selected ? <>
        <blockquote>{label(selected)}</blockquote>
        <button type="button" disabled={!selected.parentElement || !!selected.parentElement.closest('[data-review-ui]') || selected.parentElement.matches('[data-review-root],#root,body,html')} onClick={() => setSelected(selected.closest('section,article,.panel,.card,.notice') !== selected && selected.closest('section,article,.panel,.card,.notice') || selected.parentElement)}><ChevronUp size={16}/> Select larger section</button>
        <div className="review-row"><label><input type="radio" name="review-action" checked={action === 'Remove'} onChange={() => setAction('Remove')}/> Remove</label><label><input type="radio" name="review-action" checked={action === 'Change'} onChange={() => setAction('Change')}/> Change</label></div>
        <label className="review-note">{action === 'Change' ? 'What should change?' : 'Note (optional)'}<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder={action === 'Change' ? 'Enter new wording or describe the change…' : 'Any instructions…'}/></label>
        <button type="button" className="review-primary" disabled={action === 'Change' && !note.trim()} onClick={save}>Add to change list</button>
      </> : <>
        <p>Saved on this device. These are requests; the app changes after you share the list in chat.</p>
        {!requests.length && <p>No items selected yet. Turn on Select mode, then tap text or a section.</p>}
        <ol>{requests.map(r => <li key={r.id}><div className="review-row"><strong>{r.page}</strong><button type="button" aria-label={`Remove request for ${r.target}`} onClick={() => setRequests(rows => rows.filter(row => row.id !== r.id))}><Trash2 size={16}/></button></div><span>{r.action}: {r.target}</span>{r.note && <p>{r.note}</p>}</li>)}</ol>
        {requests.length > 0 && <><button type="button" className="review-primary" onClick={() => void copy()}><Copy size={16}/> Copy list for chat</button><details><summary>View text to copy manually</summary><textarea aria-label="Change list text" readOnly value={output}/></details></>}
      </>}
    </section>}
    {message && <p className="review-message" role="status">{message}</p>}
    <div className="review-toolbar">
      <button type="button" className={active ? 'review-primary' : ''} aria-pressed={active} onClick={() => { setActive(v => !v); setOpen(false); setSelected(null); setMessage(''); }}><MousePointer2 size={17}/>{active ? 'Done selecting' : 'Select changes'}</button>
      <button type="button" onClick={() => { setOpen(true); setSelected(null); setMessage(''); }}>Review ({requests.length})</button>
    </div>
    {active && <small className="review-hint">Tap to select. Use page navigation to switch pages. Turn selection off to use filters or open a brand.</small>}
  </aside>;
}

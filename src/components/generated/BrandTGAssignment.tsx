import { useState } from 'react';

export function BrandTGAssignment({ brand, generic, options, onSave }: {
  brand: string; generic: string; options: string[]; onSave: (tg: string) => Promise<void>;
}) {
  const [tg, setTG] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function save() {
    if (!tg || saving) return;
    setSaving(true); setError('');
    try { await onSave(tg); } catch (e) { setError((e as Error).message || 'The TG could not be saved. Try again.'); }
    finally { setSaving(false); }
  }
  return <div className="rx-tg-assignment">
    <label><span>Assign therapeutic group</span><select aria-label={`Select TG for ${brand} (${generic})`} value={tg} disabled={saving || !options.length}
      onChange={e => { setTG(e.target.value); setError(''); }}>
      <option value="">Select TG</option>{options.map(option => <option value={option} key={option}>{option}</option>)}
    </select></label>
    <button type="button" className="rx-action" aria-label={`Save TG for ${brand} (${generic})`} disabled={!tg || saving} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save'}</button>
    <small>Applies to this brand and generic across all months.</small>
    {error && <div className="rx-assignment-error" role="alert">{error}</div>}
  </div>;
}

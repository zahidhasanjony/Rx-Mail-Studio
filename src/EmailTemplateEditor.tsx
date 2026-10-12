import { defaultEmailTemplate } from "./types";
import type { EmailTemplate } from "./types";
import { templateError } from "./email-template";

export default function EmailTemplateEditor({ value, onChange }: { value: EmailTemplate; onChange: (value: EmailTemplate) => void }) {
  const error = templateError(value);
  return <div className="email-template-editor">
    <label className="field"><span>Email subject</span><input value={value.subject} onChange={e => onChange({ ...value, subject: e.target.value })} /></label>
    <label className="field"><span>Opening message</span><textarea rows={3} value={value.opening} onChange={e => onChange({ ...value, opening: e.target.value })} /><small>Appears immediately after “Dear … Bhai,”.</small></label>
    <label className="field"><span>Email body</span><textarea rows={6} value={value.body} onChange={e => onChange({ ...value, body: e.target.value })} /><small>Add your text around the table fields. Keep each table field exactly once.</small></label>
    <p className="template-help">Regional details: {"{Generic}, {Brand}, {Region}, {Structure}, {Period}, {RSE}"}<br />Tables: {"{RegionalShare}, {ASEShare}, {MPEShare}, {Prescribers}"}</p>
    {error && <p className="template-error" role="alert">{error}</p>}
    <button type="button" className="text-link" onClick={() => onChange({ ...defaultEmailTemplate })}>Restore default wording</button>
  </div>;
}

import { useState } from "react";
import { Smartphone } from "lucide-react";
import { outlookConfigError } from "./outlook-auth";
import type { OutlookConfig } from "./outlook-auth";

export default function OutlookConnection({ config, mailbox, busy, onSave, onConnect, onDisconnect }: {
  config: OutlookConfig; mailbox: string; busy: boolean;
  onSave: (config: OutlookConfig) => Promise<void>;
  onConnect: () => Promise<void>; onDisconnect: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const missing = !!outlookConfigError(config);
  return <section className="card small-card connection-card outlook-connection">
    <div className="connection-icon"><Smartphone size={24} /></div>
    <h3>Android Outlook mail</h3>
    <p>{mailbox || "Create regional drafts, then review and send in Outlook."}</p>
    <div className="bridge-actions">
      <button className="button secondary" disabled={busy || missing} onClick={() => void onConnect()}>{mailbox ? "Change Microsoft account" : "Connect Microsoft account"}</button>
      {mailbox && <button className="button text" disabled={busy} onClick={() => void onDisconnect()}>Disconnect</button>}
    </div>
    <details open={missing ? true : undefined}>
      <summary>Microsoft connection setup</summary>
      <p className="tiny">Ask your Microsoft 365 administrator to register Rx Mail Studio as a single-page application with delegated Mail.ReadWrite and User.Read permissions.</p>
      <p className="tiny">Redirect address: <code>{window.location.origin}/outlook-auth.html</code></p>
      <label>Application (client) ID<input value={draft.clientId} onChange={event => setDraft({ ...draft, clientId: event.target.value })} autoComplete="off" /></label>
      <label>Directory (tenant) ID<input value={draft.tenantId} onChange={event => setDraft({ ...draft, tenantId: event.target.value })} autoComplete="off" /></label>
      <button className="button secondary" disabled={busy} onClick={() => void onSave(draft)}>Save Microsoft setup</button>
    </details>
  </section>;
}

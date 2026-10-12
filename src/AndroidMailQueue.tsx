import { useRef, useState } from "react";
import { Copy, Mail as MailIcon, ChevronRight } from "lucide-react";
import type { Batch } from "./types";
import { copyAndroidBody, individualMailLink } from "./android-mail";
import { plainText } from "./export";

export default function AndroidMailQueue({ batch, initialMailId, sample = false, onPreview }: {
  batch: Pick<Batch, "id" | "mails"> & { settings: Pick<Batch["settings"], "email"> }; initialMailId?: string; sample?: boolean;
  onPreview: (mailId: string) => void;
}) {
  const [index, setIndex] = useState(Math.max(0, batch.mails.findIndex(mail => mail.id === initialMailId)));
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [manual, setManual] = useState(false);
  const copyRunning = useRef(false), selection = useRef<HTMLTextAreaElement>(null);
  const mail = batch.mails[index];
  if (!mail) return <p>No emails in this batch.</p>;
  let link = "", error = "";
  try { link = individualMailLink(mail); } catch (cause) { error = (cause as Error).message; }
  const choose = (next: number) => { setIndex(next); setMessage(""); setManual(false); };
  async function copy() {
    if (copyRunning.current) return;
    copyRunning.current = true; setCopying(true); setMessage("");
    try {
      const result = await copyAndroidBody(mail);
      setMessage(result === "formatted" ? "Body copied with HTML and text. Open Outlook and paste into the message." : "Complete body copied as plain text. Open Outlook and paste into the message.");
    } catch (cause) { setMessage((cause as Error).message); setManual(true); }
    finally { copyRunning.current = false; setCopying(false); }
  }
  return <div className="android-mail-queue">
    <div className="android-region-choice">
      <label>Region<select value={index} disabled={copying} onChange={event => choose(Number(event.target.value))}>
        {batch.mails.map((mail, index) => <option key={mail.id} value={index}>{mail.structure} {mail.region} · {mail.to.name}</option>)}
      </select></label>
      <span>{index + 1} / {batch.mails.length}</span>
    </div>
    <div className="android-envelope">
      <p><strong>From</strong> {batch.settings.email}</p>
      <p><strong>To</strong> {mail.to.email}</p>
      <p><strong>CC</strong> {mail.cc.map(contact => contact.email).join("; ") || "None"}</p>
      <p><strong>Subject</strong> {mail.subject}</p>
    </div>
    <p className="tiny">Copy the body, open the mail app, then paste. Choose Outlook if Android asks, and check the sender account before sending. Outlook may simplify table formatting.</p>
    {sample && <p className="tiny">Sample emails cannot open the mail app.</p>}
    {error && <p className="outlook-error" role="alert">{error}</p>}
    <div className="android-mail-actions">
      <button className="button" disabled={copying || !!error} onClick={() => void copy()}><Copy size={16} />{copying ? "Copying…" : "Copy email body"}</button>
      {sample || error || copying ? <button className="button secondary" disabled><MailIcon size={16} />Open mail app</button> :
        <a className="button secondary" href={link}><MailIcon size={16} />Open mail app</a>}
      <button className="button text" disabled={copying} onClick={() => onPreview(mail.id)}>Preview email</button>
    </div>
    {message && <p className="tiny" role="status" aria-live="polite">{message}</p>}
    <details open={manual ? true : undefined}>
      <summary>Selectable email body</summary>
      <textarea ref={selection} aria-label="Selectable email body" readOnly value={plainText(mail.html)} rows={10} />
      <button className="button text" onClick={() => { selection.current?.focus(); selection.current?.select(); }}>Select body</button>
    </details>
    <div className="android-queue-navigation">
      <button className="button secondary" disabled={copying || index === 0} onClick={() => choose(index - 1)}>Previous region</button>
      <button className="button secondary" disabled={copying || index === batch.mails.length - 1} onClick={() => choose(index + 1)}>Next region<ChevronRight size={16} /></button>
    </div>
  </div>;
}

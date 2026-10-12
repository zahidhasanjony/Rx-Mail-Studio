import type { Batch, Mail, Contact } from "./types";
import { emailValid } from "./engine";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const DRAFT_PROPERTY = "String {79592d58-c8b1-4f69-8265-c125a5e1bd0d} Name RxMailBatchMessage";
type GraphCall = (path: string, init?: RequestInit) => Promise<any>;
type Journal = Pick<Storage, "getItem" | "setItem">;
export class OutlookGraphError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function graphClient(token: string, fetcher: typeof fetch = fetch, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): GraphCall {
  return async (path, init = {}) => {
    // Only relative Graph paths; never forward a bearer token to another host.
    const method = (init.method || "GET").toUpperCase();
    if (!/^\/me(?:\/messages)?(?:\?.*)?$/.test(path) || !["GET", "POST"].includes(method) || (method === "POST" && path !== "/me/messages")) throw new Error("Invalid Outlook request.");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetcher(GRAPH + path, {
          ...init, signal: AbortSignal.timeout(30000),
          headers: { ...init.headers, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' },
        });
      } catch { throw new Error("Outlook connection interrupted. Retry this batch to check for drafts already created."); }
      if (response.status === 429 && attempt < 3) {
        const delay = Number(response.headers.get("Retry-After") || 5);
        if (!Number.isFinite(delay) || delay > 60) throw new OutlookGraphError("Outlook is busy. Wait and retry this batch.", 429);
        await wait(Math.max(1, delay) * 1000);
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new OutlookGraphError(
        response.status === 401 ? "Microsoft sign-in expired. Reconnect Outlook and retry." :
        response.status === 403 ? "Microsoft denied mailbox access. Ask your Microsoft 365 administrator to allow Mail.ReadWrite for this app." :
        data.error?.message || "Outlook could not prepare this email.", response.status,
      );
      return data;
    }
  };
}
const recipient = (contact: Contact) => ({ emailAddress: { name: contact.name, address: contact.email.trim() } });
export function draftPayload(batch: Batch, mail: Mail) {
  if (!emailValid(mail.to.email) || mail.cc.some(contact => !emailValid(contact.email))) throw new Error("Check this email's To and CC addresses.");
  return {
    subject: mail.subject,
    body: { contentType: "HTML", content: mail.html },
    toRecipients: [recipient(mail.to)], ccRecipients: mail.cc.map(recipient),
    singleValueExtendedProperties: [{ id: DRAFT_PROPERTY, value: batch.id + ":" + mail.id }],
  };
}
const quote = (value: string) => value.replaceAll("'", "''");
export async function createOutlookDrafts(batch: Batch, graph: GraphCall, journal: Journal, onProgress: (done: number, total: number, batch: Batch) => void): Promise<Batch> {
  const profile = await graph("/me?$select=mail,userPrincipalName");
  const mailbox = String(profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (!mailbox || ![profile.mail, profile.userPrincipalName].some(value => String(value || "").toLowerCase() === batch.settings.email.trim().toLowerCase())) {
    throw new Error("Connected Outlook mailbox does not match the batch sender (" + batch.settings.email + "). Connect the correct account or generate a new batch with your sender email.");
  }
  const updated = { ...batch, mails: batch.mails.map(mail => ({ ...mail, outlookDraft: mail.outlookDraft?.mailbox === mailbox ? mail.outlookDraft : undefined })) };
  for (let index = 0; index < updated.mails.length; index++) {
    const mail = updated.mails[index];
    const checkpointKey = "rxm-outlook-draft-v1:" + JSON.stringify([mailbox, batch.id, mail.id]);
    // Journal is metadata only: no message bodies, tokens or doctor data.
    let checkpoint: Mail["outlookDraft"];
    try { checkpoint = JSON.parse(journal.getItem(checkpointKey) || "null"); } catch { /* Check the mailbox instead. */ }
    if (mail.outlookDraft?.status === "Created" && mail.outlookDraft.mailbox === mailbox) checkpoint = mail.outlookDraft;
    if (checkpoint?.status === "Created" && checkpoint.mailbox === mailbox) mail.outlookDraft = checkpoint;
    else {
      try {
        const body = draftPayload(batch, mail);
        const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${DRAFT_PROPERTY}' and ep/value eq '${quote(batch.id + ":" + mail.id)}')`;
        const found = await graph("/me/messages?$select=id&$top=1&$filter=" + encodeURIComponent(filter));
        if (!Array.isArray(found.value)) throw new Error("Outlook returned an invalid draft lookup. Retry this batch.");
        const message = found.value[0] || await graph("/me/messages", { method: "POST", body: JSON.stringify(body) });
        if (!message.id) throw new Error("Outlook did not confirm the draft. Retry this batch to check its status.");
        mail.outlookDraft = { mailbox, status: "Created", messageId: message.id, createdAt: new Date().toISOString() };
        try { journal.setItem(checkpointKey, JSON.stringify(mail.outlookDraft)); } catch { /* The mailbox marker also supports recovery. */ }
      } catch (error) {
        mail.outlookDraft = { mailbox, status: "Failed", error: (error as Error).message };
        onProgress(index + 1, updated.mails.length, updated);
        // Stop on connection/auth/service errors rather than repeating across every region.
        if (!(error instanceof OutlookGraphError) || [401, 403, 429].includes(error.status) || error.status >= 500) break;
        continue;
      }
    }
    onProgress(index + 1, updated.mails.length, updated);
  }
  return updated;
}

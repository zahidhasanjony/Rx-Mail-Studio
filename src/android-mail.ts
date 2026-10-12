import type { Mail } from "./types";
import { emailAddress, plainText } from "./export";

// Mail links carry only the envelope. Report bodies can exceed Android/client
// link limits; copy the entire body separately rather than truncate a report.
export function individualMailLink(mail: Mail): string {
  const to = emailAddress(mail.to);
  const seen = new Set([to.toLowerCase()]);
  const cc = mail.cc.map(contact => emailAddress(contact)).filter(email => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const subject = mail.subject.replace(/[\u0000-\u001f\u007f]/g, " ");
  return "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) +
    (cc.length ? "&cc=" + encodeURIComponent(cc.join(",")) : "");
}

export interface ClipboardPort {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}
export async function copyAndroidBody(mail: Mail, clipboard: ClipboardPort = navigator.clipboard, makeItem: ((data: Record<string, Blob>) => ClipboardItem) | undefined = typeof ClipboardItem === "undefined" ? undefined : data => new ClipboardItem(data)): Promise<"formatted" | "plain"> {
  const text = plainText(mail.html);
  if (clipboard?.write && makeItem) {
    try {
      await clipboard.write([makeItem({
        "text/html": new Blob([mail.html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return "formatted";
    } catch { /* Use the complete text fallback if rich copying is unavailable. */ }
  }
  if (clipboard?.writeText) {
    try { await clipboard.writeText(text); return "plain"; } catch { /* Offer manual selection in the UI. */ }
  }
  throw new Error("Copy is blocked by this browser. Use the selectable body below to copy manually.");
}

import { zipSync, strToU8 } from "fflate";
import type { Batch, Contact, Mail, Settings, Hierarchy } from "./types";
export function download(
  content: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}

const crlf = (value: string) => value.replace(/\r\n|\r|\n/g, "\r\n");
const headerText = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
function base64(value: string) {
  const bytes = strToU8(value);
  let binary = "";
  // Avoid spreading large HTML tables onto the JavaScript call stack.
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function encodedWords(value: string) {
  const words: string[] = [];
  let chunk = "", size = 0;
  // Split on Unicode characters, never inside a UTF-8 sequence.
  for (const character of headerText(value)) {
    const length = strToU8(character).length;
    if (size + length > 36) {
      words.push(`=?UTF-8?B?${base64(chunk)}?=`);
      chunk = "";
      size = 0;
    }
    chunk += character;
    size += length;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
  return words;
}
function address(contact: Contact) {
  const email = contact.email.trim();
  if (
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email)
  ) throw new Error("An email address is invalid. Check To, CC and your signature email.");
  return [...encodedWords(contact.name), `<${email}>`].join(" ");
}
function foldedHeader(name: string, value: string) {
  let line = name + ":", output = "";
  for (const token of value.split(" ").filter(Boolean)) {
    if (line.length + token.length + 1 > 76) {
      output += line + "\r\n";
      line = " " + token;
    } else line += " " + token;
  }
  return output + line;
}
function plainText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|tr|table|li)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
      const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function mimePart(type: string, body: string) {
  return `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(crlf(body)).match(/.{1,76}/g)?.join("\r\n") || ""}\r\n`;
}
export function mailEml(
  mail: Mail,
  sender: Pick<Settings, "name" | "email">,
  createdAt = new Date().toISOString(),
) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error("The email creation date is invalid.");
  const boundary = "rxm_" + crypto.randomUUID();
  const headers = [
    "X-Unsent: 1",
    foldedHeader("From", address(sender)),
    foldedHeader("To", address(mail.to)),
    ...(mail.cc.length ? [foldedHeader("Cc", mail.cc.map(address).join(", "))] : []),
    foldedHeader("Subject", encodedWords(mail.subject).join(" ")),
    "Date: " + date.toUTCString().replace("GMT", "+0000"),
    `Message-ID: <${mail.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || crypto.randomUUID()}@rx-mail-studio.local>`,
    "MIME-Version: 1.0",
    foldedHeader("Content-Type", `multipart/alternative; boundary="${boundary}"`),
  ];
  return headers.join("\r\n") + "\r\n\r\n" +
    `--${boundary}\r\n` + mimePart("text/plain", plainText(mail.html)) +
    `--${boundary}\r\n` + mimePart("text/html", mail.html) +
    `--${boundary}--\r\n`;
}
function filePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "email";
}
export function emlFilename(mail: Mail) {
  return `${filePart(mail.structure)}-${filePart(mail.region)}-${filePart(mail.subject)}.eml`;
}
export function emlPackageFilename(batch: Batch) {
  return `rx-mail-${filePart(batch.brand)}-${filePart(batch.month + (batch.endMonth && batch.endMonth !== batch.month ? "-to-" + batch.endMonth : ""))}-${filePart(batch.id).slice(0, 8)}-eml.zip`;
}
export function emlPackage(batch: Batch) {
  if (!batch.mails.length) throw new Error("This batch has no emails to export.");
  const files: Record<string, Uint8Array> = {};
  const width = Math.max(3, String(batch.mails.length).length);
  batch.mails.forEach((mail, index) => {
    const name = `${String(index + 1).padStart(width, "0")}-${emlFilename(mail)}`;
    files[name] = strToU8(mailEml(mail, batch.settings, batch.createdAt));
  });
  files["README.txt"] = strToU8(crlf(
    "Rx Mail Studio — regional .eml emails\n\n" +
    "1. Extract this ZIP. Each .eml is one separate regional email, with its own To and CC.\n" +
    "2. Open an .eml file in Outlook. It includes the Rx share summary, prescriber table and signature.\n" +
    "3. Review the sender account, To, CC and body, then send manually.\n\n" +
    "Files include X-Unsent: 1 to request an editable message. Email clients handle this differently; check a single file before opening the full batch. If your client opens a read-only message, use its edit/compose option or the app's optional Classic Outlook launcher.\n" +
    "No PowerShell or companion is needed to download or open these files. This export does not send emails or create Outlook drafts. Outlook may autosave a message after you open it. Downloading does not change opening status in the app.\n" +
    "Keep this package private: it contains recipients and prescriber information.\n",
  ));
  return zipSync(files);
}
export function outlookPackage(batch: Batch) {
  const data = {
    schemaVersion: 1,
    batchId: batch.id,
    mails: batch.mails.map((m) => ({
      id: m.id,
      to: m.to.email,
      cc: m.cc.map((c) => c.email),
      subject: m.subject,
      html: m.html,
    })),
  };
  const script = `param([string]$BatchPath = (Join-Path $PSScriptRoot 'batch.rxmail.json'))
$ErrorActionPreference = 'Stop'
try {
  $batch = Get-Content -LiteralPath $BatchPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($batch.schemaVersion -ne 1) { throw 'Unsupported batch format' }
  $outlook = New-Object -ComObject Outlook.Application
  $results = @()
  foreach ($mail in $batch.mails) {
    try {
      $item = $outlook.CreateItem(0)
      $to = $item.Recipients.Add([string]$mail.to)
      $to.Type = 1
      foreach ($address in $mail.cc) { $recipient = $item.Recipients.Add([string]$address); $recipient.Type = 2 }
      if (-not $item.Recipients.ResolveAll()) { throw 'Outlook could not resolve a recipient. This message was not opened.' }
      $item.Subject = [string]$mail.subject
      $item.BodyFormat = 2
      $item.HTMLBody = [string]$mail.html
      $item.Display($false)
      $results += @{ id = $mail.id; status = 'Opened' }
      Start-Sleep -Milliseconds 150
    } catch { $results += @{ id = $mail.id; status = 'Failed'; error = $_.Exception.Message } }
  }
  @{ schemaVersion = 1; batchId = $batch.batchId; results = $results } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'outlook-results.json') -Encoding UTF8
  Write-Host 'Finished. Import outlook-results.json into Rx Mail Studio to update opening status.'
  Write-Host 'Review and send each message in Outlook. This launcher only displays messages.'
} catch { Write-Host ('Unable to open Classic Outlook: ' + $_.Exception.Message) -ForegroundColor Red; Write-Host 'This requires Windows and Microsoft Classic Outlook, not New Outlook.' }
Read-Host 'Press Enter to close'
`;
  const readme = `Rx Mail Studio — Outlook launcher\r\n\r\n1. Extract this ZIP into a folder on your Windows PC.\r\n2. Double-click Open-Outlook.cmd with Classic Outlook installed and your account configured.\r\n3. All prepared emails open as editable Outlook compose windows. Review and send them manually.\r\n4. Upload outlook-results.json on the History page to record the real opening results.\r\n\r\nThis launcher never calls Save or Send. Outlook itself may autosave open messages according to your Outlook settings. New Outlook and mobile Outlook do not support this Windows COM launcher.\r\nKeep this package private: it contains your recipients and prescriber tables.\r\n`;
  return zipSync({
    "batch.rxmail.json": strToU8(JSON.stringify(data)),
    "Open-Outlook.ps1": strToU8(script),
    "Open-Outlook.cmd": strToU8(
      '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Outlook.ps1"\r\n',
    ),
    "README.txt": strToU8(readme),
  });
}

export function hierarchyCsv(hierarchy: Hierarchy): string {
  const size = Math.max(0, ...hierarchy.rows.map(r => r.cc.length));
  const headers = ["Structure", "Region", "RSE Name", "RSE Email", "Salutation", "Active",
    ...Array.from({ length: size }, (_, i) => [`CC${i + 1} Title`, `CC${i + 1} Name`, `CC${i + 1} Email`]).flat()];
  const cell = (value: string) => `"${(/^[=+@\-\t\r\n]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return "\ufeff" + [headers, ...hierarchy.rows.map(r => [r.structure, r.region, r.rseName, r.rseEmail, r.salutation, r.active ? "Yes" : "No",
    ...Array.from({ length: size }, (_, i) => [r.cc[i]?.title || "", r.cc[i]?.name || "", r.cc[i]?.email || ""]).flat()])]
    .map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

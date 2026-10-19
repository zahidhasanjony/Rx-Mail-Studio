import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { Batch } from "./types";
import { emailAddress } from "./export";
import { reportingPeriod } from "./reporting";

export const OUTLOOK_EXCEL_TEMPLATE = "/Outlook-Emails-Template-v1.xlsm";
export const OUTLOOK_EXCEL_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.12";
const FIRST_MAIL_ROW = 11;
const MAX_ROWS = 1048576;
const BODY_CHUNK_SIZE = 16000;

function xmlText(value: string): string {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDFFF]/u.test(value))
    throw new Error("An email contains a character Excel cannot store. Check its wording and download again.");
  // Preserve literal Excel escape patterns, XML entities, CRs and whitespace.
  return value.replace(/_x[0-9a-f]{4}_/gi, token => "_x005F_" + token.slice(1))
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", "&#13;");
}
function textCell(ref: string, value: string, style?: string) {
  if (value.length > 32767) throw new Error(`Email field ${ref} exceeds Excel's text limit.`);
  return `<x:c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><x:is><x:t xml:space="preserve">${xmlText(value)}</x:t></x:is></x:c>`;
}
function numberCell(ref: string, value: number, style?: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("An Excel batch value is invalid.");
  return `<x:c r="${ref}"${style ? ` s="${style}"` : ""}><x:v>${value}</x:v></x:c>`;
}
function bodyParts(html: string) {
  if (!html.length) throw new Error("An email has an empty body. Generate the batch again.");
  if (html.length > 2147483647) throw new Error("An email body exceeds the Outlook Excel limit.");
  const parts: string[] = [];
  for (let start = 0; start < html.length;) {
    let end = Math.min(start + BODY_CHUNK_SIZE, html.length);
    // Do not split an emoji or another UTF-16 surrogate pair across cells.
    if (end < html.length && /[\uD800-\uDBFF]/.test(html[end - 1])) end--;
    parts.push(html.slice(start, end));
    start = end;
  }
  return parts;
}

export function outlookExcelFilename(batch: Batch) {
  const part = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "batch";
  return `rx-mail-${part(batch.brand)}-${part(batch.month + (batch.endMonth && batch.endMonth !== batch.month ? "-to-" + batch.endMonth : ""))}-${part(batch.id).slice(0, 8)}.xlsm`;
}

/** Populate the artifact-authored template, preserving its VBA and Forms button. */
export function outlookExcel(batch: Batch, template: Uint8Array): Uint8Array {
  if (!batch.mails.length) throw new Error("This batch has no emails to export.");
  if (batch.mails.length + FIRST_MAIL_ROW - 1 > MAX_ROWS) throw new Error("This batch exceeds Excel's row limit.");
  const files = unzipSync(template);
  const mainPath = "xl/worksheets/sheet1.xml", bodyPath = "xl/worksheets/sheet2.xml";
  if (!files[mainPath] || !files[bodyPath] || !files["xl/vbaProject.bin"] || !files["xl/drawings/vmlDrawing1.vml"])
    throw new Error("The Outlook Excel template is unavailable. Refresh the app and try again.");
  const main = strFromU8(files[mainPath]), bodies = strFromU8(files[bodyPath]);
  const data = main.match(/<x:sheetData>([\s\S]*?)<\/x:sheetData>/)?.[1];
  if (!data) throw new Error("The Outlook Excel template is invalid.");
  const headerRows = [...data.matchAll(/<x:row\b[^>]* r="(\d+)"[^>]*>[\s\S]*?<\/x:row>/g)]
    .filter(match => Number(match[1]) < FIRST_MAIL_ROW).map(match => match[0]);
  if (headerRows.length !== FIRST_MAIL_ROW - 1) throw new Error("The Outlook Excel template headers are invalid.");
  const columnStyle = (col: string) => main.match(new RegExp(`<x:c r="${col}${FIRST_MAIL_ROW}"[^>]* s="([^"]+)"`))?.[1];
  const period = batch.periodLabel || reportingPeriod(batch.month, batch.endMonth || batch.month, batch.period);
  headerRows[2] = headerRows[2].replace(/<x:c r="A3"[^>]*>[\s\S]*?<\/x:c>/, () => textCell("A3", `${batch.brand} / ${batch.generic} - ${period} - ${batch.mails.length} emails`, main.match(/<x:c r="A3"[^>]* s="([^"]+)"/)?.[1]));
  const mailRows: string[] = [], payload: string[] = [];
  let bodyRow = 2;
  const ids = new Set<string>();
  batch.mails.forEach((mail, index) => {
    if (!mail.id || ids.has(mail.id)) throw new Error("Email IDs are missing or duplicated. Generate a new batch.");
    ids.add(mail.id);
    const chunks = bodyParts(mail.html);
    if (bodyRow + chunks.length - 1 > MAX_ROWS) throw new Error("The email bodies exceed Excel's row limit. Export a smaller batch.");
    const row = FIRST_MAIL_ROW + index;
    const strings: Record<string, string> = {
      B: `${mail.structure} ${mail.region}`, C: emailAddress(mail.to),
      D: mail.cc.map(emailAddress).join("; "), E: mail.subject,
      // Every download is a fresh opening session; app/companion statuses remain unchanged.
      F: "Prepared", G: "", H: mail.id,
    };
    const values: Record<string, number> = { A: index + 1, I: bodyRow, J: chunks.length, K: mail.html.length };
    mailRows.push(`<x:row r="${row}" ht="48" customHeight="1">` +
      "ABCDEFGHIJK".split("").map(col => col in strings ? textCell(col + row, strings[col], columnStyle(col)) : numberCell(col + row, values[col], columnStyle(col))).join("") + "</x:row>");
    chunks.forEach((chunk, part) => {
      const ref = bodyRow++;
      payload.push(`<x:row r="${ref}">${textCell("A" + ref, mail.id)}${numberCell("B" + ref, part + 1)}${textCell("C" + ref, chunk)}</x:row>`);
    });
  });
  files[mainPath] = strToU8(main.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/, () => `<x:sheetData>${headerRows.join("")}${mailRows.join("")}</x:sheetData>`));
  files[bodyPath] = strToU8(bodies.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/, () => `<x:sheetData><x:row r="1">${textCell("A1", "Mail ID")}${textCell("B1", "Part")}${textCell("C1", "HTML body chunk")}</x:row>${payload.join("")}</x:sheetData>`));
  return zipSync(files);
}

export async function loadOutlookExcel(batch: Batch) {
  const response = await fetch(OUTLOOK_EXCEL_TEMPLATE);
  if (!response.ok) throw new Error("Unable to download the Outlook Excel template. Check your connection and try again.");
  return outlookExcel(batch, new Uint8Array(await response.arrayBuffer()));
}

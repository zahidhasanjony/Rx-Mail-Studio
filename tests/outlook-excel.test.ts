import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8, zipSync } from "fflate";
// @ts-expect-error jsdom is used by the existing test harness without bundled types.
import { JSDOM } from "jsdom";
import { outlookExcel, outlookExcelFilename, OUTLOOK_EXCEL_TYPE } from "../src/outlook-excel";
import { defaultSettings, starterProfiles } from "../src/types";
import type { Batch, Mail } from "../src/types";

const template = new Uint8Array(readFileSync(new URL("../public/Outlook-Emails-Template-v1.xlsm", import.meta.url)));
const mail: Mail = { id: "test-mail", region: "A1", structure: "ACD", to: { name: "RSE name", email: "rse@example.com" },
  cc: [{ name: "Boss", email: "boss@example.com" }, { name: "Team", email: "team@example.com" }, { name: "Hierarchy", email: "zone@example.com" }],
  subject: "Ketotifen (TOFEN) Prescriber List of A1 Region for July'26", html: '<html><body><p>Dear Bhai,</p><table><tr><td style="color:red;font-weight:bold">Dr &amp; colleague</td></tr></table><p>বাংলা 🩺</p>\r\n_x0041_ $&</body></html>', doctorCount: 1, rxCount: 8, status: "Prepared" };
const batch: Batch = { id: "batch-test", createdAt: "2026-10-12T08:00:00Z", brand: "TOFEN", generic: "Ketotifen", month: "2026-07", settings: defaultSettings, profile: starterProfiles[0], hierarchyId: "hierarchy", sourceIds: [], mails: [mail] };
const xml = (files: Record<string, Uint8Array>, path: string) => new JSDOM(strFromU8(files[path]), { contentType: "application/xml" }).window.document;
function cells(doc: Document) {
  return new Map([...doc.getElementsByTagNameNS("*", "c")].map(cell => {
    const raw = cell.textContent || "";
    return [cell.getAttribute("r"), raw.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))];
  }));
}

test("Excel batch retains bare addresses in order, frozen wording, full HTML and opening status isolation", () => {
  const original = structuredClone(batch);
  const files = unzipSync(outlookExcel(batch, template));
  const main = cells(xml(files, "xl/worksheets/sheet1.xml"));
  const body = cells(xml(files, "xl/worksheets/sheet2.xml"));
  assert.equal(main.get("B11"), "ACD A1");
  assert.equal(main.get("C11"), "rse@example.com");
  assert.equal(main.get("D11"), "boss@example.com; team@example.com; zone@example.com");
  assert.equal(main.get("E11"), mail.subject);
  assert.equal(main.get("F11"), "Prepared");
  assert.equal(body.get("C2"), mail.html);
  assert.equal(main.get("K11"), String(mail.html.length));
  assert.match(main.get("A3")!, /July'26 - 1 emails/);
  assert.equal(main.get("A12"), undefined, "No stale template mail remains");
  for (const name of ["xl/vbaProject.bin", "xl/drawings/vmlDrawing1.vml", "xl/worksheets/_rels/sheet1.xml.rels"])
    assert.deepEqual(files[name], unzipSync(template)[name]);
  assert.equal(OUTLOOK_EXCEL_TYPE, "application/vnd.ms-excel.sheet.macroEnabled.12");
  assert.deepEqual(batch, original);
});

test("51+ emails and long Unicode doctor tables reconstruct completely without crossing Excel text limits", () => {
  const long = "x".repeat(15999) + "🩺" + mail.html.repeat(600);
  const group: Batch = { ...batch, month: "2026-03", endMonth: "2026-07", period: "first", mails: Array.from({ length: 76 }, (_, i) => ({ ...mail, id: `mail-${i}`, region: "A" + i, html: long + i, status: i % 2 ? "Opened" : "Failed" })) };
  const files = unzipSync(outlookExcel(group, template));
  const doc = xml(files, "xl/worksheets/sheet1.xml"), main = cells(doc);
  const payloadDoc = xml(files, "xl/worksheets/sheet2.xml"), payload = cells(payloadDoc);
  assert.equal(doc.getElementsByTagNameNS("*", "row").length, 86);
  assert.match(main.get("A3")!, /March'26.*July'26.*1st Flash/);
  for (let i = 0; i < group.mails.length; i++) {
    const row = 11 + i, first = Number(main.get(`I${row}`)), count = Number(main.get(`J${row}`));
    let reconstructed = "";
    assert.equal(main.get(`F${row}`), "Prepared");
    for (let part = 0; part < count; part++) {
      assert.equal(payload.get(`A${first + part}`), `mail-${i}`);
      assert.equal(payload.get(`B${first + part}`), String(part + 1));
      const chunk = payload.get(`C${first + part}`)!;
      assert.ok(chunk.length <= 16000);
      assert.ok(!/[\uD800-\uDFFF]/u.test(chunk), "No isolated surrogate halves");
      reconstructed += chunk;
    }
    assert.equal(reconstructed, group.mails[i].html);
    assert.equal(Number(main.get(`K${row}`)), reconstructed.length);
  }
  for (const c of payloadDoc.getElementsByTagNameNS("*", "t")) assert.ok(c.textContent!.length <= 32767);
});

test("macro workbook has a bound Forms button, matching codenames and review-only VBA with retries", () => {
  const files = unzipSync(template);
  assert.match(strFromU8(files["[Content_Types].xml"]), /application\/vnd.ms-excel.sheet.macroEnabled.main\+xml/);
  assert.match(strFromU8(files["xl/_rels/workbook.xml.rels"]), /http:\/\/schemas.microsoft.com\/office\/2006\/relationships\/vbaProject/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /codeName="ThisWorkbook"/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /state="veryHidden" name="Email bodies"/);
  assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]), /codeName="Sheet1"/);
  assert.match(strFromU8(files["xl/worksheets/sheet2.xml"]), /codeName="Sheet2"/);
  assert.match(strFromU8(files["xl/drawings/vmlDrawing1.vml"]), /ObjectType="Button"/);
  assert.match(strFromU8(files["xl/drawings/vmlDrawing1.vml"]), /\[0\]!OpenAllEmails/);
  const script = readFileSync(new URL("../assets/outlook/RxMail.bas", import.meta.url), "utf8");
  assert.match(script, /Public Sub OpenAllEmails\(\)/);
  assert.match(script, /CreateObject\("Outlook.Application"\)/);
  assert.match(script, /item\.Display False/);
  assert.match(script, /Recipients\.ResolveAll/);
  assert.match(script, /CStr\(sheet\.Cells\(row, 6\)\.Value2\) = "Opened"/);
  assert.match(script, /Len\(ReadBody\) <> expected/);
  assert.ok(!/\.(?:Send|Save)\b|Shell\s*\(|Workbook_Open|Auto_Open|powershell|cmd\.exe/i.test(script));
  const output = execFileSync("python", ["-c", "import importlib.util,sys,zipfile; s=importlib.util.spec_from_file_location('vba',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); z=zipfile.ZipFile(sys.argv[2]); v=m.read_cfb(z.read('xl/vbaProject.bin')); assert v['VBA/_VBA_PROJECT']==bytes.fromhex('CC61FFFF000100'); sys.stdout.buffer.write(m.decompress(v['VBA/RxMail']))", new URL("../scripts/build-outlook-vba.py", import.meta.url).pathname, new URL("../public/Outlook-Emails-Template-v1.xlsm", import.meta.url).pathname]);
  assert.equal(output.toString("utf8").replaceAll("\r\n", "\n"), script);
});

test("Excel export treats formula-looking data as text and rejects unsafe recipients or invalid payloads", () => {
  const files = unzipSync(outlookExcel({ ...batch, brand: "$& TOFEN", mails: [{ ...mail, subject: '=HYPERLINK("https://example.com")', html: '<p>=1+1 &amp; _x000D_</p>' }] }, template));
  const doc = xml(files, "xl/worksheets/sheet1.xml");
  assert.equal(doc.getElementsByTagNameNS("*", "f").length, 0);
  assert.equal(cells(doc).get("E11"), '=HYPERLINK("https://example.com")');
  assert.match(cells(doc).get("A3")!, /^\$& TOFEN/);
  assert.throws(() => outlookExcel({ ...batch, mails: [] }, template), /no emails/);
  assert.throws(() => outlookExcel({ ...batch, mails: [mail, mail] }, template), /duplicated/);
  assert.throws(() => outlookExcel({ ...batch, mails: [{ ...mail, to: { ...mail.to, email: "rse@example.com\r\nBcc:evil@example.com" } }] }, template), /invalid/);
  assert.throws(() => outlookExcel({ ...batch, mails: [{ ...mail, html: "" }] }, template), /empty body/);
  assert.throws(() => outlookExcel({ ...batch, mails: [{ ...mail, html: "<p>\u0000</p>" }] }, template), /character/);
  assert.throws(() => outlookExcel({ ...batch, mails: [{ ...mail, subject: "x".repeat(32768) }] }, template), /text limit/);
  const bad = unzipSync(template); delete bad["xl/vbaProject.bin"];
  assert.throws(() => outlookExcel(batch, zipSync(bad)), /template/);
  assert.ok(!/[\\/\r\n]/.test(outlookExcelFilename({ ...batch, brand: "../../TOFEN" })));
  assert.ok(outlookExcelFilename(batch).endsWith(".xlsm"));
});

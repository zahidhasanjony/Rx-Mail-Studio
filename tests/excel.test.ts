import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import {
  inspectWorkbook,
  importRx,
  mapHierarchy,
  hierarchyColumns,
} from "../src/excel";
const xml = (s: string) => strToU8(s),
  escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function workbook(includeAse = false, conflictingAse = false) {
  const headers = [
    "Prescription Date",
    "Generic Name",
    "Brand Name",
    "Company Name",
    "Dosage Description",
    "Dr Code",
    "Dr Name/Institute Name",
    "Doc Specialty",
    "ACD RSE",
    "ACD MPE",
    "CCD. RSE Code",
    "CCD. MPE Code",
  ];
  if (includeAse) headers.push("ACD ASE", "CCD.ASE Code");
  const strings = [
    ...headers,
    "Ketotifen",
    "TOFEN",
    "BEXIMCO",
    "SYP",
    "DOC001",
    "Dr Test & Team",
    "Medicine",
    "D5",
    "D501",
    "D6",
    "D601",
    ...(includeAse ? ["D500", "D600", "OTHER"] : []),
  ];
  const cell = (col: number, value: string, shared = true) =>
    `<c r="${String.fromCharCode(65 + col)}2"${shared ? ' t="s"' : ""}><v>${value}</v></c>`;
  const values = [
    "46188",
    ...Array.from({ length: 11 }, (_, i) => String(headers.length + i)),
    ...(includeAse ? [String(headers.length + 11), String(headers.length + 12)] : []),
  ];
  const laterValues = [...values];
  if (conflictingAse) laterValues[12] = String(strings.length - 1);
  return new File(
    [
      zipSync({
        "xl/workbook.xml": xml(
          '<workbook xmlns:r="urn:r"><sheets><sheet name="TRD TEST" r:id="rId1"/></sheets></workbook>',
        ),
        "xl/_rels/workbook.xml.rels": xml(
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        "xl/sharedStrings.xml": xml(
          `<sst>${strings.map((s) => `<si><t>${escape(s)}</t></si>`).join("")}</sst>`,
        ),
        "xl/worksheets/sheet1.xml": xml(
          `<worksheet><sheetData><row r="1">${headers.map((_, i) => `<c r="${String.fromCharCode(65 + i)}1" t="s"><v>${i}</v></c>`).join("")}</row><row r="2">${values.map((s, i) => cell(i, s, i > 0)).join("")}<c r="${String.fromCharCode(65 + headers.length)}2"/></row><row r="3">${laterValues.map((s, i) => cell(i, s, i > 0).replace('2"', '3"')).join("")}</row></sheetData></worksheet>`,
        ),
      }) as unknown as BlobPart,
    ],
    "test.xlsx",
  );
}
test("streaming Excel import handles shared strings, XML entities and self-closing cells", async () => {
  const file = workbook(),
    sheets = await inspectWorkbook(file);
  assert.equal(sheets[0].name, "TRD TEST");
  const d = await importRx(file, sheets);
  assert.equal(d.rows, 2);
  assert.equal(d.invalidRows, 0);
  assert.equal(d.facts.length, 1);
  assert.equal(d.facts[0].count, 2);
  assert.equal(d.facts[0].doctorName, "Dr Test & Team");
  assert.equal(d.facts[0].acdRegion, "D5");
  assert.deepEqual(d.facts[0].sourceRows, [2, 3]);
  assert.equal(d.catalog[0].brand, "TOFEN");
});
test("catalogue discovery includes Beximco pairs outside the retained Rx markets and excludes competitors", async () => {
  const archive = unzipSync(new Uint8Array(await workbook().arrayBuffer()));
  const row = (number: number, company: string, brand: string) => {
    const fields = ["Montelukast", brand, company, "TAB", "DOC002", "Dr New", "Medicine", "D5", "D501", "D6", "D601"];
    return `<row r="${number}"><c r="A${number}"><v>46188</v></c>${fields.map((value,i) => `<c r="${String.fromCharCode(66+i)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join("")}</row>`;
  };
  archive["xl/worksheets/sheet1.xml"] = xml(strFromU8(archive["xl/worksheets/sheet1.xml"]).replace("</sheetData>",row(4,"Beximco Pharmaceuticals PLC","NEWBEX")+row(5,"Other company","COMPETITOR")+"</sheetData>"));
  const file = new File([zipSync(archive) as unknown as BlobPart],"new-markets.xlsx");
  const imported = await importRx(file,await inspectWorkbook(file),()=>{},["Ketotifen"]);
  assert.ok(imported.facts.every(f => f.generic === "Ketotifen"));
  assert.equal(imported.facts[0].count,2);
  assert.equal(imported.catalog.find(p => p.brand === "NEWBEX")?.company,"Beximco Pharmaceuticals PLC");
  assert.ok(!imported.catalog.some(p => p.brand === "COMPETITOR"));
  assert.ok(imported.availableGenerics?.includes("Montelukast"), "Generic discovery is independent of the retained Rx scope");
  archive["xl/worksheets/sheet1.xml"] = xml(strFromU8(archive["xl/worksheets/sheet1.xml"]).replace("</sheetData>",row(6,"Other company","COMPETITOR-ONLY").replace("Montelukast","Tramadol")+"</sheetData>"));
  const expandedFile = new File([zipSync(archive) as unknown as BlobPart],"extra-market.xlsx");
  const expanded = await importRx(expandedFile,await inspectWorkbook(expandedFile),()=>{},["Ketotifen","Tramadol"]);
  assert.ok(expanded.availableGenerics?.includes("Tramadol"));
  assert.ok(expanded.facts.some(f=>f.generic==="Tramadol"), "Competitor-only generic prescribers can be imported");
  assert.ok(!expanded.catalog.some(p=>p.generic==="Tramadol"), "Competitor-only generic does not create an own-brand pair");
});
test("ASE columns are preserved and legacy mappings require one verified parent", async () => {
  const file = workbook(true);
  const ds = await importRx(file, await inspectWorkbook(file));
  assert.equal(ds.facts[0].acdAse, "D500");
  assert.equal(ds.facts[0].ccdAse, "D600");
  assert.equal(ds.aseByMpe?.ACD['["D5","D501"]'], "D500");
  const changed = workbook(true, true);
  const ambiguous = await importRx(changed, await inspectWorkbook(changed));
  assert.equal(ambiguous.facts.length, 2, "Different actual ASE assignments must not be collapsed");
  assert.equal(ambiguous.aseByMpe?.ACD['["D5","D501"]'], undefined, "Do not guess an ASE when an MPE has multiple parents");
});
test("quarterly hierarchy mapping is explicit and validates territory structure", () => {
  const mapping = Object.fromEntries(hierarchyColumns.map((c, i) => [c, i]));
  const rows = [
    hierarchyColumns,
    [
      "ACD",
      "D5",
      "Sample",
      "rse@example.com",
      "Sample Bhai",
      "MDR",
      "manager@example.com",
      "",
      "",
      "",
      "",
      "Yes",
    ],
  ];
  const r = mapHierarchy(rows, mapping);
  assert.equal(r[0].cc[0].email, "manager@example.com");
  assert.equal(r[0].salutation, "Sample Bhai");
  assert.throws(
    () => mapHierarchy([hierarchyColumns, ["Wrong", "D5"]], mapping),
    /Invalid structure/,
  );
});

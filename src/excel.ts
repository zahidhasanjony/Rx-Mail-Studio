import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { normalize } from "./engine";
import type { BrandProfile, Dataset, HierarchyRow, Contact, RxFact } from "./types";
export interface Sheet {
  name: string;
  path: string;
}
type Progress = (percent: number, message: string) => void;
const tag = (s: string) => s.split(":").pop()!;
async function readZip(
  file: Blob,
  select: (name: string) => ((s: string, final: boolean) => void) | undefined,
  onProgress: Progress,
  base = 0,
  range = 100,
) {
  let failure: Error | undefined;
  const zip = new Unzip((entry) => {
    const consume = select(entry.name);
    if (!consume) return;
    const decoder = new TextDecoder();
    entry.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      try {
        consume(decoder.decode(data, { stream: !final }), final);
      } catch (e) {
        failure = e as Error;
      }
    };
    entry.start();
  });
  zip.register(UnzipInflate);
  const reader = file.stream().getReader();
  let read = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += 65536) {
        const part = value.subarray(offset, offset + 65536);
        zip.push(part, false);
        if (failure) throw failure;
        read += part.length;
        onProgress(base + (read / file.size) * range, "Reading workbook");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    zip.push(new Uint8Array(), true);
    if (failure) throw failure;
  } finally {
    reader.releaseLock();
  }
}
export async function inspectWorkbook(
  file: Blob,
  onProgress: Progress = () => {},
): Promise<Sheet[]> {
  let workbook = "",
    rels = "";
  await readZip(
    file,
    (name) =>
      name === "xl/workbook.xml"
        ? (s) => {
            workbook += s;
          }
        : name === "xl/_rels/workbook.xml.rels"
          ? (s) => {
              rels += s;
            }
          : undefined,
    onProgress,
  );
  const relationships: Record<string, string> = {};
  const rp = new SaxesParser();
  rp.on("opentag", (n) => {
    if (tag(n.name) === "Relationship") {
      const a = n.attributes as Record<string, string>;
      const path = a.Target.startsWith("/")
        ? a.Target.slice(1)
        : "xl/" + a.Target.replace(/^\.\//, "");
      relationships[a.Id] = path;
    }
  });
  rp.write(rels).close();
  const sheets: Sheet[] = [];
  const wp = new SaxesParser();
  wp.on("opentag", (n) => {
    if (tag(n.name) === "sheet") {
      const a = n.attributes as Record<string, string>;
      if (relationships[a["r:id"]])
        sheets.push({ name: a.name, path: relationships[a["r:id"]] });
    }
  });
  wp.write(workbook).close();
  if (!sheets.length)
    throw new Error(
      "No readable worksheet found. Please upload an .xlsx workbook.",
    );
  return sheets;
}
async function sharedStrings(file: Blob, progress: Progress) {
  const strings: string[] = [];
  let current = "",
    inside = false,
    inText = false;
  const parser = new SaxesParser();
  parser.on("opentag", (n) => {
    if (tag(n.name) === "si") {
      inside = true;
      current = "";
    }
    if (inside && tag(n.name) === "t") inText = true;
  });
  parser.on("text", (s) => {
    if (inText) current += s;
  });
  parser.on("closetag", (n) => {
    if (tag(n.name) === "t") inText = false;
    if (tag(n.name) === "si") {
      strings.push(current);
      inside = false;
    }
  });
  await readZip(
    file,
    (name) =>
      name === "xl/sharedStrings.xml"
        ? (s, final) => {
            parser.write(s);
            if (final) parser.close();
          }
        : undefined,
    progress,
    0,
    40,
  );
  return strings;
}
function columnIndex(ref: string) {
  let n = 0;
  for (const c of ref.match(/^[A-Z]+/)?.[0] || "A")
    n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
function rowParser(
  strings: string[],
  consume: (row: string[], line: number) => void,
) {
  const p = new SaxesParser();
  let row: string[] = [],
    line = 0,
    column = 0,
    type = "",
    value = "",
    reading = false;
  p.on("opentag", (n) => {
    const a = n.attributes as Record<string, string>,
      name = tag(n.name);
    if (name === "row") {
      row = [];
      line = Number(a.r) || line + 1;
    }
    if (name === "c") {
      column = columnIndex(a.r || "A");
      type = a.t || "";
      value = "";
    }
    if (name === "v" || name === "t") reading = true;
  });
  p.on("text", (s) => {
    if (reading) value += s;
  });
  p.on("closetag", (n) => {
    const name = tag(n.name);
    if (name === "v" || name === "t") reading = false;
    if (name === "c")
      row[column] = type === "s" ? strings[Number(value)] || "" : value;
    if (name === "row") consume(row, line);
  });
  return p;
}
export function parseRxDate(s: string) {
  if (!s) return "";
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 1 || n > 100000) return "";
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const match = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const date = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date)
      return date;
  }
  return "";
}
const keys = {
  date: ["PRESCRIPTION DATE"],
  generic: ["GENERIC NAME"],
  brand: ["BRAND NAME"],
  company: ["COMPANY NAME"],
  form: ["DOSAGE DESCRIPTION"],
  doctorCode: ["DR CODE", "DOCTOR CODE"],
  doctorName: ["DR NAME/INSTITUTE NAME", "DOCTOR NAME"],
  specialty: ["DOC SPECIALTY", "SPECIALTY"],
  acdRegion: ["ACD RSE"],
  acdMpe: ["ACD MPE"],
  acdAse: ["ACD ASE"],
  ccdRegion: ["CCD. RSE CODE", "CCD RSE CODE"],
  ccdMpe: ["CCD. MPE CODE", "CCD MPE CODE"],
  ccdAse: ["CCD.ASE CODE", "CCD. ASE CODE", "CCD ASE CODE"],
};
export async function importRx(
  file: File,
  sheets: Sheet[],
  progress: Progress = () => {},
  generics?: string[],
): Promise<Dataset> {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const strings = await sharedStrings(file, progress),
    facts = new Map<string, RxFact>(),
    catalog = new Map<string, BrandProfile>(),
    dates = new Set<string>(),
    regions = { ACD: new Set<string>(), CCD: new Set<string>() },
    aseParents = { ACD: new Map<string, Set<string>>(), CCD: new Map<string, Set<string>>() },
    regionDates: Record<"ACD" | "CCD", Map<string, Set<string>>> = {
      ACD: new Map(),
      CCD: new Map(),
    },
    scope = generics ? new Set(generics.map(normalize)) : undefined;
  let rows = 0,
    invalidRows = 0,
    from = "9999-12-31",
    to = "0000-01-01";
  const parsers = new Map(
    sheets.map((sheet) => {
      let indices: Record<string, number> = {};
      let headerFound = false;
      const parser = rowParser(strings, (row, line) => {
        if (!headerFound) {
          const headers = row.map(normalize);
          if (!headers.includes("GENERIC NAME")) return;
          for (const [k, aliases] of Object.entries(keys))
            indices[k] = headers.findIndex((h) => aliases.includes(h));
          if (
            [
              "date",
              "generic",
              "brand",
              "doctorCode",
              "doctorName",
              "acdRegion",
              "ccdRegion",
            ].some((k) => indices[k] < 0)
          )
            throw new Error(`${sheet.name}: required MRW columns are missing.`);
          headerFound = true;
          return;
        }
        if (!row.some((v) => v?.trim())) return;
        rows++;
        const get = (k: string) => String(row[indices[k]] || "").trim();
        const date = parseRxDate(get("date")),
          generic = get("generic"),
          doctorCode = get("doctorCode");
        if (!date || !generic || !doctorCode) {
          invalidRows++;
          return;
        }
        from = date < from ? date : from;
        to = date > to ? date : to;
        const f: RxFact = {
          date,
          generic,
          brand: normalize(get("brand")) || "UNBRANDED",
          company: get("company"),
          form: normalize(get("form")),
          doctorCode,
          doctorName: get("doctorName") || doctorCode,
          specialty: get("specialty"),
          acdRegion: normalize(get("acdRegion")),
          acdMpe: normalize(get("acdMpe")),
          acdAse: normalize(get("acdAse")),
          ccdRegion: normalize(get("ccdRegion")),
          ccdMpe: normalize(get("ccdMpe")),
          ccdAse: normalize(get("ccdAse")),
          count: 1,
          sourceRow: line,
          sheet: sheet.name,
        };
        dates.add(date);
        for (const [structure, region, mpe, ase] of [
          ["ACD", f.acdRegion, f.acdMpe, f.acdAse],
          ["CCD", f.ccdRegion, f.ccdMpe, f.ccdAse],
        ] as const) {
          if (!region || !mpe) continue;
          const key = JSON.stringify([region, mpe]);
          const parents = aseParents[structure].get(key) || new Set<string>();
          parents.add(ase || "");
          aseParents[structure].set(key, parents);
        }
        if (f.acdRegion) regions.ACD.add(f.acdRegion);
        if (f.ccdRegion) regions.CCD.add(f.ccdRegion);
        for (const [structure, region] of [
          ["ACD", f.acdRegion],
          ["CCD", f.ccdRegion],
        ] as const) {
          if (!region) continue;
          let days = regionDates[structure].get(region);
          if (!days) {
            days = new Set();
            regionDates[structure].set(region, days);
          }
          days.add(date);
        }
        if (!scope || scope.has(normalize(generic))) {
          const key = JSON.stringify([
            f.date,
            f.generic,
            f.brand,
            f.form,
            f.doctorCode,
            f.acdRegion,
            f.acdMpe,
            f.ccdRegion,
            f.ccdMpe,
            f.acdAse,
            f.ccdAse,
            f.doctorName,
            f.specialty,
          ]);
          const previous = facts.get(key);
          if (previous) {
            previous.count++;
            previous.sourceRows ??= [previous.sourceRow];
            previous.sourceRows.push(line);
          } else facts.set(key, f);
        }
        if (/BEXIMCO/i.test(f.company)) {
          const ck = JSON.stringify([f.generic, f.brand]);
          let p = catalog.get(ck);
          if (!p) {
            p = { id: ck, generic: f.generic, brand: f.brand, forms: [] };
            catalog.set(ck, p);
          }
          if (f.form && !p.forms.includes(f.form)) p.forms.push(f.form);
        }
      });
      return [sheet.path, { parser, getHeader: () => headerFound }] as const;
    }),
  );
  await readZip(
    file,
    (name) => {
      const state = parsers.get(name);
      return state
        ? (s, final) => {
            state.parser.write(s);
            if (final) {
              state.parser.close();
              if (!state.getHeader())
                throw new Error(`${name}: MRW header row not found.`);
            }
          }
        : undefined;
    },
    progress,
    40,
    59,
  );
  if (from === "9999-12-31")
    throw new Error(
      "No valid prescription records found in the selected sheets.",
    );
  progress(100, `Processed ${rows.toLocaleString()} product occurrences`);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    hash,
    includedGenerics: generics,
    importedAt: new Date().toISOString(),
    active: true,
    rows,
    invalidRows,
    from,
    to,
    sheets: sheets.map((s) => s.name),
    facts: [...facts.values()],
    catalog: [...catalog.values()].sort((a, b) =>
      a.brand.localeCompare(b.brand),
    ),
    regions: { ACD: [...regions.ACD], CCD: [...regions.CCD] },
    regionDates: {
      ACD: Object.fromEntries(
        [...regionDates.ACD].map(([region, dates]) => [
          region,
          [...dates].sort(),
        ]),
      ),
      CCD: Object.fromEntries(
        [...regionDates.CCD].map(([region, dates]) => [
          region,
          [...dates].sort(),
        ]),
      ),
    },
    dates: [...dates].sort(),
    aseByMpe: {
      ACD: Object.fromEntries([...aseParents.ACD].filter(([, parents]) => parents.size === 1 && !parents.has("")).map(([key, parents]) => [key, [...parents][0]])),
      CCD: Object.fromEntries([...aseParents.CCD].filter(([, parents]) => parents.size === 1 && !parents.has("")).map(([key, parents]) => [key, [...parents][0]])),
    },
  };
}
export async function readSheetRows(
  file: File,
  sheet: Sheet,
  progress: Progress = () => {},
) {
  const strings = await sharedStrings(file, progress),
    rows: string[][] = [];
  const parser = rowParser(strings, (row) => {
    if (row.some((v) => v?.trim())) rows.push(row);
  });
  await readZip(
    file,
    (name) =>
      name === sheet.path
        ? (s, final) => {
            parser.write(s);
            if (final) parser.close();
          }
        : undefined,
    progress,
    40,
    60,
  );
  return rows;
}
export const hierarchyColumns = [
  "Structure",
  "Region",
  "RSE Name",
  "RSE Email",
  "Salutation",
  "MDR Name",
  "MDR Email",
  "MST Name",
  "MST Email",
  "OBR Name",
  "OBR Email",
  "Active",
];
export interface HierarchyCcMapping {
  title: string;
  titleColumn: number;
  nameColumn: number;
  emailColumn: number;
}
export function extraHierarchyCcMappings(headers: string[]): HierarchyCcMapping[] {
  return headers.flatMap((header, emailColumn) => {
    const match = header.match(/^(.+?)\s+Email$/i);
    if (!match || ["RSE", "MDR", "MST", "OBR"].includes(normalize(match[1]))) return [];
    const title = match[1].trim();
    return [{ title, emailColumn, nameColumn: headers.findIndex(h => normalize(h) === normalize(title + " Name")),
      titleColumn: headers.findIndex(h => normalize(h) === normalize(title + " Title")) }];
  });
}
export function mapHierarchy(
  rows: string[][],
  mapping: Record<string, number>,
  extraCc: HierarchyCcMapping[] = [],
): HierarchyRow[] {
  return rows
    .slice(1)
    .filter((row) => row.some((v) => v?.trim()))
    .map((row) => {
      const get = (k: string) => String(row[mapping[k]] || "").trim();
      const structure = normalize(get("Structure"));
      if (!["ACD", "CCD"].includes(structure))
        throw new Error(
          `Invalid structure for region ${get("Region")}: use ACD or CCD`,
        );
      if (!get("Region")) throw new Error("A region code is missing");
      return {
        structure: structure as "ACD" | "CCD",
        region: normalize(get("Region")),
        rseName: get("RSE Name"),
        rseEmail: get("RSE Email"),
        salutation: get("Salutation"),
        cc: deduplicateHierarchyContacts([
          ...["MDR", "MST", "OBR"].map(title => ({ title, name: get(title + " Name"), email: get(title + " Email") })),
          ...extraCc.map(cc => ({ title: String(row[cc.titleColumn] || cc.title).trim(),
            name: String(row[cc.nameColumn] || "").trim(), email: String(row[cc.emailColumn] || "").trim() })),
        ]),
        active: !["NO", "FALSE", "0", "INACTIVE"].includes(
          normalize(get("Active")),
        ),
      };
    });
}

function deduplicateHierarchyContacts(contacts: Contact[]) {
  const seen = new Set<string>();
  return contacts.filter(c => {
    const email = c.email.toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email); return true;
  });
}

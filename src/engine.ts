import type {
  BrandProfile,
  Dataset,
  DoctorRow,
  DoctorSelection,
  Hierarchy,
  HierarchyRow,
  Mail,
  NationalRxShare,
  RegionReport,
  Settings,
  Structure,
  TerritoryRxShare,
} from "./types";
import { emailTemplateFor, emailVariables, fillEmailText, templateError } from "./email-template";
export const normalize = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const emailValid = (s: string) =>
  /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/.test(s);
export function workspaceToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function eligibleDatasets(datasets: Dataset[], month: string, endMonth = month) {
  return datasets.filter(
    (d) => d.active && d.from.slice(0, 7) <= endMonth && d.to.slice(0, 7) >= month,
  );
}
export function overlaps(
  a: Pick<Dataset, "from" | "to">,
  b: Pick<Dataset, "from" | "to">,
) {
  return a.from <= b.to && b.from <= a.to;
}
export function dateInPeriod(date: string, month: string, period = "all", endMonth = month) {
  const day = Number(date.slice(8, 10));
  return date.slice(0, 7) >= month && date.slice(0, 7) <= endMonth && day >= 1 && day <= 31 &&
    (period === "all" || (period === "first" && day <= 10) ||
      (period === "second" && day >= 11 && day <= 20) ||
      (period === "third" && day >= 21));
}
export function nationalRxShare(
  datasets: Dataset[], month: string, profile: BrandProfile, period = "all",
  _expectedRegions: Pick<HierarchyRow, "structure" | "region" | "active">[] = [],
  endMonth = month,
): NationalRxShare {
  const sources = eligibleDatasets(datasets, month, endMonth).filter(d => !d.includedGenerics ||
    d.includedGenerics.some(g => [profile.generic, ...(profile.aliases || [])].map(normalize).includes(normalize(g))));
  const generics = new Set([profile.generic, ...(profile.aliases || [])].map(normalize));
  const forms = new Set(profile.forms.map(normalize));
  let total = 0, own = 0;
  for (const ds of sources) {
    for (const f of ds.facts) {
      if (!dateInPeriod(f.date, month, period, endMonth)) continue;
      if (!generics.has(normalize(f.generic)) || (forms.size && !forms.has(normalize(f.form)))) continue;
      total += f.count;
      if (normalize(f.brand) === normalize(profile.brand)) own += f.count;
    }
  }
  // Recipient hierarchy coverage controls regional sending, not source-wide Rx totals.
  // Overlapping active versions cannot establish a reliable national denominator.
  const overlap = sources.some((a, i) => sources.slice(i + 1).some(b =>
    coverage([a], month, endMonth).some(date => dateInPeriod(date, month, period, endMonth) && coverage([b], month, endMonth).includes(date))));
  const reason = overlap ? "Active source dates overlap. Select one version." :
    !total ? "No Rx records for this market and period." : undefined;
  return { total, own, share: reason ? null : own / total * 100, available: !reason, ...(reason ? { reason } : {}) };
}
export function belowNational(doctor: Pick<DoctorRow, "genericCount" | "ownCount">, national?: NationalRxShare) {
  return !!national?.available && national.total > 0 && doctor.genericCount > 0 &&
    doctor.ownCount * national.total < national.own * doctor.genericCount;
}
export function compareDoctors(a: DoctorRow, b: DoctorRow) {
  return a.mpe.localeCompare(b.mpe, undefined, { numeric: true }) ||
    b.genericCount - a.genericCount || a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
}
export function selectReportDoctors(report: RegionReport, selection: DoctorSelection = {}): RegionReport {
  if (selection.limit !== undefined && (!Number.isSafeInteger(selection.limit) || selection.limit < 1))
    throw new Error("Enter a positive whole number of doctors.");
  const specialty = normalize(selection.specialty);
  const doctors = report.doctors.filter(d => !specialty || normalize(d.specialty) === specialty).sort(compareDoctors);
  return { ...report, doctors: selection.limit === undefined ? doctors : doctors.slice(0, selection.limit) };
}
export function reportSpecialties(reports: RegionReport[]) {
  const values = new Map<string, string>();
  for (const report of reports) for (const doctor of report.doctors) {
    const key = normalize(doctor.specialty);
    if (key && !values.has(key)) values.set(key, doctor.specialty.trim());
  }
  return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
}
export function reports(
  datasets: Dataset[],
  month: string,
  profile: BrandProfile,
  structures: Structure[],
  period = "all",
  endMonth = month,
): RegionReport[] {
  const maps = new Map<
    string,
    {
      structure: Structure;
      region: string;
      brands: Record<string, number>;
      doctors: Map<string, DoctorRow>;
      ases: Map<string, TerritoryRxShare>;
      mpes: Map<string, TerritoryRxShare>;
    }
  >();
  const genericNames = [profile.generic, ...(profile.aliases || [])].map(
      normalize,
    ),
    forms = profile.forms.map(normalize);
  const national = nationalRxShare(datasets, month, profile, period, [], endMonth);
  for (const ds of eligibleDatasets(datasets, month, endMonth))
    for (const f of ds.facts) {
      if (
        !dateInPeriod(f.date, month, period, endMonth) ||
        !genericNames.includes(normalize(f.generic)) ||
        (forms.length && !forms.includes(normalize(f.form)))
      )
        continue;
      for (const structure of structures) {
        const region = structure === "ACD" ? f.acdRegion : f.ccdRegion,
          mpe = structure === "ACD" ? f.acdMpe : f.ccdMpe;
        if (!region) continue;
        const key = JSON.stringify([structure, region]);
        let r = maps.get(key);
        if (!r) {
          r = { structure, region, brands: {}, doctors: new Map(), ases: new Map(), mpes: new Map() };
          maps.set(key, r);
        }
        const b = normalize(f.brand) || "UNBRANDED";
        const ase = (structure === "ACD" ? f.acdAse : f.ccdAse) ?? ds.aseByMpe?.[structure]?.[JSON.stringify([region, mpe])];
        for (const [groups, code] of [[r.ases, ase], [r.mpes, mpe]] as const) {
          const groupCode = code || "Unassigned";
          const group = groups.get(groupCode) || { code: groupCode, genericCount: 0, ownCount: 0 };
          group.genericCount += f.count;
          if (b === normalize(profile.brand)) group.ownCount += f.count;
          groups.set(groupCode, group);
        }
        r.brands[b] = (r.brands[b] || 0) + f.count;
        const dk = JSON.stringify([mpe, f.doctorCode]);
        let d = r.doctors.get(dk);
        if (!d) {
          d = {
            mpe,
            code: f.doctorCode,
            name: f.doctorName,
            specialty: f.specialty,
            genericCount: 0,
            ownCount: 0,
            otherBrands: {},
          };
          r.doctors.set(dk, d);
        }
        d.genericCount += f.count;
        if (b === normalize(profile.brand)) d.ownCount += f.count;
        else d.otherBrands[b] = (d.otherBrands[b] || 0) + f.count;
      }
    }
  return [...maps.values()]
    .map((r) => {
      const total = Object.values(r.brands).reduce((a, b) => a + b, 0),
        own = r.brands[normalize(profile.brand)] || 0;
      const brands = [
        {
          brand: profile.brand,
          count: own,
          share: (own / total) * 100,
          own: true,
        },
        ...Object.entries(r.brands)
          .filter(([b]) => b !== normalize(profile.brand))
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 4)
          .map(([brand, count]) => ({
            brand,
            count,
            share: (count / total) * 100,
            own: false,
          })),
      ];
      const otherCount = total - brands.reduce((a, b) => a + b.count, 0);
      return {
        structure: r.structure,
        region: r.region,
        total,
        own,
        shares: brands,
        otherCount,
        otherShare: (otherCount / total) * 100,
        national,
        aseShares: [...r.ases.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
        mpeShares: [...r.mpes.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
        doctors: [...r.doctors.values()].sort(compareDoctors),
      };
    })
    .sort(
      (a, b) =>
        a.structure.localeCompare(b.structure) ||
        a.region.localeCompare(b.region, undefined, { numeric: true }),
    );
}
export function hierarchyFor(hierarchies: Hierarchy[], date: string) {
  return hierarchies
    .filter((h) => h.effectiveFrom <= date)
    .sort(
      (a, b) =>
        b.effectiveFrom.localeCompare(a.effectiveFrom) ||
        b.createdAt.localeCompare(a.createdAt),
    )[0];
}
export function recipientFor(
  hierarchy: Hierarchy | undefined,
  report: Pick<RegionReport, "structure" | "region">,
): { row?: HierarchyRow; error?: string } {
  const rows =
    hierarchy?.rows.filter(
      (r) =>
        r.active &&
        r.structure === report.structure &&
        normalize(r.region) === normalize(report.region),
    ) || [];
  if (!rows.length) return { error: "Missing active RSE in hierarchy" };
  if (rows.length > 1) return { error: "Duplicate active region in hierarchy" };
  const row = rows[0];
  if (!emailValid(row.rseEmail)) return { error: "Invalid RSE email" };
  if (!row.salutation.trim()) return { error: "Salutation is missing" };
  if (row.cc.some((c) => !emailValid(c.email)))
    return { error: "Invalid hierarchy CC email" };
  return { row };
}
export function regionalQueue(
  regionReports: RegionReport[],
  datasets: Dataset[],
  hierarchy: Hierarchy | undefined,
  structures: Structure[],
  brand: string,
  periodCovered: boolean,
  selectedDates?: string[],
  selectedMonths?: string[],
) {
  const known = new Map<string, { structure: Structure; region: string }>();
  const covered = new Set<string>();
  const scopeDates = new Set(selectedDates);
  const key = (s: Structure, r: string) => JSON.stringify([s, normalize(r)]);
  for (const d of datasets)
    for (const structure of structures)
      for (const region of d.regions?.[structure] || []) {
        const k = key(structure, region);
        known.set(k, { structure, region });
        if (
          !selectedDates ||
          !d.regionDates ||
          (d.regionDates[structure][region] || []).some((date) =>
            scopeDates.has(date),
          )
        )
          covered.add(k);
      }
  for (const r of regionReports) {
    const k = key(r.structure, r.region);
    known.set(k, r);
    covered.add(k);
  }
  for (const row of hierarchy?.rows || [])
    if (row.active && structures.includes(row.structure))
      known.set(key(row.structure, row.region), row);
  return [...known.values()]
    .map(({ structure, region }) => {
      const report = regionReports.find(
        (r) =>
          r.structure === structure &&
          normalize(r.region) === normalize(region),
      ) || {
        structure,
        region,
        total: 0,
        own: 0,
        doctors: [],
        shares: [{ brand, count: 0, share: 0, own: true }],
        otherCount: 0,
        otherShare: 0,
      };
      const recipient = recipientFor(hierarchy, report);
      return {
        report,
        row: recipient.row,
        error:
          recipient.error ||
          (selectedMonths && selectedMonths.length > 1 && selectedMonths.some(month => !datasets.some(d => {
            const dates = d.regionDates?.[structure]?.[region];
            if (dates) return dates.some(date => date.startsWith(month) && scopeDates.has(date));
            return (d.regions?.[structure]?.includes(region) || d.facts.some(f => (structure === "ACD" ? f.acdRegion : f.ccdRegion) === region)) &&
              coverage([d], month).some(date => scopeDates.has(date));
          })) ? "No regional source coverage for every selected month" : undefined) ||
          (!covered.has(key(structure, region)) || !periodCovered
            ? "No regional source coverage"
            : undefined),
      };
    })
    .sort(
      (a, b) =>
        a.report.structure.localeCompare(b.report.structure) ||
        a.report.region.localeCompare(b.report.region, undefined, {
          numeric: true,
        }),
    );
}
const mailFontFamily = "'Arial Narrow',Arial,sans-serif";
export function emailSignature(settings: Settings) {
  const e = escapeHtml;
  const title = settings.title.trim().replace(/(?:^|,\s*|\s+)SBM$/i, "");
  const email = emailValid(settings.email)
    ? `<a href="mailto:${e(settings.email)}" style="color:#0000ff;text-decoration:underline">${e(settings.email)}</a>`
    : e(settings.email);
  const contacts = [
    `Ph +880 2 8619151${settings.extension?.trim() ? " ext " + e(settings.extension.trim()) : ""}`,
    "Fax +880 2 8613888",
    settings.mobile?.trim() ? "Cell " + e(settings.mobile.trim()) : "",
    email,
    '<a href="https://www.beximcopharma.com" style="color:#404040;text-decoration:underline">www.beximcopharma.com</a>',
  ].filter(Boolean).join(" | ");
  return `<div data-email-signature="true" style="font-family:${mailFontFamily};font-size:14pt;line-height:1.3;color:#404040;text-align:left"><p style="margin:0 0 28px;color:#2e74b5;font-weight:bold">Thanks &amp; Regards,</p><p style="margin:0"><strong style="color:#2e74b5">${e(settings.name)}</strong> | ${title ? e(title) + ", " : ""}SBM | Beximco Pharmaceuticals PLC | 19 Dhanmondi R/A, Road #7, Dhaka 1205 | Bangladesh<br>${contacts}</p></div>`;
}
export function territoryShareHtml(label: "ASE" | "MPE", brand: string, groups: TerritoryRxShare[] | undefined, national?: NationalRxShare) {
  const e = escapeHtml;
  const cell = "font-family:'Arial Narrow',Arial,sans-serif;padding:6px 4px;border:1px solid #d7e3ee;text-align:center;vertical-align:middle;line-height:1.4;overflow-wrap:anywhere";
  const rows: string[] = [];
  for (let offset = 0; offset < (groups?.length || 0); offset += 8) {
    const values = groups!.slice(offset, offset + 8);
    const cells = values.map(g => {
      const color = national?.available && g.genericCount > 0 ? belowNational(g, national) ? "#b42335" : "#007568" : "#566b80";
      const share = g.genericCount ? (g.ownCount / g.genericCount * 100).toFixed(1) + "%" : "N/A";
      return `<td data-territory-code="${e(g.code)}" style="${cell};width:${84 / Math.min(8, groups!.length)}%"><b>${e(g.code)}</b><br>${g.genericCount}/${g.ownCount}<br><b style="color:${color}">${share}</b></td>`;
    }).join("");
    rows.push(`<tr><th class="rx-territory-label" style="${cell};width:16%;background:#12314b;color:white;font-size:11px;font-weight:normal">${label} CODE<br>Generic/Brand<br>Rx Share</th>${cells}</tr>`);
  }
  return `<div data-email-section="${label}Share" style="margin:14px 0"><p style="font-weight:bold;margin:0 0 8px">${label} wise ${e(brand)} Rx Share</p>${rows.length ? `<table class="rx-territory-table" role="presentation" aria-label="${label} wise Rx share" style="font-family:${mailFontFamily};border-collapse:collapse;table-layout:fixed;width:100%;font-size:12px">${rows.join("")}</table>` : '<p style="font-size:12px;color:#566b80;margin:0">No Rx records in this region.</p>'}${label === "ASE" && groups?.some(g => g.code === "Unassigned") ? '<p style="font-size:11px;color:#566b80;margin:5px 0 0">Unassigned = ASE code unavailable. Re-import the original MRW file to include missing ASE details.</p>' : ""}</div>`;
}
export function emailHtml(
  report: RegionReport,
  profile: BrandProfile,
  month: string,
  contact: HierarchyRow,
  settings: Settings,
  national: NationalRxShare | undefined = report.national,
) {
  const e = escapeHtml;
  const cell = "font-family:'Arial Narrow',Arial,sans-serif;padding:10px 8px;border-bottom:1px solid #d7e3ee;text-align:center;vertical-align:middle;overflow-wrap:anywhere";
  const head = (v: string, detail = false, width = 0) => `<th${detail ? ' class="rx-detail"' : ''} style="${cell};background:#12314b;color:#fff;font-size:12px;font-weight:bold${width ? ";width:" + width + "%" : ""}">${e(v)}</th>`;
  const colors = [
    ["#ddf7ef", "#007568"], ["#f1f6fd", "#224a8a"], ["#eee6fc", "#6339a7"],
    ["#fff2cd", "#885a00"], ["#dff6fc", "#006b83"],
  ];
  const leaders = [{ brand: profile.brand, count: report.own, share: report.total ? report.own / report.total * 100 : 0, own: true },
    ...report.shares.filter(b => !b.own).slice(0, 4)];
  const comparisonColor = national?.available && report.total > 0
    ? belowNational({ ownCount: report.own, genericCount: report.total }, national) ? "#b42335" : "#007568"
    : "#000000";
  const shares = Array.from({ length: 5 }, (_, i) => {
    const b = leaders[i];
    return `<td style="${cell};width:20%;background:${colors[i][0]};color:${colors[i][1]};border-bottom:0"><b>${e(b?.brand || "—")}</b><br><span${i === 0 ? ' data-regional-table-share="true"' : ""} style="font-size:18px;font-weight:bold;line-height:1.8${i === 0 ? ";color:" + comparisonColor : ""}">${b && report.total ? b.share.toFixed(1) + "%" : "—"}</span></td>`;
  }).join("");
  const rows = report.doctors.map(d => {
    const below = belowNational(d, national);
    const flagStyle = below ? ";color:#b42335;font-weight:bold" : "";
    const share = d.genericCount ? (d.ownCount / d.genericCount * 100).toFixed(1) + "%" : "N/A";
    const other = Object.entries(d.otherBrands).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([brand, count]) => `${e(brand)} (${count})`).join(", ") || "—";
    return `<tr${below ? ' data-below-national="true"' : ''} style="background:#fff"><td class="rx-detail" style="${cell}">${e(d.mpe)}</td><td title="${e(d.name)}" style="${cell}${flagStyle}">${e(d.code)}</td><td style="${cell}${flagStyle}">${e(d.name || "—")}</td><td class="rx-detail" style="${cell}">${e(d.specialty)}</td><td style="${cell}">${d.genericCount}</td><td style="${cell}">${d.ownCount}</td><td style="${cell}${flagStyle}">${below ? "↓ " : ""}${share}</td><td class="rx-detail" style="${cell}">${other}</td></tr>`;
  }).join("") || `<tr><td colspan="8" style="${cell};padding:20px">${report.total ? "No doctors match the selected report options." : "No Rx records for this market in the selected period."}</td></tr>`;
  const benchmark = national?.available && national.share !== null ? national.share.toFixed(1) + "%" : "N/A";
  const regionalShare = report.total ? (report.own / report.total * 100).toFixed(1) + "%" : "N/A";
  const template = emailTemplateFor(settings);
  const error = templateError(template);
  if (error) throw new Error(error);
  const variables = emailVariables(report, profile, month, contact);
  const paragraph = (text: string) => text.trim() ? `<p style="margin:0 0 14px;line-height:1.6;color:#000000">${e(fillEmailText(text, variables)).replace(/\r?\n/g, "<br>")}</p>` : "";
  const sections: Record<string, string> = {
    RegionalShare: `<div data-email-section="RegionalShare"><p style="font-weight:bold;margin:0 0 12px;color:#000000">Regional Rx share</p><p data-national-comparison="true" style="margin:0 0 14px;line-height:1.6;color:#000000">The National Rx share of <b>${e(profile.brand)}</b> is <b>${benchmark}</b> whereas yours is <b data-regional-share="true" style="color:${comparisonColor}">${regionalShare}</b>.</p><table role="presentation" style="font-family:${mailFontFamily};border-collapse:collapse;width:100%;table-layout:fixed"><tr>${shares}</tr></table><p style="font-size:11px;color:#566b80;margin:8px 0 18px">Share of all ${e(profile.generic)} Rx · Total ${report.total}</p></div>`,
    ASEShare: territoryShareHtml("ASE", profile.brand, report.aseShares, national),
    MPEShare: territoryShareHtml("MPE", profile.brand, report.mpeShares, national),
    Prescribers: `<div data-email-section="Prescribers"><p style="font-weight:bold;margin:0 0 12px">Prescriber list</p><table aria-label="Prescriber list" style="font-family:${mailFontFamily};border-collapse:collapse;table-layout:fixed;width:100%;font-size:12px"><thead><tr>${["MPE", "Doctor code", "Doctor name", "Specialty", "Generic Rx", profile.brand + " Rx", profile.brand + " share", "Other Brand"].map((h, i) => head(h, [0, 3, 7].includes(i), [6, 10, 20, 10, 8, 8, 10, 28][i])).join("")}</tr></thead><tbody>${rows}</tbody></table>${national?.available ? `<p style="font-size:11px;color:#b42335;margin:10px 0 20px">↓ Red = below national ${e(profile.brand)} share (${benchmark}).</p>` : '<p style="font-size:11px;color:#566b80;margin:10px 0 20px">National benchmark unavailable.</p>'}</div>`,
  };
  const body = template.body.split(/(\{(?:RegionalShare|ASEShare|MPEShare|Prescribers)\})/g)
    .map(part => /^\{(?:RegionalShare|ASEShare|MPEShare|Prescribers)\}$/.test(part) ? sections[part.slice(1, -1)] : paragraph(part)).join("");
  const salutation = /Bhai$/i.test(contact.salutation.trim()) ? contact.salutation.trim() : contact.salutation.trim() + " Bhai";
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body,body *{font-family:${mailFontFamily}}body.rx-compact .rx-detail{display:none}body.rx-compact .rx-share-value{font-size:14px}@media(max-width:600px){.rx-territory-table tr{display:block}.rx-territory-table td,.rx-territory-table th{display:inline-block;box-sizing:border-box;width:33.333%!important}}</style></head><body style="margin:0;padding:24px 16px;font:14px ${mailFontFamily};color:#000000;background:#fff"><div style="max-width:1100px;margin:auto"><p style="margin:0 0 14px;color:#000000">Dear ${e(salutation)},</p><div data-email-opening="true">${paragraph(template.opening)}</div>${body}<div style="margin-top:24px">${emailSignature(settings)}</div></div></body></html>`;

}
export function makeMail(
  report: RegionReport,
  profile: BrandProfile,
  month: string,
  hierarchy: Hierarchy | undefined,
  settings: Settings,
  national: NationalRxShare | undefined = report.national,
): Mail {
  if (!settings.name.trim() || !emailValid(settings.email))
    throw new Error(
      "Complete your name and sender email in Settings before generating emails.",
    );
  const { row, error } = recipientFor(hierarchy, report);
  if (error || !row)
    throw new Error(`${report.structure} ${report.region}: ${error}`);
  if (settings.personalCc.some((c) => !emailValid(c.email)))
    throw new Error("Fix your personal CC addresses in Settings");
  const seen = new Set([row.rseEmail.toLowerCase()]);
  const cc = [...settings.personalCc, ...row.cc].filter((c) => {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const template = emailTemplateFor(settings);
  const wordingError = templateError(template);
  if (wordingError) throw new Error(wordingError);
  const subject = fillEmailText(template.subject, emailVariables(report, profile, month, row)).trim();
  if (/[\r\n]/.test(subject)) throw new Error("Keep the email subject on one line.");
  return {
    id: crypto.randomUUID(),
    region: report.region,
    structure: report.structure,
    to: { name: row.rseName, email: row.rseEmail },
    cc,
    subject,
    html: emailHtml(report, profile, month, row, settings, national),
    ...(national ? { national: { ...national } } : {}),
    doctorCount: report.doctors.length,
    rxCount: report.total,
    status: "Prepared",
  };
}
export function coverage(datasets: Dataset[], month: string, endMonth = month) {
  const days = new Set<string>();
  for (const ds of eligibleDatasets(datasets, month, endMonth)) {
    if (ds.dates) {
      for (const date of ds.dates) if (date.slice(0, 7) >= month && date.slice(0, 7) <= endMonth) days.add(date);
      continue;
    }
    let date = new Date(ds.from + "T00:00:00Z");
    const end = new Date(ds.to + "T00:00:00Z");
    for (; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const s = date.toISOString().slice(0, 10);
      if (s.slice(0, 7) >= month && s.slice(0, 7) <= endMonth) days.add(s);
    }
  }
  return [...days].sort();
}

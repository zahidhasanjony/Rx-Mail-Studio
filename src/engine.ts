import type {
  BrandProfile,
  Dataset,
  DoctorRow,
  Hierarchy,
  HierarchyRow,
  Mail,
  NationalRxShare,
  RegionReport,
  Settings,
  Structure,
} from "./types";
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
export function eligibleDatasets(datasets: Dataset[], month: string) {
  return datasets.filter(
    (d) => d.active && d.from.slice(0, 7) <= month && d.to.slice(0, 7) >= month,
  );
}
export function overlaps(
  a: Pick<Dataset, "from" | "to">,
  b: Pick<Dataset, "from" | "to">,
) {
  return a.from <= b.to && b.from <= a.to;
}
export function dateInPeriod(date: string, month: string, period = "all") {
  const day = Number(date.slice(8, 10));
  return date.startsWith(month) && day >= 1 && day <= 31 &&
    (period === "all" || (period === "first" && day <= 10) ||
      (period === "second" && day >= 11 && day <= 20) ||
      (period === "third" && day >= 21));
}
export function nationalRxShare(
  datasets: Dataset[], month: string, profile: BrandProfile, period = "all",
  expectedRegions: Pick<HierarchyRow, "structure" | "region" | "active">[] = [],
): NationalRxShare {
  const sources = eligibleDatasets(datasets, month).filter(d => !d.includedGenerics ||
    d.includedGenerics.some(g => [profile.generic, ...(profile.aliases || [])].map(normalize).includes(normalize(g))));
  const generics = new Set([profile.generic, ...(profile.aliases || [])].map(normalize));
  const forms = new Set(profile.forms.map(normalize));
  let total = 0, own = 0;
  const covered = new Set<string>();
  const routeKey = (s: Structure, r: string) => JSON.stringify([s, normalize(r)]);
  for (const ds of sources) {
    for (const s of ["ACD", "CCD"] as Structure[]) {
      for (const region of ds.regions?.[s] || []) {
        const dates = ds.regionDates?.[s]?.[region] || ds.dates;
        if (dates ? dates.some(date => dateInPeriod(date, month, period)) :
          coverage([ds], month).some(date => dateInPeriod(date, month, period))) covered.add(routeKey(s, region));
      }
    }
    for (const f of ds.facts) {
      if (!dateInPeriod(f.date, month, period)) continue;
      if (f.acdRegion) covered.add(routeKey("ACD", f.acdRegion));
      if (f.ccdRegion) covered.add(routeKey("CCD", f.ccdRegion));
      if (!generics.has(normalize(f.generic)) || (forms.size && !forms.has(normalize(f.form)))) continue;
      total += f.count;
      if (normalize(f.brand) === normalize(profile.brand)) own += f.count;
    }
  }
  const missing = expectedRegions.filter(r => r.active && !covered.has(routeKey(r.structure, r.region)));
  // Overlapping active versions cannot establish a reliable national denominator.
  const overlap = sources.some((a, i) => sources.slice(i + 1).some(b =>
    coverage([a], month).some(date => dateInPeriod(date, month, period) && coverage([b], month).includes(date))));
  const reason = overlap ? "Active source dates overlap. Select one version." :
    missing.length ? `${missing.length} regional routes have no source coverage.` :
      !total ? "No Rx records for this market and period." : undefined;
  return { total, own, share: reason ? null : own / total * 100, available: !reason, ...(reason ? { reason } : {}) };
}
export function belowNational(doctor: Pick<DoctorRow, "genericCount" | "ownCount">, national?: NationalRxShare) {
  return !!national?.available && national.total > 0 && doctor.genericCount > 0 &&
    doctor.ownCount * national.total < national.own * doctor.genericCount;
}
export function reports(
  datasets: Dataset[],
  month: string,
  profile: BrandProfile,
  structures: Structure[],
  period = "all",
): RegionReport[] {
  const maps = new Map<
    string,
    {
      structure: Structure;
      region: string;
      brands: Record<string, number>;
      doctors: Map<string, DoctorRow>;
    }
  >();
  const genericNames = [profile.generic, ...(profile.aliases || [])].map(
      normalize,
    ),
    forms = profile.forms.map(normalize);
  const national = nationalRxShare(datasets, month, profile, period);
  for (const ds of eligibleDatasets(datasets, month))
    for (const f of ds.facts) {
      const day = Number(f.date.slice(8, 10));
      if (
        !f.date.startsWith(month) ||
        (period === "first" && day > 10) ||
        (period === "second" && (day < 11 || day > 20)) ||
        (period === "third" && day < 21) ||
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
          r = { structure, region, brands: {}, doctors: new Map() };
          maps.set(key, r);
        }
        const b = normalize(f.brand) || "UNBRANDED";
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
        doctors: [...r.doctors.values()].sort(
          (a, b) =>
            a.mpe.localeCompare(b.mpe, undefined, { numeric: true }) ||
            b.genericCount - a.genericCount ||
            a.name.localeCompare(b.name) ||
            a.code.localeCompare(b.code),
        ),
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
  return `<div data-email-signature="true" style="font-family:Calibri,Arial,sans-serif;font-size:14pt;line-height:1.3;color:#404040;text-align:left"><p style="margin:0 0 28px;color:#2e74b5;font-weight:bold">Thanks &amp; Regards,</p><p style="margin:0"><strong style="color:#2e74b5">${e(settings.name)}</strong> | ${title ? e(title) + ", " : ""}SBM | Beximco Pharmaceuticals PLC | 19 Dhanmondi R/A, Road #7, Dhaka 1205 | Bangladesh<br>${contacts}</p></div>`;
}
export function emailHtml(
  report: RegionReport,
  profile: BrandProfile,
  _month: string,
  contact: HierarchyRow,
  settings: Settings,
  national: NationalRxShare | undefined = report.national,
) {
  const e = escapeHtml;
  const cell = "padding:10px 8px;border-bottom:1px solid #d7e3ee;text-align:center;vertical-align:middle;overflow-wrap:anywhere";
  const head = (v: string, detail = false) => `<th${detail ? ' class="rx-detail"' : ''} style="${cell};background:#12314b;color:#fff;font-size:12px;font-weight:bold">${e(v)}</th>`;
  const colors = [
    ["#ddf7ef", "#007568"], ["#f1f6fd", "#224a8a"], ["#eee6fc", "#6339a7"],
    ["#fff2cd", "#885a00"], ["#dff6fc", "#006b83"],
  ];
  const leaders = [{ brand: profile.brand, count: report.own, share: report.total ? report.own / report.total * 100 : 0, own: true },
    ...report.shares.filter(b => !b.own).slice(0, 4)];
  const shares = Array.from({ length: 5 }, (_, i) => {
    const b = leaders[i];
    return `<td style="${cell};width:20%;background:${colors[i][0]};color:${colors[i][1]};border-bottom:0"><b>${e(b?.brand || "—")}</b><br><span style="font-size:18px;font-weight:bold;line-height:1.8">${b && report.total ? b.share.toFixed(1) + "%" : "—"}</span></td>`;
  }).join("");
  const rows = report.doctors.map(d => {
    const below = belowNational(d, national);
    const flagStyle = below ? ";color:#b42335;font-weight:bold" : "";
    const share = d.genericCount ? (d.ownCount / d.genericCount * 100).toFixed(1) + "%" : "N/A";
    const other = Object.entries(d.otherBrands).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([brand, count]) => `${e(brand)} (${count})`).join(", ") || "—";
    return `<tr${below ? ' data-below-national="true"' : ''} style="background:${below ? "#fff1f2" : "#fff"}"><td class="rx-detail" style="${cell}">${e(d.mpe)}</td><td title="${e(d.name)}" style="${cell}${flagStyle}">${e(d.code)}</td><td class="rx-detail" style="${cell}">${e(d.specialty)}</td><td style="${cell}">${d.genericCount}</td><td style="${cell}">${d.ownCount}</td><td style="${cell}${flagStyle}">${below ? "↓ " : ""}${share}</td><td class="rx-detail" style="${cell}">${other}</td></tr>`;
  }).join("") || `<tr><td colspan="7" style="${cell};padding:20px">No Rx records for this market in the selected period.</td></tr>`;
  const benchmark = national?.available && national.share !== null ? national.share.toFixed(1) + "%" : "N/A";
  const regionalShare = report.total ? (report.own / report.total * 100).toFixed(1) + "%" : "N/A";
  const comparisonColor = national?.available && report.total > 0
    ? belowNational({ ownCount: report.own, genericCount: report.total }, national) ? "#b42335" : "#007568"
    : "#566b80";
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body.rx-compact .rx-detail{display:none}body.rx-compact .rx-share-value{font-size:14px}</style></head><body style="margin:0;padding:24px 16px;font:14px Arial,sans-serif;color:#16324f;background:#fff"><div style="max-width:1100px;margin:auto"><p style="margin:0 0 20px">Dear ${e(contact.salutation)},</p><p style="margin:0 0 8px;font-size:18px;font-weight:bold;color:#007568">${e(profile.generic)} · ${e(profile.brand)}</p><p style="font-weight:bold;margin:0 0 12px">Regional Rx share</p><p data-national-comparison="true" style="margin:0 0 14px;line-height:1.6">The National Rx share of <b>${e(profile.brand)}</b> (Beximco’s Brand) is <b>${benchmark}</b> whereas yours is <b data-regional-share="true" style="color:${comparisonColor}">${regionalShare}</b>.</p><table role="presentation" style="border-collapse:collapse;width:100%;table-layout:fixed"><tr>${shares}</tr></table><p style="font-size:11px;color:#566b80;margin:8px 0 18px">Share of all ${e(profile.generic)} Rx · Total ${report.total}</p><p style="font-weight:bold;margin:0 0 12px">Prescriber list</p><table aria-label="Prescriber list" style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${["MPE", "Doctor code", "Specialty", "Generic Rx", profile.brand + " Rx", profile.brand + " share", "Other Brand"].map((h, i) => head(h, [0, 2, 6].includes(i))).join("")}</tr></thead><tbody>${rows}</tbody></table>${national?.available ? `<p style="font-size:11px;color:#b42335;margin:10px 0 20px">↓ Red = below national ${e(profile.brand)} share (${benchmark}).</p>` : '<p style="font-size:11px;color:#566b80;margin:10px 0 20px">National benchmark unavailable.</p>'}<div style="margin-top:24px">${emailSignature(settings)}</div></div></body></html>`;
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
  const cc = [...row.cc, ...settings.personalCc].filter((c) => {
    const key = c.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    id: crypto.randomUUID(),
    region: report.region,
    structure: report.structure,
    to: { name: row.rseName, email: row.rseEmail },
    cc,
    subject: `${profile.generic} Prescriber List · ${report.structure} ${report.region} Region · ${month}`,
    html: emailHtml(report, profile, month, row, settings, national),
    ...(national ? { national: { ...national } } : {}),
    doctorCount: report.doctors.length,
    rxCount: report.total,
    status: "Prepared",
  };
}
export function coverage(datasets: Dataset[], month: string) {
  const days = new Set<string>();
  for (const ds of eligibleDatasets(datasets, month)) {
    if (ds.dates) {
      for (const date of ds.dates) if (date.startsWith(month)) days.add(date);
      continue;
    }
    let date = new Date(ds.from + "T00:00:00Z");
    const end = new Date(ds.to + "T00:00:00Z");
    for (; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const s = date.toISOString().slice(0, 10);
      if (s.startsWith(month)) days.add(s);
    }
  }
  return [...days].sort();
}

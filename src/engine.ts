import type {
  BrandProfile,
  Dataset,
  DoctorRow,
  Hierarchy,
  HierarchyRow,
  Mail,
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
export function emailHtml(
  report: RegionReport,
  profile: BrandProfile,
  month: string,
  contact: HierarchyRow,
  settings: Settings,
) {
  const e = escapeHtml;
  const cell =
    "padding:9px;border:1px solid #d7dee5;text-align:left;vertical-align:top";
  const head = (v: string) =>
    `<th style="${cell};background:#edf3f1;color:#174d43">${e(v)}</th>`;
  const shareRows = report.shares.length
    ? report.shares
    : [{ brand: profile.brand, count: 0, share: 0, own: true }];
  const shares = shareRows
    .map(
      (b) =>
        `<td style="${cell};${b.own ? "background:#e7f5eb;" : ""}"><b>${e(b.brand)}</b><br>${report.total ? b.share.toFixed(1) + "%" : "No Rx recorded"}<br><span style="color:#65716d">${b.count} Rx</span></td>`,
    )
    .join("");
  return `<html><body style="font:14px Arial,sans-serif;color:#202d36"><p>Dear ${e(contact.salutation)},</p><p>${e(settings.intro)}</p><p><b>${e(profile.generic)} (Generic) · ${e(profile.brand)} (Beximco's Brand)</b><br>${e(report.structure)} / ${e(report.region)} · ${e(month)} · ${e(profile.forms.join(", ") || "All dosage forms")}</p><h3 style="color:#174d43">Regional Rx share</h3><table style="border-collapse:collapse;width:100%"><tr>${shares}${report.otherCount ? `<td style="${cell}"><b>Other brands</b><br>${report.otherShare.toFixed(1)}%<br>${report.otherCount} Rx</td>` : ""}</tr></table><p style="color:#65716d;font-size:12px">Share of all ${e(profile.generic)} recorded product occurrences in the selected market. Total: ${report.total} Rx.</p><h3 style="color:#174d43">Prescriber list</h3><table style="border-collapse:collapse;width:100%"><thead><tr>${["MPE", "Doctor / Institute", "Specialty", profile.generic, profile.brand, "Other brands"].map(head).join("")}</tr></thead><tbody>${
    report.doctors
      .map(
        (d) =>
          `<tr><td style="${cell}">${e(d.mpe)}</td><td style="${cell}"><b>${e(d.name)}</b><br><span style="font-size:11px;color:#65716d">${e(d.code)}</span></td><td style="${cell}">${e(d.specialty)}</td><td style="${cell}">${d.genericCount}</td><td style="${cell}">${d.ownCount}</td><td style="${cell}">${
            Object.entries(d.otherBrands)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([b, n]) => `${e(b)} (${n})`)
              .join(", ") || "—"
          }</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" style="padding:14px;border:1px solid #d7dee5">No Rx records for this market in the selected period.</td></tr>'
  }</tbody></table><p>${e(settings.closing)}<br><b>${e(settings.name)}</b><br>${e(settings.title)}<br>${e(settings.company)}<br>${e(settings.address)}<br>${e(settings.email)}</p></body></html>`;
}
export function makeMail(
  report: RegionReport,
  profile: BrandProfile,
  month: string,
  hierarchy: Hierarchy | undefined,
  settings: Settings,
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
    html: emailHtml(report, profile, month, row, settings),
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

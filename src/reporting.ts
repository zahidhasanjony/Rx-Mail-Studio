export function reportingMonths(from: string, to = from): string[] {
  if (![from, to].every(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) || to < from) return [];
  const months: string[] = [];
  let year = Number(from.slice(0, 4)), month = Number(from.slice(5));
  while (`${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}` <= to) {
    months.push(`${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    if (++month === 13) { month = 1; year++; }
  }
  return months;
}
export function reportingPeriod(from: string, to = from, cycle = "all") {
  if (!reportingMonths(from, to).length) return "Invalid month range";
  const label = (m: string) => `${new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`))}'${m.slice(2, 4)}`;
  const flash = ({ first: "1st Flash", second: "2nd Flash", third: "3rd Flash" } as Record<string, string>)[cycle];
  return `${label(from)}${to === from ? "" : `–${label(to)}`}${flash ? ` ${flash}` : ""}`;
}

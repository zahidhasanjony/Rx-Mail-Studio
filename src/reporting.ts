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
export function reportingPeriod(from: string, to = from, cycle = "all", availableDates: readonly string[] = []) {
  if (!reportingMonths(from, to).length) return "Invalid month range";
  const label = (m: string) => `${new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`))}'${m.slice(2, 4)}`;
  let flash = ({ first: "1st Flash", second: "2nd Flash", third: "3rd Flash" } as Record<string, string>)[cycle];
  if (cycle === "all") {
    // Infer cumulative Flashes only from the last selected month's coverage.
    // Earlier full months, inactive sources and doctor filters must not decide it.
    const days = new Set(availableDates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 7) === to)
      .map(date => Number(date.slice(8))).filter(day => day >= 1 && day <= 31));
    const lastDay = Math.max(0, ...days);
    if ((lastDay === 10 || lastDay === 20) && days.size === lastDay)
      flash = lastDay === 10 ? "1st Flash" : "2nd Flash";
  }
  return `${label(from)}${to === from ? "" : `–${label(to)}`}${flash ? ` ${flash}` : ""}`;
}

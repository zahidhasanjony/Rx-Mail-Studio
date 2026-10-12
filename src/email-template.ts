import { defaultEmailTemplate } from "./types";
import type { BrandProfile, EmailTemplate, HierarchyRow, RegionReport, Settings } from "./types";

export const sectionTokens = ["RegionalShare", "ASEShare", "MPEShare", "Prescribers"] as const;
const textTokens = ["Generic", "Brand", "Region", "Structure", "Period", "RSE"];
export function emailTemplateFor(settings: Settings): EmailTemplate {
  return { ...defaultEmailTemplate, ...settings.emailTemplate };
}
export function templateError(template: EmailTemplate) {
  if (!template.subject.trim()) return "Enter an email subject.";
  if (/[\r\n]/.test(template.subject)) return "Keep the subject on one line.";
  for (const [part, value] of Object.entries(template)) {
    for (const match of value.matchAll(/\{([A-Za-z]+)\}/g)) {
      if (!textTokens.includes(match[1]) && !(part === "body" && sectionTokens.some(t => t === match[1])))
        return `Unknown field {${match[1]}}. Use the fields listed below.`;
    }
  }
  for (const section of sectionTokens) {
    if (template.body.split(`{${section}}`).length !== 2)
      return `Keep {${section}} exactly once in the email body.`;
  }
}
export function emailVariables(report: RegionReport, profile: BrandProfile, period: string, contact: HierarchyRow) {
  return { Generic: profile.generic, Brand: profile.brand, Region: report.region,
    Structure: report.structure, Period: period, RSE: contact.salutation.replace(/\s*Bhai$/i, "") };
}
export function fillEmailText(text: string, variables: ReturnType<typeof emailVariables>) {
  return text.replace(/\{(Generic|Brand|Region|Structure|Period|RSE)\}/g, (_, key: keyof typeof variables) => variables[key]);
}

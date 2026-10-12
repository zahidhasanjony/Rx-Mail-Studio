export type Structure = "ACD" | "CCD";
export interface RxFact {
  date: string;
  generic: string;
  brand: string;
  company: string;
  form: string;
  doctorCode: string;
  doctorName: string;
  specialty: string;
  acdRegion: string;
  acdMpe: string;
  acdAse?: string;
  ccdRegion: string;
  ccdMpe: string;
  ccdAse?: string;
  count: number;
  sourceRow: number;
  sourceRows?: number[];
  sheet: string;
}
export interface Dataset {
  id: string;
  name: string;
  hash: string;
  sourceHash?: string;
  includedGenerics?: string[];
  importedAt: string;
  active: boolean;
  rows: number;
  invalidRows: number;
  from: string;
  to: string;
  sheets: string[];
  facts: RxFact[];
  catalog: BrandProfile[];
  regions?: Record<Structure, string[]>;
  regionDates?: Record<Structure, Record<string, string[]>>;
  dates?: string[];
  aseByMpe?: Record<Structure, Record<string, string>>;
}
export interface BrandProfile {
  company?: string;
  id: string;
  generic: string;
  brand: string;
  forms: string[];
  favorite?: boolean;
  aliases?: string[];
}
export interface Contact {
  title?: string;
  name: string;
  email: string;
}
export interface HierarchyRow {
  structure: Structure;
  region: string;
  rseName: string;
  rseEmail: string;
  salutation: string;
  cc: Contact[];
  active: boolean;
}
export interface Hierarchy {
  id: string;
  name: string;
  effectiveFrom: string;
  rows: HierarchyRow[];
  createdAt: string;
}
export interface Settings {
  name: string;
  title: string;
  company: string;
  email: string;
  address: string;
  extension?: string;
  mobile?: string;
  personalCc: Contact[];
  intro: string;
  closing: string;
  emailTemplate?: EmailTemplate;
}
export interface EmailTemplate {
  subject: string;
  opening: string;
  body: string;
}
export const defaultEmailTemplate: EmailTemplate = {
  subject: "{Generic} ({Brand}) Prescriber List of {Region} Region for {Period}",
  opening: "Please find below the prescription share and prescribers list of {Generic} and {Brand} Rx scenario in {Region} Region for {Period}.",
  body: "{RegionalShare}\n{ASEShare}\n{MPEShare}\n{Prescribers}",
};
export interface TerritoryRxShare {
  code: string;
  genericCount: number;
  ownCount: number;
}
export interface DoctorRow {
  mpe: string;
  code: string;
  name: string;
  specialty: string;
  genericCount: number;
  ownCount: number;
  otherBrands: Record<string, number>;
}
export interface DoctorSelection {
  specialty?: string;
  limit?: number;
}
export interface NationalRxShare {
  total: number;
  own: number;
  share: number | null;
  available: boolean;
  reason?: string;
}
export interface RegionReport {
  structure: Structure;
  region: string;
  total: number;
  own: number;
  doctors: DoctorRow[];
  shares: { brand: string; count: number; share: number; own: boolean }[];
  otherCount: number;
  otherShare: number;
  national?: NationalRxShare;
  aseShares?: TerritoryRxShare[];
  mpeShares?: TerritoryRxShare[];
}
export interface Mail {
  id: string;
  region: string;
  structure: Structure;
  to: Contact;
  cc: Contact[];
  subject: string;
  html: string;
  doctorCount: number;
  rxCount: number;
  status: "Prepared" | "Opened" | "Failed";
  error?: string;
  national?: NationalRxShare;
}
export interface Batch {
  id: string;
  createdAt: string;
  month: string;
  endMonth?: string;
  period?: string;
  brand: string;
  generic: string;
  sourceIds: string[];
  hierarchyId: string;
  settings: Settings;
  profile: BrandProfile;
  mails: Mail[];
  national?: NationalRxShare;
  doctorSelection?: DoctorSelection;
}
export interface Workspace {
  persistedProfileIds?: string[];
  sharedEmailTemplate?: EmailTemplate;
  datasets: Dataset[];
  hierarchies: Hierarchy[];
  profiles: BrandProfile[];
  batches: Batch[];
  settings: Settings;
}
export const defaultSettings: Settings = {
  name: "",
  title: "",
  company: "",
  email: "",
  address: "",
  extension: "",
  mobile: "",
  personalCc: [],
  intro: "",
  closing: "Regards,",
};
export const starterProfiles: BrandProfile[] = [
  {
    id: "tofen",
    generic: "Ketotifen",
    brand: "TOFEN",
    forms: ["SYP", "TAB"],
    favorite: true,
  },
  {
    id: "axodin",
    generic: "Fexofenadine Hydrochloride",
    brand: "AXODIN",
    forms: ["TAB", "SUS"],
  },
  { id: "monocast", generic: "Montelukast", brand: "MONOCAST", forms: ["TAB"] },
  {
    id: "billi",
    generic: "Bilastine",
    brand: "BILLI",
    forms: ["TAB", "ORAL SOL"],
  },
  { id: "bexidal", generic: "Mebhydrolin", brand: "BEXIDAL", forms: ["TAB"] },
  {
    id: "duvent",
    generic: "Rupatadine",
    brand: "DUVENT",
    forms: ["TAB", "SYP"],
  },
  {
    id: "nasal",
    generic: "Sodium Chloride",
    brand: "NASAL",
    forms: ["NASAL SPRAY"],
  },
  {
    id: "atrizin",
    generic: "Cetirizine Dihydrochloride",
    brand: "ATRIZIN",
    forms: ["TAB", "SYP", "DROP"],
  },
];
export const emptyWorkspace = (): Workspace => ({
  datasets: [],
  hierarchies: [],
  profiles: starterProfiles.map((p) => ({ ...p })),
  batches: [],
  settings: structuredClone(defaultSettings),
});
export function settingsForNewUser(email: string): Settings {
  return {
    ...structuredClone(defaultSettings),
    name: "",
    title: "",
    email: email.endsWith("@users.rxmail.invalid") ? "" : email,
    personalCc: [],
  };
}

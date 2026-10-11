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
  ccdRegion: string;
  ccdMpe: string;
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
}
export interface BrandProfile {
  id: string;
  generic: string;
  brand: string;
  forms: string[];
  favorite?: boolean;
  aliases?: string[];
}
export interface Contact {
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
  personalCc: Contact[];
  intro: string;
  closing: string;
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
export interface RegionReport {
  structure: Structure;
  region: string;
  total: number;
  own: number;
  doctors: DoctorRow[];
  shares: { brand: string; count: number; share: number; own: boolean }[];
  otherCount: number;
  otherShare: number;
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
}
export interface Batch {
  id: string;
  createdAt: string;
  month: string;
  period?: string;
  brand: string;
  generic: string;
  sourceIds: string[];
  hierarchyId: string;
  settings: Settings;
  profile: BrandProfile;
  mails: Mail[];
}
export interface Workspace {
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
  personalCc: [],
  intro:
    "Please find the regional Rx share scenario and prescriber list below for your review and follow-up.",
  closing: "Best regards,",
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
    email,
    personalCc: [],
  };
}

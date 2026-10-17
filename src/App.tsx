import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Mail,
  LayoutDashboard,
  UploadCloud,
  Network,
  FlaskConical,
  History,
  Settings as SettingsIcon,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  Plus,
  Check,
  CheckCircle2,
  AlertCircle,
  Search,
  Download,
  Eye,
  X,
  MoreHorizontal,
  Menu,
  ShieldCheck,
  Cloud,
  Monitor,
  LoaderCircle,
  CalendarDays,
  Users,
  FileSpreadsheet,
  Trash2,
  Star,
  LogOut,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import type {
  Workspace,
  BrandProfile,
  HierarchyRow,
  Hierarchy,
  Settings,
  RegionReport,
  Batch,
  Structure,
  Dataset,
  Contact,
  Mail as RegionalMail,
} from "./types";
import { emptyWorkspace, starterProfiles } from "./types";
import { clearStagedImport } from "./import-staging";
import {
  workspaceToday,
  coverage,
  eligibleDatasets,
  reports,
  hierarchyFor,
  recipientFor,
  regionalQueue,
  makeMail,
  overlaps,
  emailValid,
  normalize,
  nationalRxShare,
  belowNational,
  emailSignature,
  reportSpecialties,
  selectReportDoctors,
} from "./engine";
import {
  cloudConfigured,
  supabase,
  localLoad,
  localSave,
  cloudLoad,
  cloudHydrate,
  cloudSave,
  cloudUpdateCatalogue,
  cloudPublishEmailTemplate,
  cloudDeleteSource,
  cloudExportHierarchy,
  cloudDeleteBrandPair,
} from "./storage";
import type { Mode } from "./storage";
import { usernameSignIn, currentAccount, AccountServiceError } from "./auth";
import type { UserAccount } from "./auth";
import UsersPage from "./UsersPage";
import AndroidMailQueue from "./AndroidMailQueue";
import RegionReview from "./RegionReview";
import EmailTemplateEditor from "./EmailTemplateEditor";
import { emailTemplateFor, templateError } from "./email-template";
import { download, outlookPackage, mailEml, emlFilename, emlPackage, emlPackageFilename, hierarchyCsv } from "./export";
import { loadOutlookExcel, outlookExcelFilename, OUTLOOK_EXCEL_TYPE } from "./outlook-excel";
import { hierarchyColumns, mapHierarchy, extraHierarchyCcMappings } from "./excel";
import type { Sheet, HierarchyCcMapping } from "./excel";
import { parseCsv } from "./csv";
import { appendBrandPairs, reconcileBrandPairs, sourceBrandPairs, brandPairKey, searchBrandPairs } from "./catalogue";
import { datasetGenericNames, reportGenericNames, targetGenericNames, marketLabel, missingMarketCoverage } from "./markets";
import { reportingMonths, reportingPeriod } from "./reporting";
import { demoWorkspace } from "./demo";
import {
  bridgePackage,
  checkBridge,
  openViaBridge,
  applyResults,
} from "./bridge";

type Page =
  "generate" | "sources" | "hierarchy" | "brands" | "history" | "settings" | "users";
const nav = [
  { id: "generate", label: "Generate emails", icon: LayoutDashboard },
  { id: "sources", label: "Source files", icon: UploadCloud },
  { id: "hierarchy", label: "Region hierarchy", icon: Network },
  { id: "brands", label: "Brand library", icon: FlaskConical },
  { id: "history", label: "Batch history", icon: History },
  { id: "settings", label: "Settings", icon: SettingsIcon },
  { id: "users", label: "Users", icon: Users },
] as const;
const formatDate = (s: string) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const num = (n: number) => n.toLocaleString("en-GB");
function Button({
  children,
  onClick,
  variant = "",
  disabled = false,
  type = "button",
  className = "",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const root = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement;
    const getFocusable = () => [
      ...(root.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
      ) || []),
    ];
    getFocusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = getFocusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
      previousFocus?.isConnected && previousFocus.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={root}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Mail;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function ContactsEditor({
  value,
  onChange,
  withTitles = false,
}: {
  withTitles?: boolean;
  value: Contact[];
  onChange: (v: Contact[]) => void;
}) {
  return (
    <div className="contacts-editor">
      {value.map((c, i) => (
        <div className={`contact-edit ${withTitles ? "hierarchy-contact-edit" : ""}`} key={i}>
          {withTitles && <input aria-label={`CC ${i + 1} title`} placeholder="Role / title" value={c.title || ""} onChange={e => onChange(value.map((o, j) => i === j ? { ...o, title: e.target.value } : o))} />}
          <input
            aria-label={`CC ${i + 1} name`}
            placeholder="Name / designation"
            value={c.name}
            onChange={(e) =>
              onChange(
                value.map((o, j) =>
                  i === j ? { ...o, name: e.target.value } : o,
                ),
              )
            }
          />
          <input
            aria-label={`CC ${i + 1} email`}
            type="email"
            placeholder="name@example.com"
            value={c.email}
            onChange={(e) =>
              onChange(
                value.map((o, j) =>
                  i === j ? { ...o, email: e.target.value } : o,
                ),
              )
            }
          />
          <button
            className="icon-button"
            aria-label={`Remove CC ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => i !== j))}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <Button
        variant="text"
        onClick={() => onChange([...value, { name: "", email: "" }])}
      >
        <Plus size={15} />
        Add CC recipient
      </Button>
    </div>
  );
}
function BrandPicker({
  profiles,
  selected,
  onChange,
}: {
  profiles: BrandProfile[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const current = profiles.find((p) => p.id === selected),
    items = profiles
      .filter((p) =>
        (p.brand + " " + p.generic).toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(!!b.favorite) - Number(!!a.favorite) ||
          a.brand.localeCompare(b.brand),
      );
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const choose = (p: BrandProfile) => {
    onChange(p.id);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="brand-picker" ref={root}>
      <button
        type="button"
        className="brand-trigger"
        aria-label="Brand / generic"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
      >
        <span>
          {current?.favorite ? "★ " : ""}
          {current?.brand} · {current?.generic}
        </span>
        <ChevronRight size={14} />
      </button>
      {open && (
        <div className="brand-popover">
          <div className="search">
            <Search size={16} />
            <input
              ref={input}
              role="combobox"
              aria-label="Search brand or generic"
              aria-expanded="true"
              aria-controls="brand-options"
              aria-activedescendant={
                items[active] ? "brand-option-" + active : undefined
              }
              placeholder="Search brand or generic…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                }
                if (e.key === "Enter" && items[active]) {
                  e.preventDefault();
                  choose(items[active]);
                }
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div id="brand-options" role="listbox" className="brand-options">
            {items.map((p, i) => (
              <button
                type="button"
                role="option"
                aria-selected={p.id === selected}
                id={"brand-option-" + i}
                key={p.id}
                className={i === active ? "highlighted" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                <span>
                  <strong>
                    {p.favorite ? "★ " : ""}
                    {p.brand}
                  </strong>
                  <small>{p.generic}</small>
                </span>
                {p.id === selected && <Check size={15} />}
              </button>
            ))}
            {!items.length && <p>No matching brand pairs</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const initialChoice = useRef(false);
  const [androidQueue, setAndroidQueue] = useState<{ batch: Pick<Batch, "id" | "mails"> & { settings: Pick<Settings, "email"> & Partial<Pick<Settings, "name">> }; initialMailId?: string } | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false),
    [bridgeAuto, setBridgeAuto] = useState(
      localStorage.getItem("rxm-bridge-auto-v2") === "true",
    );
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace),
    [mode, setMode] = useState<Mode>("local"),
    [page, setPage] = useState<Page>("generate");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [progress, setProgress] = useState(0),
    [busyText, setBusyText] = useState(""),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    );
  const [brandSearch, setBrandSearch] = useState(""), [brandSearchDraft, setBrandSearchDraft] = useState("");
  const [batchDownload, setBatchDownload] = useState<"eml" | "excel">("excel");
  const [extraGenerics, setExtraGenerics] = useState<Record<string, string[]>>({});
  const [genericSearch, setGenericSearch] = useState("");
  const [deleteBrand, setDeleteBrand] = useState<BrandProfile | null>(null);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const selectedBrand = useRef<BrandProfile>(starterProfiles[0]);
  const [month, setMonth] = useState("2026-06"),
    [endMonth, setEndMonth] = useState("2026-06"),
    [structure, setStructure] = useState<"ACD" | "CCD" | "Both">("ACD"),
    [period, setPeriod] = useState("all"),
    [profileId, setProfileId] = useState("tofen"),
    [dosageForm, setDosageForm] = useState("all"),
    [specialty, setSpecialty] = useState(""),
    [doctorMode, setDoctorMode] = useState<"all" | "top">("all"),
    [doctorLimit, setDoctorLimit] = useState("10"),
    [reviewRegion, setReviewRegion] = useState(""),
    [compactPreview, setCompactPreview] = useState(() => window.innerWidth <= 740),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [mobileNav, setMobileNav] = useState(false);
  const [preview, setPreview] = useState<{
      html: string;
      title: string;
      mail?: RegionalMail;
      sender?: Pick<Settings, "name" | "email">;
      createdAt?: string;
    } | null>(null),
    [batchModal, setBatchModal] = useState<Batch | null>(null),
    [login, setLogin] = useState(false),
    [userEmail, setUserEmail] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [account, setAccount] = useState<UserAccount | null>(null);
  const [sourcePicker, setSourcePicker] = useState<{
      file: File;
      sheets: Sheet[];
      selected: string[];
    } | null>(null),
    [pendingSource, setPendingSource] = useState<Dataset | null>(null);
  const pendingImport = useRef<{ file: File; sheets: Sheet[] } | null>(null);
  const pendingStaged = useRef<Dataset | null>(null);
  const [importMarkets, setImportMarkets] = useState<Set<string>>(new Set());
  const [hierarchyMap, setHierarchyMap] = useState<{
      name: string;
      rows: string[][];
      mapping: Record<string, number>;
      extraCc: HierarchyCcMapping[];
    } | null>(null),
    [pendingHierarchy, setPendingHierarchy] = useState<HierarchyRow[] | null>(
      null,
    ),
    [effectiveDate, setEffectiveDate] = useState(workspaceToday()),
    [hierarchyName, setHierarchyName] = useState("");
  const [editingRow, setEditingRow] = useState<{
      row: HierarchyRow;
      index: number;
    } | null>(null),
    [brandEdit, setBrandEdit] = useState<BrandProfile | null>(null),
    [settingsDraft, setSettingsDraft] = useState<Settings>(workspace.settings);
  const [emailTemplate, setEmailTemplate] = useState(() => emailTemplateFor(workspace.settings));
  useEffect(() => setEmailTemplate(emailTemplateFor(workspace.settings)), [workspace.settings.emailTemplate]);
  const wordingError = templateError(emailTemplate);
  const isAdmin = mode === "cloud" && account?.role === "owner";
  const [deleteSource, setDeleteSource] = useState<Dataset | null>(null);
  const [publishDefault, setPublishDefault] = useState(false);
  const selectedMonths = reportingMonths(month, endMonth);
  const periodLabel = reportingPeriod(month, endMonth, period);
  const composeSettings = { ...workspace.settings, emailTemplate };
  const sourceInput = useRef<HTMLInputElement>(null),
    hierarchyInput = useRef<HTMLInputElement>(null),
    resultInput = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    workspaceRef = useRef(workspace);
  const notify = (text: string, error = false) => setToast({ text, error });
  useEffect(() => {
    workspaceRef.current = workspace;
    setSettingsDraft(workspace.settings);
  }, [workspace]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    let alive = true;
    localLoad()
      .then((w) => {
        if (alive && !initialChoice.current) {
          setWorkspace(w);
          setLoading(false);
          const last = w.datasets
            .filter((d) => d.active)
            .sort((a, b) => b.to.localeCompare(a.to))[0];
          if (last) { setMonth(last.to.slice(0, 7)); setEndMonth(last.to.slice(0, 7)); }
        }
      })
      .catch((e) => {
        setLoading(false);
        notify(e.message, true);
      });
    return () => {
      alive = false;
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) =>
      setUserEmail(session?.user.email || ""),
    );
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let alive = true;
    if (!userEmail) {
      setAccount(null);
      if (mode === "cloud") {
        setWorkspace(emptyWorkspace()); setMode("local");
        setPreview(null); setBatchModal(null); setAndroidQueue(null);
      }
      return;
    }
    // Restore a saved login outside the Supabase auth callback to avoid its session lock.
    const restoreCloud = !initialChoice.current;
    if (restoreCloud) { initialChoice.current = true; setLoading(true); }
    currentAccount().then(async value => {
      if (!alive) return;
      setAccount(value);
      if (restoreCloud) {
        const saved = await cloudLoad();
        if (!alive) return;
        workspaceRef.current = saved; setWorkspace(saved); setMode("cloud");
        const last = saved.datasets.filter(d => d.active).sort((a, b) => b.to.localeCompare(a.to))[0];
        if (last) { setMonth(last.to.slice(0, 7)); setEndMonth(last.to.slice(0, 7)); }
      }
    }).catch(async e => {
      if (!alive) return;
      setAccount(null);
      notify((e as Error).message, true);
      if (restoreCloud) setLoading(false);
      if (e instanceof AccountServiceError && [401, 403].includes(e.status)) {
        setWorkspace(emptyWorkspace()); setMode("local"); setLogin(true); setPassword("");
        await supabase?.auth.signOut({ scope: "local" });
      }
    }).finally(() => { if (alive && restoreCloud) setLoading(false); });
    return () => { alive = false; };
  }, [userEmail]);
  useEffect(() => {
    if (page === "users" && (mode !== "cloud" || account?.role !== "owner")) setPage("settings");
  }, [page, mode, account?.role]);
  const profile = workspace.profiles.find(p => p.id === profileId) || workspace.profiles.find(p => brandPairKey(p) === brandPairKey(selectedBrand.current)) || workspace.profiles[0];
  useEffect(() => {
    if (profile) { selectedBrand.current = profile; if (profileId !== profile.id) setProfileId(profile.id); }
  }, [profile, profileId]);
  const visibleBrandPairs = searchBrandPairs(workspace.profiles, brandSearch);
  const additionalGenerics = profile ? extraGenerics[profile.id] || [] : [];
  const genericOptions = useMemo(() => {
    const names = [...workspace.profiles.map(p => p.generic), ...workspace.datasets.flatMap(datasetGenericNames), ...additionalGenerics];
    const unique = new Map<string, string>();
    for (const name of names) if (name.trim()) unique.set(normalize(name), name);
    return [...unique.values()].sort((a, b) => a.localeCompare(b));
  }, [workspace.profiles, workspace.datasets, additionalGenerics.join("|")]);
  const formsForSelection = useMemo(() => {
    if (!profile) return [];
    if (!additionalGenerics.length) return profile.forms;
    const names = new Set(reportGenericNames({ ...profile, targetGenerics: additionalGenerics }));
    return [...new Set(workspace.datasets.flatMap(d => [...d.catalog.filter(p => names.has(normalize(p.generic))).flatMap(p => p.forms), ...d.facts.filter(f => names.has(normalize(f.generic))).map(f => f.form)]).filter(Boolean))].sort();
  }, [profile, additionalGenerics.join("|"), workspace.datasets]);
  const marketProfile = useMemo(() => profile ? {
    ...profile, targetGenerics: additionalGenerics,
    forms: dosageForm !== "all" && formsForSelection.includes(dosageForm) ? [dosageForm] : additionalGenerics.length ? [] : profile.forms,
  } : undefined, [profile, dosageForm, additionalGenerics.join("|"), formsForSelection]);
  useEffect(() => setDosageForm("all"), [profileId]);
  useEffect(() => {
    if (mode !== "cloud" || !profile) return;
    let alive = true;
    setLoading(true);
    cloudHydrate(workspaceRef.current.datasets, month, marketProfile!, endMonth)
      .then((ds) => {
        if (alive) {
          setWorkspace((w) => ({ ...w, datasets: ds }));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setLoading(false);
          notify(e.message, true);
        }
      });
    return () => {
      alive = false;
    };
  }, [
    mode,
    month,
    endMonth,
    profile?.generic,
    profile?.aliases?.join(","),
    additionalGenerics.join("|"),
    workspace.datasets.map((d) => d.id + ":" + d.active).join(","),
  ]);
  const structureList: Structure[] =
    structure === "Both" ? ["ACD", "CCD"] : [structure];
  const marketSources = workspace.datasets.filter(
    (d) =>
      !d.includedGenerics ||
      d.includedGenerics.some((g) =>
        (marketProfile ? reportGenericNames(marketProfile) : [])
          .includes(normalize(g)),
      ),
  );
  const activeSources = eligibleDatasets(marketSources, month, endMonth),
    days = coverage(marketSources, month, endMonth),
    lastDay = selectedMonths.reduce((sum, m) => sum + new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate(), 0);
  const selectedDays = days.filter(date => period === "all" ||
    (period === "first" && Number(date.slice(8)) <= 10) ||
    (period === "second" && Number(date.slice(8)) >= 11 && Number(date.slice(8)) <= 20) ||
    (period === "third" && Number(date.slice(8)) >= 21));
  const missingMonths = selectedMonths.filter(m => !selectedDays.some(date => date.startsWith(m)));
  const rangeError = !selectedMonths.length ? "Choose a valid From month and To month." : missingMonths.length ?
    `No source coverage for ${missingMonths.map(m => reportingPeriod(m)).join(", ")} in this cycle. Upload or activate the matching MRW sources.` : undefined;
  const missingMarkets = marketProfile ? missingMarketCoverage(workspace.datasets, selectedMonths, marketProfile, period) : [];
  const marketCoverageError = missingMarkets.length ? `Import or activate ${[...new Set(missingMarkets.map(m => m.generic))].join(", ")} for every selected month and cycle.` : undefined;
  const compositionError = wordingError || rangeError || marketCoverageError;
  const currentHierarchy = hierarchyFor(
    workspace.hierarchies,
    workspaceToday(),
  );
  const reportList = useMemo(
    () =>
      marketProfile
        ? reports(
            workspace.datasets,
            month,
            marketProfile,
            structure === "Both" ? ["ACD", "CCD"] : [structure],
            period,
            endMonth,
          )
        : [],
    [workspace.datasets, month, endMonth, marketProfile, structure, period],
  );
  const national = useMemo(() => marketProfile
    ? nationalRxShare(workspace.datasets, month, marketProfile, period, [], endMonth)
    : { total: 0, own: 0, share: null, available: false, reason: "Choose a brand / generic." },
    [workspace.datasets, month, endMonth, marketProfile, period]);
  const specialtyOptions = useMemo(() => reportSpecialties(reportList), [reportList]);
  const chosenSpecialty = specialtyOptions.some(s => s.value === specialty) ? specialty : "";
  const doctorLimitValue = doctorMode === "top" ? Number(doctorLimit) : undefined;
  const doctorSelectionValid = doctorLimitValue === undefined || (Number.isSafeInteger(doctorLimitValue) && doctorLimitValue > 0);
  const doctorSelection = { specialty: chosenSpecialty || undefined, limit: doctorSelectionValid ? doctorLimitValue : undefined };
  const doctorReports = useMemo(() => reportList.map(r => selectReportDoctors(r, {
    specialty: chosenSpecialty || undefined,
    limit: doctorSelectionValid ? doctorLimitValue : undefined,
  })), [reportList, chosenSpecialty, doctorLimitValue, doctorSelectionValid]);
  const queue = useMemo(
    () =>
      regionalQueue(
        doctorReports,
        activeSources,
        currentHierarchy,
        structure === "Both" ? ["ACD", "CCD"] : [structure],
        profile?.brand || "",
        selectedDays.length > 0 && !rangeError,
        selectedDays,
        selectedMonths,

      ),
    [
      doctorReports,
      currentHierarchy,
      structure,
      activeSources,
      period,
      month,
      endMonth,
      rangeError,
      profile,
    ],
  );
  const validQueue = queue.filter((q) => q.row && !q.error),
    blocked = queue.filter((q) => q.error),
    key = (r: RegionReport) => r.structure + ":" + r.region;
  useEffect(
    () => setSelected(new Set(validQueue.map((q) => key(q.report)))),
    [
      month,
      endMonth,
      structure,
      period,
      profileId,
      workspace.hierarchies.length,
      reportList,
    ],
  );
  const filteredQueue = queue.filter((q) =>
    [q.report.region, q.row?.rseName || "", q.row?.rseEmail || ""]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const review = queue.find(q => key(q.report) === reviewRegion) || validQueue[0] || queue[0];
  const previewRegional = (report: RegionReport) => {
    if (!marketProfile) return;
    if (!doctorSelectionValid) { notify("Enter a positive whole number of doctors.", true); return; }
    if (compositionError) { notify(compositionError, true); return; }
    try {
      const m = makeMail(report, marketProfile, periodLabel, currentHierarchy, composeSettings, national);
      setPreview({ html: m.html, title: m.subject, mail: m, sender: { name: workspace.settings.name, email: workspace.settings.email } });
    } catch (e) { notify((e as Error).message, true); }
  };
  async function update(next: Workspace) {
    initialChoice.current = true;
    setBusy(true);
    setBusyText("Saving workspace");
    try {
      if (mode === "local") await localSave(next);
      if (mode === "cloud") {
        const catalogue = await cloudSave(next, workspaceRef.current, setBusyText);
        if (catalogue) next = { ...next, ...catalogue };
        next = { ...next, datasets: next.datasets.map(({ stagedImportId, stagedFactCount, ...dataset }) => dataset) };
      }
      workspaceRef.current = next;
      setWorkspace(next);
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function switchLocal() {
    initialChoice.current = true;
    setLoading(true);
    try {
      const w = await localLoad();
      setWorkspace(w);
      setMode("local");
      const last = w.datasets
        .filter((d) => d.active)
        .sort((a, b) => b.to.localeCompare(a.to))[0];
      if (last) { setMonth(last.to.slice(0, 7)); setEndMonth(last.to.slice(0, 7)); }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  function runWorker<T>(
    file: File,
    action: string,
    sheets?: Sheet[],
    generics?: string[],
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      worker.current?.terminate();
      const w = new Worker(new URL("./import.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (e) => {
        if (e.data.type === "progress") {
          setProgress(e.data.percent);
          setBusyText(e.data.message);
        } else {
          w.terminate();
          worker.current = null;
          e.data.type === "result"
            ? resolve(e.data.result)
            : reject(new Error(e.data.message));
        }
      };
      w.onerror = (e) => {
        w.terminate();
        worker.current = null;
        reject(
          new Error(
            e.message ||
              "The workbook could not be processed on this device. Try a desktop browser.",
          ),
        );
      };
      w.postMessage({ file, action, sheets, generics });
    });
  }
  async function selectFile(
    file: File | undefined,
    kind: "source" | "hierarchy",
  ) {
    if (!file) return;
    if (kind === "hierarchy" && !isAdmin) { notify("Only admins can upload or change the hierarchy.", true); return; }
    if (mode === "demo") {
      notify("Switch to your device workspace to import real data.", true);
      return;
    }
    setBusy(true);
    setProgress(0);
    setBusyText("Inspecting workbook");
    try {
      if (kind === "hierarchy" && file.name.toLowerCase().endsWith(".csv")) {
        const rows = parseCsv(await file.text());
        prepareHierarchyMapping(file.name, rows);
      } else {
        if (!file.name.toLowerCase().endsWith(".xlsx"))
          throw new Error(
            "Please upload an .xlsx workbook. Hierarchy also accepts CSV.",
          );
        const sheets = await runWorker<Sheet[]>(file, "inspect");
        if (kind === "source") {
          const main = sheets.find((s) => /^TRD\b/i.test(s.name)) || sheets[0];
          setSourcePicker({ file, sheets, selected: [main.path] });
        } else {
          const rows = await runWorker<string[][]>(file, "hierarchy", [
            sheets[0],
          ]);
          prepareHierarchyMapping(file.name, rows);
        }
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
      if (sourceInput.current) sourceInput.current.value = "";
      if (hierarchyInput.current) hierarchyInput.current.value = "";
    }
  }
  function prepareHierarchyMapping(name: string, rows: string[][]) {
    if (rows.length < 2)
      throw new Error(
        "The hierarchy needs a header row and at least one region.",
      );
    setHierarchyMap({
      name,
      rows,
      extraCc: extraHierarchyCcMappings(rows[0]),
      mapping: Object.fromEntries(
        hierarchyColumns.map((c) => [
          c,
          rows[0].findIndex((h) => normalize(h) === normalize(c)),
        ]),
      ),
    });
    setHierarchyName(name.replace(/\.(xlsx|csv)$/i, ""));
  }
  async function processSource() {
    if (!sourcePicker) return;
    setBusy(true);
    setBusyText("Preparing import");
    setProgress(0);
    const choice = sourcePicker;
    setSourcePicker(null);
    try {
      const chosenSheets = choice.sheets.filter((s) =>
        choice.selected.includes(s.path),
      );
      pendingImport.current = { file: choice.file, sheets: chosenSheets };
      const d = await runWorker<Dataset>(
        choice.file,
        "source",
        chosenSheets,
        [],
      );
      if (d.invalidRows)
        throw new Error(
          `${num(d.invalidRows)} rows have missing doctor codes, generic names or invalid dates. Correct these rows and re-upload to keep the Rx totals accurate.`,
        );
      const available = datasetGenericNames(d);
      setImportMarkets(new Set(mode === "cloud" ? available :
        [...new Set([...starterProfiles.map(p => p.generic), ...workspace.datasets.flatMap(ds => ds.includedGenerics || [])])]
          .filter(g => available.some(name => normalize(name) === normalize(g)))));
      setPendingSource(d);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function commitSource(replace: boolean) {
    if (!pendingSource) return;
    if (!importMarkets.size) {
      notify("Select at least one generic market to retain.", true);
      return;
    }
    const scope = [...importMarkets].sort();
    const sourceHash = pendingSource.hash;
    const scopeDigest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            sourceHash + JSON.stringify([pendingSource.sheets, scope]),
          ),
        ),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const existingSource = workspace.datasets.find(d => d.hash === scopeDigest);
    if (existingSource) {
      if (!existingSource.aseByMpe && pendingSource.aseByMpe && Object.values(pendingSource.aseByMpe).some(values => Object.keys(values).length)) {
        const recovered = { ...existingSource, aseByMpe: pendingSource.aseByMpe };
        if (await update({ ...workspace, datasets: workspace.datasets.map(d => d.id === existingSource.id ? recovered : d) })) {
          setPendingSource(null);
          notify("ASE details recovered for the saved source.");
        }
        return;
      }
      notify(
        "This file and market selection were already imported. Use its saved version in Source files.",
        true,
      );
      return;
    }
    let source = pendingStaged.current || pendingSource;
    const preparedScope = new Set(source.includedGenerics?.map(normalize));
    const scopeMatches = preparedScope.size === scope.length && scope.every(g => preparedScope.has(normalize(g)));
    if (
      (mode === "cloud" && (!source.stagedImportId || !scopeMatches)) || scope.some(g => !preparedScope.has(normalize(g)))
    ) {
      if (!pendingImport.current) {
        notify("Select the original workbook again to add markets.", true);
        return;
      }
      setBusy(true);
      setProgress(0);
      try {
        if (pendingStaged.current?.stagedImportId) {
          await clearStagedImport(pendingStaged.current.stagedImportId);
          pendingStaged.current = null;
        }
        source = await runWorker<Dataset>(
          pendingImport.current.file,
          mode === "cloud" ? "source-staged" : "source",
          pendingImport.current.sheets,
          scope,
        );
        if (source.stagedImportId) pendingStaged.current = source;
      } catch (e) {
        notify((e as Error).message, true);
        return;
      } finally {
        setBusy(false);
      }
    }
    const retainedScope = new Set(scope.map(normalize));
    const d = {
      ...source,
      sourceHash,
      hash: scopeDigest,
      includedGenerics: scope,
      facts: source.facts.filter((f) => retainedScope.has(normalize(f.generic))),
    };
    const conflicts = workspace.datasets.filter(
      (o) => o.active && overlaps(o, d),
    );
    if (conflicts.length && !replace) {
      notify("This import overlaps active reporting dates.", true);
      return;
    }
    const datasets = workspace.datasets.map((o) =>
      conflicts.some((c) => c.id === o.id) ? { ...o, active: false } : o,
    );
    const profiles = appendBrandPairs(workspace.profiles, sourceBrandPairs([d]), workspace.deletedBrandPairs);
    const next = { ...workspace, datasets: [...datasets, d], profiles };
    if (await update(next)) {
      setPendingSource(null);
      pendingImport.current = null;
      pendingStaged.current = null;
      if (source.stagedImportId) await clearStagedImport(source.stagedImportId).catch(() => {});
      setMonth(d.to.slice(0, 7));
      setEndMonth(d.to.slice(0, 7));
      setPage("generate");
      notify(`${num(d.rows)} product occurrences imported`);
    }
  }
  async function saveHierarchy() {
    if (!isAdmin) { notify("Admin access required", true); return; }
    if (!pendingHierarchy?.length) return;
    if (!hierarchyName.trim() || !effectiveDate) {
      notify("Give this hierarchy a name and effective date.", true);
      return;
    }
    const h: Hierarchy = {
      id: crypto.randomUUID(),
      name: hierarchyName.trim(),
      effectiveFrom: effectiveDate,
      rows: pendingHierarchy,
      createdAt: new Date().toISOString(),
    };
    if (
      await update({ ...workspace, hierarchies: [...workspace.hierarchies, h] })
    ) {
      setPendingHierarchy(null);
      notify("Hierarchy version saved");
    }
  }
  async function generate(destination: "download" | "android" = "download") {
    if (!marketProfile) return;
    if (!doctorSelectionValid) { notify("Enter a positive whole number of doctors.", true); return; }
    if (compositionError) { notify(compositionError, true); return; }
    const chosen = validQueue.filter((q) => selected.has(key(q.report)));
    if (!chosen.length) {
      notify("Select at least one region with a valid recipient.", true);
      return;
    }
    try {
      const mails = chosen.map((q) =>
        makeMail(
          q.report,
          marketProfile,
          periodLabel,
          currentHierarchy,
          composeSettings,
          national,
        ),
      );
      const batch: Batch = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        month,
        endMonth,
        period,
        brand: profile.brand,
        generic: marketLabel(marketProfile),
        sourceIds: activeSources.map((d) => d.id),
        hierarchyId: currentHierarchy!.id,
        settings: structuredClone(composeSettings),
        profile: structuredClone(marketProfile),
        national: structuredClone(national),
        doctorSelection: structuredClone(doctorSelection),
        mails,
      };
      if (
        await update({ ...workspace, batches: [batch, ...workspace.batches] })
      ) {
        setBatchModal(batch);
        if (destination === "android") { await androidBatch(batch); return; }
        if (batchDownload === "excel") await downloadExcelBatch(batch);
        else downloadEmlBatch(batch);
        if (
          bridgeAuto &&
          mode !== "demo" &&
          localStorage.getItem("rxm-bridge-token")
        )
          await openBatch(batch);
      }
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  function androidBatch(batch: Batch) {
    setAndroidQueue({ batch });
  }
  function downloadEmlBatch(batch: Batch) {
    try {
      download(
        emlPackage(batch) as unknown as BlobPart,
        emlPackageFilename(batch),
        "application/zip",
      );
      notify(`${batch.mails.length} .eml emails downloaded in one ZIP. Extract it and review in Outlook.`);
    } catch (e) {
      notify((e as Error).message + " Your prepared batch is saved in History.", true);
    }
  }
  async function downloadExcelBatch(batch: Batch) {
    if (excelDownloading) return;
    setExcelDownloading(true);
    try {
      const bytes = await loadOutlookExcel(batch);
      download(bytes as unknown as BlobPart, outlookExcelFilename(batch), OUTLOOK_EXCEL_TYPE);
      notify(`${batch.mails.length} emails downloaded in Excel. Open the workbook and click Open all emails in Outlook.`);
    } catch (e) {
      notify((e as Error).message + " Your prepared batch is saved in History.", true);
    } finally {
      setExcelDownloading(false);
    }
  }
  function downloadEml(mail: RegionalMail, sender: Pick<Settings, "name" | "email">, createdAt?: string) {
    try {
      download(mailEml(mail, sender, createdAt), emlFilename(mail), "message/rfc822");
      notify(".eml email downloaded. Review it in Outlook before sending.");
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function openBatch(batch: Batch) {
    setBusy(true);
    setBusyText("Opening your emails in Classic Outlook");
    try {
      const results = await openViaBridge(batch);
      const updated = applyResults(batch, results);
      setBridgeConnected(true);
      if (
        await update({
          ...workspaceRef.current,
          batches: workspaceRef.current.batches.map((b) =>
            b.id === batch.id ? updated : b,
          ),
        })
      ) {
        setBatchModal(updated);
        notify(
          `${updated.mails.filter((m) => m.status === "Opened").length} emails opened in Outlook`,
        );
      }
    } catch (e) {
      setBridgeConnected(false);
      notify(
        (e as Error).message + " Your prepared batch is saved in History. Use Download .eml ZIP to open the emails without the companion.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  async function loginSubmit() {
    if (!supabase) {
      notify(
        "Cloud is waiting for Supabase configuration. Your device workspace is available.",
        true,
      );
      return;
    }
    initialChoice.current = true;
    setBusy(true);
    setBusyText("Connecting to Supabase");
    try {
      const signedIn = await usernameSignIn(username, password);
      setAccount(signedIn);
      setPassword("");
      const w = await cloudLoad();
      workspaceRef.current = w;
      setWorkspace(w);
      setMode("cloud");
      const last = w.datasets.filter(d => d.active).sort((a, b) => b.to.localeCompare(a.to))[0];
      if (last) { setMonth(last.to.slice(0, 7)); setEndMonth(last.to.slice(0, 7)); }
      setLogin(false);
      notify("Connected to your SBM cloud workspace");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function openCloud() {
    initialChoice.current = true;
    if (!cloudConfigured) {
      setLogin(true);
      return;
    }
    if (!userEmail) {
      setLogin(true);
      return;
    }
    setLoading(true);
    try {
      setAccount(await currentAccount());
      setWorkspace(await cloudLoad());
      setMode("cloud");
      notify("Cloud workspace opened");
    } catch (e) {
      if (e instanceof AccountServiceError && [401, 403].includes(e.status)) {
        await supabase?.auth.signOut({ scope: "local" });
        setAccount(null);
        setPassword("");
        setLogin(true);
      }
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  async function signOutAccount() {
    setBusy(true); setBusyText("Signing out");
    try {
      setAndroidQueue(null);
      const result = await supabase?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      setAccount(null); setUserEmail("");
      setPassword(""); setUsername(""); setLogin(false);
      setPreview(null); setBatchModal(null); setDeleteSource(null); setDeleteBrand(null);
      setHierarchyMap(null); setPendingHierarchy(null); setEditingRow(null);
      workspaceRef.current = emptyWorkspace(); setWorkspace(emptyWorkspace()); setMode("local");
      await switchLocal();
      notify("Signed out");
    } catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  }
  async function refreshBrandCatalogue() {
    if (!isAdmin) { notify("Admin access required", true); return; }
    setBusy(true); setBusyText("Checking imported Beximco catalogues");
    try {
      const result = await cloudUpdateCatalogue();
      const next = { ...workspaceRef.current, ...result, profiles: reconcileBrandPairs(result.profiles, workspaceRef.current.datasets, result.deletedBrandPairs) };
      workspaceRef.current = next; setWorkspace(next);
      notify(result.added ? `${result.added} new Beximco brand pair${result.added === 1 ? "" : "s"} added. Existing pairs kept unchanged.` : "No new Beximco pairs found.");
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  }
  async function importResults(file: File | undefined) {
    if (!file) return;
    try {
      const result = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      if (result.schemaVersion !== 1 || !Array.isArray(result.results))
        throw new Error("Invalid Outlook results file");
      const batch = workspace.batches.find((b) => b.id === result.batchId);
      if (!batch)
        throw new Error(
          "This result belongs to a different batch or workspace",
        );
      const ids = new Set(batch.mails.map((m) => m.id));
      if (
        result.results.some(
          (r: { id: string; status: string }) =>
            !ids.has(r.id) || !["Opened", "Failed"].includes(r.status),
        )
      )
        throw new Error("Results contain unknown messages or statuses");
      const mails = batch.mails.map((m) => {
        const r = result.results.find((r: { id: string }) => r.id === m.id);
        return r ? { ...m, status: r.status, error: String(r.error || "") } : m;
      });
      if (
        await update({
          ...workspace,
          batches: workspace.batches.map((b) =>
            b.id === batch.id ? { ...b, mails } : b,
          ),
        })
      )
        notify("Outlook opening results recorded");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      if (resultInput.current) resultInput.current.value = "";
    }
  }
  const demo = () => {
    initialChoice.current = true;
    setWorkspace(demoWorkspace());
    setMode("demo");
    setMonth("2026-06");
    setEndMonth("2026-06");
    setProfileId("tofen");
    setPage("generate");
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("generate");
          }}
        >
          <span className="brand-mark">
            <Mail size={22} />
            <i />
          </span>
          <span>
            Rx Mail<span className="brand-sub">Studio</span>
          </span>
        </a>
        <span className="workspace-label">SBM WORKSPACE</span>
        <nav>
          {nav.filter((n) => n.id !== "users" || (mode === "cloud" && account?.role === "owner")).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMobileNav(false);
              }}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "generate" && validQueue.length > 0 && (
                <small>{validQueue.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="user" onClick={() => setPage("settings")}>
            <span className="avatar">{account?.username.slice(0, 2) || "SB"}</span>
            <span>
              <strong>
                {workspace.settings.name || account?.name || account?.username || "Set up your profile"}
              </strong>
              <small>{account ? `${account.username} · ${account.role === "owner" ? "Admin" : account.role === "editor" ? "Editor" : "Member"}` : "SBM · Beximco"}</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-only"
              aria-label="Navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="top-actions">
            <button
              className={`mode-pill ${mode === "demo" ? "demo" : mode === "cloud" ? "cloud-dot" : ""}`}
              aria-label={mode === "cloud" ? "Cloud connected" : mode === "demo" ? "Sample workspace" : "On this device"}
              title={mode === "cloud" ? "Cloud connected" : mode === "demo" ? "Sample workspace" : "On this device"}
              onClick={openCloud}
            >
              {mode !== "cloud" && <><Monitor size={14} /><span>
                {mode === "demo"
                    ? "Sample workspace"
                    : "On this device"}
              </span></>}
              <span className="status-dot" />
            </button>
            {account && <span className="account-identity">{account.username}<small>{account.role === "owner" ? "Admin" : account.role === "editor" ? "Editor" : "Member"}</small></span>}
            {userEmail ? <Button className="top-account-action" variant="text" disabled={busy} onClick={signOutAccount}><LogOut size={15} />Sign out</Button> :
              <Button className="top-account-action" variant="secondary" disabled={busy} onClick={() => { initialChoice.current = true; setLogin(true); }}><Users size={15} />Sign in</Button>}
          </div>
        </header>
        <main>
          {mode === "demo" && (
            <div className="notice sample">
              <FlaskConical size={17} />
              <span>
                Sample workspace · fictional doctors and recipients. Real files
                stay separate.
              </span>
              <button onClick={switchLocal}>
                Open my workspace
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {userEmail && mode !== "cloud" && <div className="notice"><Cloud size={17} /><span>{account?.username || "Your account"} is signed in. Open the cloud workspace to access shared data{account?.role === "owner" ? " and admin controls" : ""}.</span><button onClick={openCloud} disabled={busy || loading}>Open cloud workspace<ArrowRight size={14} /></button></div>}
          {mode === "local" && !loading && !workspace.datasets.length && (
            <div className="notice welcome">
              <span>
                Start with your MRW file, or explore the workflow with sample
                data.
              </span>
              <button onClick={demo}>
                Explore sample
                <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>
                {
                  {
                    generate: "Generate emails",
                    sources: "Source files",
                    hierarchy: "Region hierarchy",
                    brands: "Brand library",
                    history: "Batch history",
                    settings: "Workspace settings",
                    users: "User management",
                  }[page]
                }
              </h1>
            </div>
            {page === "sources" ? (
              <Button
                onClick={() => sourceInput.current?.click()}
                disabled={busy}
              >
                <Plus size={17} />
                Upload MRW file
              </Button>
            ) : page === "hierarchy" ? (
              <Button
                onClick={() => hierarchyInput.current?.click()}
                disabled={busy || !isAdmin}
              >
                <UploadCloud size={17} />
                Upload hierarchy
              </Button>
            ) : page === "brands" ? (
              <Button
                onClick={() =>
                  setBrandEdit({
                    id: crypto.randomUUID(),
                    generic: "",
                    brand: "",
                    forms: [],
                  })
                }
              >
                <Plus size={17} />
                Add brand pair
              </Button>
            ) : page === "history" ? (
              <Button
                variant="secondary"
                onClick={() => resultInput.current?.click()}
                disabled={busy}
              >
                <UploadCloud size={17} />
                Import Outlook results
              </Button>
            ) : null}
          </div>
          {page === "generate" && (
            <>
              <section className="filter-card">
                <h2 className="filter-title">Report selection</h2>
                <div className="filters">
                  <Field label="From month">
                    <div className="input-icon">
                      <CalendarDays size={17} />
                      <input
                        type="month"
                        value={month}
                        onChange={(e) =>
                          e.target.value && (setMonth(e.target.value), endMonth < e.target.value && setEndMonth(e.target.value))
                        }
                        aria-label="From month"
                      />
                    </div>
                  </Field>
                  <Field label="To month">
                    <input type="month" min={month} value={endMonth} onChange={e => e.target.value && setEndMonth(e.target.value)} aria-label="To month" />
                  </Field>
                  <Field label="Territory structure">
                    <select
                      value={structure}
                      onChange={(e) =>
                        setStructure(e.target.value as typeof structure)
                      }
                    >
                      <option>ACD</option>
                      <option>CCD</option>
                      <option>Both</option>
                    </select>
                  </Field>
                  <Field label="Brand / generic">
                    <BrandPicker
                      profiles={workspace.profiles}
                      selected={profile?.id || ""}
                      onChange={setProfileId}
                    />
                  </Field>
                  <Field label="Reporting cycle">
                    <select
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                    >
                      <option value="all">All available dates</option>
                      <option value="first">1–10</option>
                      <option value="second">11–20</option>
                      <option value="third">21–month end</option>
                    </select>
                  </Field>
                  <details className="generic-target-picker">
                    <summary>Target generics · {marketProfile ? targetGenericNames(marketProfile).length : 0}</summary>
                    <input aria-label="Search target generics" placeholder="Search generic" value={genericSearch} onChange={e => setGenericSearch(e.target.value)} />
                    <div className="generic-target-list">
                      {genericOptions.filter(g => !genericSearch || normalize(g).includes(normalize(genericSearch))).map(g => {
                        const primary = normalize(g) === normalize(profile?.generic);
                        return <label key={normalize(g)} className="sheet-choice"><input type="checkbox" aria-label={`Target generic ${g}`} disabled={primary || !profile} checked={primary || additionalGenerics.some(value => normalize(value) === normalize(g))} onChange={e => {
                          if (!profile) return;
                          const next = additionalGenerics.filter(value => normalize(value) !== normalize(g));
                          setExtraGenerics({ ...extraGenerics, [profile.id]: e.target.checked ? [...next, g] : next });
                          setDosageForm("all");
                        }} />{g}{primary ? " (own generic)" : ""}</label>;
                      })}
                    </div>
                    {additionalGenerics.length > 0 && <button className="text-link" onClick={() => { if (profile) setExtraGenerics({ ...extraGenerics, [profile.id]: [] }); setDosageForm("all"); }}>Use own generic only</button>}
                  </details>
                  <Field label="Dosage form">
                    <select value={dosageForm} onChange={e => setDosageForm(e.target.value)} aria-label="Dosage form">
                      <option value="all">{additionalGenerics.length ? "All forms in selected markets" : profile?.forms.join(" + ") || "All forms"}</option>
                      {formsForSelection.map(form => <option key={form} value={form}>{form}</option>)}
                    </select>
                  </Field>
                  <Field label="Specialty">
                    <select value={chosenSpecialty} onChange={e => setSpecialty(e.target.value)} aria-label="Specialty">
                      <option value="">All specialties</option>
                      {specialtyOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                  <div className="doctor-limit-field">
                    <Field label="Doctors per region" hint={doctorSelectionValid ? undefined : "Enter a positive whole number."}>
                      <div className="doctor-limit-control">
                        <select value={doctorMode} onChange={e => setDoctorMode(e.target.value as "all" | "top")} aria-label="Doctor selection">
                          <option value="all">All doctors</option>
                          <option value="top">Top</option>
                        </select>
                        {doctorMode === "top" && <input type="number" min="1" step="1" value={doctorLimit} onChange={e => setDoctorLimit(e.target.value)} aria-label="Number of doctors" aria-invalid={!doctorSelectionValid} />}
                      </div>
                    </Field>
                  </div>
                </div>
                <div className="filter-footer">
                  <span>
                    <span
                      className={`status-dot ${days.length === lastDay ? "" : "amber"}`}
                    />
                    {days.length
                      ? `${days.length} of ${lastDay} days available · ${periodLabel}`
                      : "No source data for this market / month"}
                  </span>
                  <span className="market-tag">
                    <FlaskConical size={13} />
                    {marketProfile?.forms.join(" + ") || "All forms"}
                    <button
                      onClick={() => profile && setBrandEdit({ ...profile })}
                    >
                      Edit market
                    </button>
                  </span>
                </div>
              </section>
              {rangeError && <div className="notice benchmark-notice" role="status"><AlertCircle size={17} /><span>{rangeError}</span></div>}
              {marketCoverageError && !rangeError && <div className="notice benchmark-notice" role="status"><AlertCircle size={17} /><span>{marketCoverageError}</span></div>}
              {additionalGenerics.length > 0 && <p className="notice">Selected markets: {marketProfile && marketLabel(marketProfile)}. Rx shares use the combined selected-market total.</p>}
              <details className="card email-customization">
                <summary>Customize email subject &amp; body</summary>
                <div className="email-customization-body">

                  <EmailTemplateEditor value={emailTemplate} onChange={setEmailTemplate} />
                </div>
              </details>
              <div className="stats">
                <div className="stat stat-teal"><div className="stat-icon"><Mail size={21} /></div><div><span>Emails ready</span><strong>{num(validQueue.length)}</strong><small>{structure === "Both" ? "ACD + CCD" : structure}</small></div></div>
                <div className="stat stat-blue"><div className="stat-icon"><FlaskConical size={21} /></div><div><span>National {profile?.brand} share</span><strong>{!loading && national.available && national.share !== null ? national.share.toFixed(1) + "%" : "N/A"}</strong></div></div>
                <div className="stat stat-violet"><div className="stat-icon"><Users size={21} /></div><div><span>Doctor review</span><strong>{national.available ? num(doctorReports.reduce((n, r) => n + r.doctors.filter(d => belowNational(d, national)).length, 0)) : "—"}</strong><small>Entries below national</small></div></div>
              </div>
              {!loading && activeSources.length > 0 && !national.available && <div className="notice benchmark-notice"><AlertCircle size={17} /><span>National benchmark unavailable. {national.reason} Doctor rows will remain unmarked.</span></div>}
              <div className="generation-layout">
              <section className="card queue-card">
                <div className="card-header">
                  <div>
                    <h2>
                      Regional email queue{" "}
                      <span className="count-badge">{queue.length}</span>
                    </h2>
                  </div>
                  <div className="search">
                    <Search size={16} />
                    <input
                      placeholder="Search region or RSE"
                      aria-label="Search region or RSE"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                {blocked.length > 0 && (
                  <div className="inline-alert">
                    <AlertCircle size={16} />
                    <span>
                      {blocked.length} region{blocked.length > 1 ? "s" : ""}{" "}
                      need recipient or data checks. Select the ready regions to
                      continue.
                    </span>
                    <button onClick={() => setPage("hierarchy")}>
                      Review hierarchy
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
                {loading ? (
                  <div className="empty">
                    <LoaderCircle className="spin" />
                    <p>Loading your regional data…</p>
                  </div>
                ) : queue.length ? (
                  <div className="table-scroll">
                    <table className="queue-table">
                      <thead>
                        <tr>
                          <th className="check-cell">
                            <input
                              type="checkbox"
                              aria-label="Select all ready regions"
                              checked={
                                validQueue.length > 0 &&
                                selected.size === validQueue.length
                              }
                              onChange={(e) =>
                                setSelected(
                                  new Set(
                                    e.target.checked
                                      ? validQueue.map((q) => key(q.report))
                                      : [],
                                  ),
                                )
                              }
                            />
                          </th>
                          <th>Region / RSE</th>
                          <th>Prescribers</th>
                          <th>{profile?.brand} share</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQueue.map((q) => (
                          <tr key={key(q.report)} className={review && key(review.report) === key(q.report) ? "review-selected" : ""}>
                            <td className="check-cell">
                              <input
                                type="checkbox"
                                aria-label={`Select ${q.report.structure} ${q.report.region}`}
                                disabled={!!q.error}
                                checked={selected.has(key(q.report))}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  e.target.checked
                                    ? next.add(key(q.report))
                                    : next.delete(key(q.report));
                                  setSelected(next);
                                }}
                              />
                            </td>
                            <td>
                              <div className="region-cell">
                                <span className="region-avatar">
                                  {q.report.region}
                                </span>
                                <div>
                                  <button className="region-select" onClick={() => setReviewRegion(key(q.report))} aria-label={`Review region ${q.report.region}`}>{q.report.region}</button>
                                  <small>{q.row?.rseName || "RSE not assigned"}</small>
                                  <small>
                                    {q.report.structure} ·{" "}
                                    {q.row?.rseEmail ||
                                      "Upload or update hierarchy"}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <strong>{q.report.doctors.length}</strong>
                              <small className="subvalue">
                                {num(q.report.total)} Rx
                              </small>
                            </td>
                            <td>
                              <strong>
                                {q.report.total
                                  ? (
                                      (q.report.own / q.report.total) *
                                      100
                                    ).toFixed(1) + "%"
                                  : "—"}
                              </strong>
                              <div className="mini-track">
                                <span
                                  style={{
                                    width: q.report.total
                                      ? (q.report.own / q.report.total) * 100 +
                                        "%"
                                      : "0",
                                  }}
                                />
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${q.error ? "warning" : "success"}`}
                              >
                                {q.error ? (
                                  <AlertCircle size={12} />
                                ) : (
                                  <Check size={12} />
                                )}{" "}
                                {q.error ||
                                  (q.report.total ? "Ready" : "Ready · No Rx")}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                disabled={!!q.error || !doctorSelectionValid || !!compositionError}
                                aria-label={`Preview ${q.report.region} email`}
                                onClick={() => previewRegional(q.report)}
                              >
                                <Eye size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Mail}
                    title="Your next batch starts here"
                    text="Upload an MRW source file and your regional hierarchy. The queue will grow with your regions."
                    action={
                      <div className="empty-actions">
                        <Button onClick={() => sourceInput.current?.click()}>
                          <UploadCloud size={16} />
                          Upload MRW file
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setPage("hierarchy")}
                        >
                          Set up hierarchy
                        </Button>
                      </div>
                    }
                  />
                )}
                <div className="queue-footer">
                  <span>
                    <ShieldCheck size={15} />
                    {selected.size} selected · manual sending
                  </span>
                  <label className="batch-download-choice">
                    Download format
                    <select value={batchDownload} onChange={e => setBatchDownload(e.target.value as "eml" | "excel")} disabled={busy || excelDownloading}>
                      <option value="excel">Outlook Excel (.xlsm)</option>
                      <option value="eml">.eml ZIP</option>
                    </select>
                  </label>
                  <Button
                    disabled={busy || loading || excelDownloading || !selected.size || !doctorSelectionValid || !!compositionError}
                    onClick={() => void generate()}
                  >
                    <Mail size={17} />
                    Generate {selected.size || ""} emails
                    <ArrowRight size={16} />
                  </Button>
                  <Button variant="secondary" disabled={busy || loading || excelDownloading || !selected.size || !doctorSelectionValid || !!compositionError} onClick={() => void generate("android")}>
                    <Smartphone size={17} />
                    Android mail · {selected.size || ""}
                  </Button>
                </div>
              </section>
              <RegionReview report={review?.report} brand={profile?.brand || ""} recipient={review?.row?.rseName} national={national} blocked={review?.error || compositionError || (!doctorSelectionValid ? "Enter a positive whole number of doctors." : undefined)} onPreview={() => review && previewRegional(review.report)} />
              </div>
            </>
          )}
          {page === "sources" && (
            <>
              <div className="source-upload">
              <section
                className="upload-card"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void selectFile(e.dataTransfer.files[0], "source");
                }}
              >
                <div className="upload-symbol">
                  <FileSpreadsheet size={31} />
                </div>
                <h2>Drop .xlsx here</h2>
              </section>
              </div>
              <section className="card">
                <div className="card-header">
                  <div>
                    <h2>
                      Import library{" "}
                      <span className="count-badge">
                        {workspace.datasets.length}
                      </span>
                    </h2>
                  </div>
                </div>
                {workspace.datasets.length ? (
                  <div className="source-list">
                    {workspace.datasets
                      .slice()
                      .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                      .map((d) => (
                        <div className="source-row" key={d.id}>
                          <span className="file-icon">
                            <FileSpreadsheet size={22} />
                          </span>
                          <div className="source-info">
                            <strong>{d.name}</strong>
                            <small>
                              {formatDate(d.from)} — {formatDate(d.to)} ·{" "}
                              {num(d.rows)} product occurrences
                            </small>
                            <small>
                              {d.sheets.join(", ")} · {num(d.facts.length)}{" "}
                              counts{" "}
                              {mode === "cloud"
                                ? "loaded for selected market"
                                : ""}
                            </small>
                          </div>
                          <span
                            className={`badge ${d.active ? "success" : "neutral"}`}
                          >
                            {d.active ? "Active" : "Archived"}
                          </span>
                          <Button
                            variant="text"
                            disabled={busy || mode === "demo"}
                            onClick={async () => {
                              if (
                                !d.active &&
                                workspace.datasets.some(
                                  (o) =>
                                    o.active && o.id !== d.id && overlaps(o, d),
                                )
                              ) {
                                notify(
                                  "Deactivate the overlapping import before activating this version.",
                                  true,
                                );
                                return;
                              }
                              await update({
                                ...workspace,
                                datasets: workspace.datasets.map((o) =>
                                  o.id === d.id
                                    ? { ...o, active: !o.active }
                                    : o,
                                ),
                              });
                            }}
                          >
                            {d.active ? "Deactivate" : "Activate"}
                          </Button>
                          {isAdmin && <Button variant="text" disabled={busy} onClick={() => setDeleteSource(d)}><Trash2 size={15} />Delete</Button>}
                        </div>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={FileSpreadsheet}
                    title="No source files yet"
                    text="Monthly files and 10-day phases can be imported. Their dates tell you exactly which coverage is available."
                  />
                )}
              </section>
            </>
          )}
          {page === "hierarchy" && (
            <>
              <div className="hierarchy-summary">
                <div className="card small-card">
                  <span className="label">CURRENT VERSION</span>
                  <h3>{currentHierarchy?.name || "Not configured"}</h3>
                  <p>
                    {currentHierarchy
                      ? `Effective ${formatDate(currentHierarchy.effectiveFrom)} · ${currentHierarchy.rows.filter((r) => r.active).length} active region assignments`
                      : "Upload your quarterly hierarchy or add regions manually."}
                  </p>
                  <button
                    className="text-link"
                    onClick={() =>
                      download(
                        hierarchyColumns.join(",") +
                          "\n" +
                          [
                            "ACD",
                            "D5",
                            "Sample RSE",
                            "rse@example.com",
                            "Sample Bhai",
                            "Hierarchy Manager 1",
                            "manager1@example.com",
                            "Hierarchy Manager 2",
                            "manager2@example.com",
                            "Hierarchy Manager 3",
                            "manager3@example.com",
                            "Yes",
                          ].join(",") +
                          "\n",
                        "hierarchy-template.csv",
                        "text/csv",
                      )
                    }
                  >
                    <Download size={14} />
                    Download Excel-compatible template
                  </button>
                </div>
              </div>
              <section className="card">
                <div className="card-header">
                  <div>
                    <h2>Regional recipients</h2>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!isAdmin}
                    onClick={() => {
                      if (!isAdmin) return;
                      setPendingHierarchy(
                        currentHierarchy?.rows.map((r) => ({
                          ...r,
                          cc: r.cc.map((c) => ({ ...c })),
                        })) || [],
                      );
                      setHierarchyName(
                        currentHierarchy
                          ? currentHierarchy.name + " · revised"
                          : "Regional hierarchy",
                      );
                      setEffectiveDate(workspaceToday());
                    }}
                  >
                    <Plus size={16} />
                    Create version
                  </Button>
                  {isAdmin && currentHierarchy && <Button variant="secondary" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { const hierarchy = await cloudExportHierarchy(currentHierarchy.id); download(hierarchyCsv(hierarchy), "full-hierarchy.csv", "text/csv;charset=utf-8"); }
                    catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
                  }}><Download size={16} />Download full hierarchy</Button>}
                </div>
                {currentHierarchy?.rows.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Region</th>
                          <th>RSE / To</th>
                          <th>Greeting</th>
                          <th>Hierarchy CC</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentHierarchy.rows.map((r, i) => (
                          <tr key={i}>
                            <td>
                              <strong>{r.region}</strong>
                              <small className="subvalue">{r.structure}</small>
                            </td>
                            <td>
                              <strong>{r.rseName}</strong>
                              <small className="subvalue">{r.rseEmail}</small>
                            </td>
                            <td>Dear {r.salutation},</td>
                            <td>
                              {r.cc.map((c) => (
                                <span className="email-chip" key={c.email}>
                                  {c.title ? `${c.title}: ` : ""}{c.email}
                                </span>
                              ))}
                            </td>
                            <td>
                              <span
                                className={`badge ${r.active ? "success" : "neutral"}`}
                              >
                                {r.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Network}
                    title="Connect your regions"
                    text="Upload your hierarchy workbook, map its columns and review each regional RSE and their hierarchy."
                    action={
                      <Button disabled={!isAdmin} onClick={() => hierarchyInput.current?.click()}>
                        <UploadCloud size={16} />
                        Upload hierarchy
                      </Button>
                    }
                  />
                )}
              </section>
              {workspace.hierarchies.length > 0 && (
                <section className="card version-card">
                  <div className="card-header">
                    <h2>Hierarchy versions</h2>
                  </div>
                  {workspace.hierarchies
                    .slice()
                    .sort((a, b) =>
                      b.effectiveFrom.localeCompare(a.effectiveFrom),
                    )
                    .map((h) => (
                      <div className="version-row" key={h.id}>
                        <Network size={18} />
                        <div>
                          <strong>{h.name}</strong>
                          <small>
                            Effective {formatDate(h.effectiveFrom)} ·{" "}
                            {h.rows.length} assignments
                          </small>
                        </div>
                        <span
                          className={`badge ${h.id === currentHierarchy?.id ? "success" : "neutral"}`}
                        >
                          {h.id === currentHierarchy?.id
                            ? "Current"
                            : h.effectiveFrom > workspaceToday()
                              ? "Scheduled"
                              : "Previous"}
                        </span>
                        <button
                          className="text-link"
                          disabled={!isAdmin}
                          onClick={() => {
                            if (!isAdmin) return;
                            setPendingHierarchy(structuredClone(h.rows));
                            setHierarchyName(h.name + " · revised");
                            setEffectiveDate(workspaceToday());
                          }}
                        >
                          Create revision
                        </button>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {page === "brands" && (
            <>
              <div className="card brand-library-toolbar">
                <form onSubmit={e => { e.preventDefault(); setBrandSearch(brandSearchDraft); }} className="brand-library-search" role="search" aria-label="Brand Library search">
                  <div className="search"><Search size={16} /><input aria-label="Search Brand Library" placeholder="Search brand or generic" value={brandSearchDraft} onChange={e => setBrandSearchDraft(e.target.value)} /></div>
                  <Button type="submit" variant="secondary">Search</Button>
                  {brandSearch && <Button variant="text" onClick={() => { setBrandSearch(""); setBrandSearchDraft(""); }}>Clear</Button>}
                </form>
                {isAdmin && <Button variant="secondary" disabled={busy} onClick={refreshBrandCatalogue}><RefreshCw size={16} />Update catalogue</Button>}
                <p className="muted brand-search-count">{visibleBrandPairs.length} of {workspace.profiles.length} brand pairs</p>
              </div>
              {!visibleBrandPairs.length && <Empty icon={Search} title="No matching brand pairs" text="Try a brand name or generic, or clear your search." />}
              <div className="brand-grid">
                {visibleBrandPairs
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(!!b.favorite) - Number(!!a.favorite) ||
                      a.brand.localeCompare(b.brand),
                  )
                  .map((p) => (
                    <section className="card brand-card" key={p.id}>
                      <div className="brand-card-top">
                        <span className="brand-avatar">
                          <FlaskConical size={23} />
                        </span>
                        <button
                          className={`icon-button ${p.favorite ? "favorited" : ""}`}
                          aria-label={`${p.favorite ? "Unfavorite" : "Favorite"} ${p.brand}`}
                          onClick={() =>
                            update({
                              ...workspace,
                              profiles: workspace.profiles.map((o) =>
                                o.id === p.id
                                  ? { ...o, favorite: !o.favorite }
                                  : o,
                              ),
                            })
                          }
                        >
                          <Star
                            size={17}
                            fill={p.favorite ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      <h2>{p.brand}</h2>
                      <p>{p.generic}</p>
                      <div className="form-tags">
                        {p.forms.map((f) => (
                          <span key={f}>{f}</span>
                        ))}
                        {!p.forms.length && <span>All forms</span>}
                      </div>
                      <div className="brand-card-footer">
                        {isAdmin && <button className="text-link danger" disabled={busy} aria-label={`Delete brand pair ${p.brand} ${p.generic}`} onClick={() => setDeleteBrand(p)}><Trash2 size={14} />Delete</button>}
                        <button
                          className="text-link"
                          onClick={() => {
                            setProfileId(p.id);
                            setPage("generate");
                          }}
                        >
                          Generate emails
                          <ArrowRight size={14} />
                        </button>
                        <button
                          className="text-link"
                          onClick={() => setBrandEdit({ ...p })}
                        >
                          Edit
                        </button>
                      </div>
                    </section>
                  ))}
              </div>
            </>
          )}
          {page === "history" && (
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>Prepared batches</h2>
                </div>
                <span className="count-badge">{workspace.batches.length}</span>
              </div>
              {workspace.batches.length ? (
                <div className="batch-list">
                  {workspace.batches.map((b) => (
                    <div className="batch-row" key={b.id}>
                      <div className="file-icon">
                        <Mail size={21} />
                      </div>
                      <div className="source-info">
                        <strong>
                          {b.brand} · {b.generic}
                        </strong>
                        <small>
                          {reportingPeriod(b.month, b.endMonth || b.month, b.period)} · {b.mails.length} regional
                          emails ·{" "}
                          {new Date(b.createdAt).toLocaleString("en-GB")}
                        </small>
                        <small>
                          {b.mails.filter((m) => m.status === "Opened").length}{" "}
                          opened ·{" "}
                          {b.mails.filter((m) => m.status === "Failed").length}{" "}
                          failed ·{" "}
                          {
                            b.mails.filter((m) => m.status === "Prepared")
                              .length
                          }{" "}
                          prepared
                        </small>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => downloadEmlBatch(b)}
                        aria-label={`Download ${b.brand} ${b.month} .eml ZIP`}
                      >
                        <Download size={15} />
                        .eml ZIP
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={excelDownloading}
                        onClick={() => downloadExcelBatch(b)}
                        aria-label={`Download ${b.brand} ${b.month} Outlook Excel`}
                      >
                        <FileSpreadsheet size={15} />
                        Outlook Excel
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setBatchModal(b)}
                      >
                        View batch
                        <ArrowRight size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={History}
                  title="Your batch history lives here"
                  text="Generate your first regional update to keep a frozen record of its recipients, market definition and email content."
                  action={
                    <Button onClick={() => setPage("generate")}>
                      Generate emails
                      <ArrowRight size={16} />
                    </Button>
                  }
                />
              )}
            </section>
          )}
          {page === "settings" && (
            <div className="settings-layout">
              <section className="card settings-card">
                <div className="card-header">
                  <div>
                    <h2>Your email defaults</h2>
                  </div>
                </div>
                <div className="settings-body">
                  <h3>Sender signature</h3>
                  <div className="form-grid">
                    <Field label="Your name">
                      <input
                        value={settingsDraft.name}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            name: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        type="email"
                        value={settingsDraft.email}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            email: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Designation">
                      <input
                        value={settingsDraft.title}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            title: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Phone extension">
                      <input
                        inputMode="numeric"
                        value={settingsDraft.extension || ""}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, extension: e.target.value })}
                      />
                    </Field>
                    <Field label="Mobile numbers">
                      <input
                        type="tel"
                        placeholder="Include country code; separate numbers with a comma"
                        value={settingsDraft.mobile || ""}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, mobile: e.target.value })}
                      />
                    </Field>
                  </div>
                  <h3>Signature preview</h3>
                  <div className="signature-preview" dangerouslySetInnerHTML={{ __html: emailSignature(settingsDraft) }} />
                  <hr />
                  <h3>Your team and boss in CC</h3>
                  <ContactsEditor
                    value={settingsDraft.personalCc}
                    onChange={(personalCc) =>
                      setSettingsDraft({ ...settingsDraft, personalCc })
                    }
                  />
                  <hr />
                  {(isAdmin || mode !== "cloud") && <h3>Team default email wording</h3>}
                  {isAdmin ? <>
                    <EmailTemplateEditor value={emailTemplateFor(settingsDraft)} onChange={emailTemplate => setSettingsDraft({ ...settingsDraft, emailTemplate })} />
                    <label className="sheet-choice"><input type="checkbox" checked={publishDefault} onChange={e => setPublishDefault(e.target.checked)} />Make this the default for all users</label>
                    <Button variant="secondary" disabled={busy || !publishDefault || !!templateError(emailTemplateFor(settingsDraft))} onClick={async () => {
                      setBusy(true);
                      try {
                        const shared = emailTemplateFor(settingsDraft);
                        await cloudPublishEmailTemplate(shared);
                        const next = { ...workspaceRef.current, sharedEmailTemplate: shared, settings: { ...workspaceRef.current.settings, emailTemplate: shared } };
                        workspaceRef.current = next; setWorkspace(next); setEmailTemplate(shared); setPublishDefault(false);
                        notify("Team email default published. It applies when users refresh their workspace.");
                      } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
                    }}>Publish team default</Button>
                  </> : mode === "cloud" ? null :
                    <EmailTemplateEditor value={emailTemplateFor(settingsDraft)} onChange={emailTemplate => setSettingsDraft({ ...settingsDraft, emailTemplate })} />}
                  <div className="settings-footer">
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        const wordingError = templateError(emailTemplateFor(settingsDraft));
                        if (wordingError) { notify(wordingError, true); return; }
                        if (
                          !settingsDraft.name.trim() ||
                          !emailValid(settingsDraft.email) ||
                          settingsDraft.personalCc.some(
                            (c) => !emailValid(c.email),
                          )
                        ) {
                          notify(
                            "Enter your name and check your sender and CC email addresses.",
                            true,
                          );
                          return;
                        }
                        if (
                          await update({
                            ...workspace,
                            settings: { ...settingsDraft, ...(mode === "cloud" ? { emailTemplate: workspace.settings.emailTemplate } : {}) },
                          })
                        )
                          notify(mode === "demo" ? "Sample defaults updated for this session" : "Your defaults are saved");
                      }}
                    >
                      <Check size={16} />
                      Save my defaults
                    </Button>
                  </div>
                </div>
              </section>
              <div>
                <section className="card small-card connection-card"><div className="connection-icon"><Smartphone size={24} /></div><h3>Android mail</h3><p>Open individual emails from a prepared batch. Copy the body, open Outlook, then paste and send.</p></section>
                <section className="card small-card">
                  <div className="connection-icon">
                    <Monitor size={24} />
                  </div>
                  <h3>Classic Outlook companion</h3>

                  <span
                    className={`badge ${bridgeConnected ? "success" : "neutral"}`}
                  >
                    {bridgeConnected ? "Connected on this PC" : "Not connected"}
                  </span>
                  <div className="bridge-actions">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          download(
                            (await bridgePackage()) as unknown as BlobPart,
                            "rx-mail-outlook-companion.zip",
                          );
                          notify(
                            "Extract the ZIP and run Start-Bridge.cmd on this Windows PC. Then test the connection.",
                          );
                        } catch (e) {
                          notify((e as Error).message, true);
                        }
                      }}
                    >
                      <Download size={15} />
                      Download companion
                    </Button>
                    <Button
                      variant="text"
                      onClick={async () => {
                        try {
                          await checkBridge();
                          setBridgeConnected(true);
                          notify("Classic Outlook companion connected");
                        } catch (e) {
                          setBridgeConnected(false);
                          notify((e as Error).message, true);
                        }
                      }}
                    >
                      Test connection
                    </Button>
                  </div>
                  <label className="sheet-choice">
                    <input
                      type="checkbox"
                      checked={bridgeAuto}
                      onChange={(e) => {
                        setBridgeAuto(e.target.checked);
                        localStorage.setItem(
                          "rxm-bridge-auto-v2",
                          String(e.target.checked),
                        );
                      }}
                    />
                    Also open automatically after generation
                  </label>

                </section>
                <section className="card small-card connection-card">
                  <div className="connection-icon">
                    <Cloud size={24} />
                  </div>
                  <h3>SBM cloud workspace</h3>
                  {!cloudConfigured && <p>Cloud connection is not configured yet.</p>}
                  <Button variant="secondary" onClick={openCloud}>
                    {mode === "cloud" ? (
                      <RefreshCw size={15} />
                    ) : (
                      <Cloud size={15} />
                    )}{" "}
                    {mode === "cloud"
                      ? "Refresh cloud workspace"
                      : "Connect to cloud"}
                  </Button>

                  <Button
                    variant="text"
                    onClick={async () => {
                      if (mode !== "local" || !workspace.datasets.length) {
                        notify(
                          "Open your device workspace with imported data first.",
                          true,
                        );
                        return;
                      }
                      if (!supabase || !userEmail) {
                        notify(
                          "Sign in to your cloud account before importing device data.",
                          true,
                        );
                        setLogin(true);
                        return;
                      }
                      setBusy(true);
                      setBusyText("Copying device workspace to cloud");
                      try {
                        const existing = await cloudLoad();
                        const next = {
                          ...existing,
                          datasets: [
                            ...existing.datasets,
                            ...workspace.datasets.filter(
                              (d) =>
                                !existing.datasets.some(
                                  (o) => o.hash === d.hash,
                                ),
                            ),
                          ],
                          hierarchies: [
                            ...existing.hierarchies,
                            ...(account?.role === "owner" ? workspace.hierarchies : []).filter(
                              (h) =>
                                !existing.hierarchies.some(
                                  (o) => o.id === h.id,
                                ),
                            ),
                          ],
                          profiles: appendBrandPairs(existing.profiles, workspace.profiles, existing.deletedBrandPairs),
                          settings: { ...workspace.settings, emailTemplate: existing.settings.emailTemplate },
                          batches: [
                            ...workspace.batches,
                            ...existing.batches.filter(
                              (b) =>
                                !workspace.batches.some((o) => o.id === b.id),
                            ),
                          ],
                        };
                        const catalogue = await cloudSave(next, existing, setBusyText);
                        setWorkspace(catalogue ? { ...next, ...catalogue } : next);
                        setMode("cloud");
                        notify("Device workspace copied to cloud");
                      } catch (e) {
                        notify((e as Error).message, true);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Copy device workspace to cloud
                  </Button>
                  <Button variant="text" onClick={switchLocal}>
                    <Monitor size={15} />
                    Open device workspace
                  </Button>
                </section>
              </div>
            </div>
          )}
          {page === "users" && mode === "cloud" && account?.role === "owner" && <UsersPage admin={account} notify={notify} onAccountChange={setAccount} />}
        </main>
        <nav className="mobile-bottom">
          {nav
            .filter((n) =>
              ["generate", "sources", "hierarchy", "settings"].includes(n.id),
            )
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? "active" : ""}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={20} />
                <span>
                  {n.id === "generate"
                    ? "Generate"
                    : n.id === "sources"
                      ? "Sources"
                      : n.id === "hierarchy"
                        ? "Hierarchy"
                        : "Settings"}
                </span>
              </button>
            ))}
        </nav>
      </div>
      <input
        hidden
        ref={sourceInput}
        type="file"
        accept=".xlsx"
        onChange={(e) => selectFile(e.target.files?.[0], "source")}
      />
      <input
        hidden
        ref={hierarchyInput}
        type="file"
        accept=".xlsx,.csv"
        onChange={(e) => selectFile(e.target.files?.[0], "hierarchy")}
      />
      <input
        hidden
        ref={resultInput}
        type="file"
        accept=".json"
        onChange={(e) => importResults(e.target.files?.[0])}
      />
      {toast && (
        <div role="status" className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <LoaderCircle className="spin" size={27} />
            <h3>{busyText || "Working…"}</h3>
            <div className="progress-track">
              <span style={{ width: (progress || 12) + "%" }} />
            </div>
            <p>Keep this tab open while the operation completes.</p>
          </div>
        </div>
      )}
      {preview && (
        <Modal title={preview.mail ? "Email preview" : preview.title} wide onClose={() => setPreview(null)}>
          {preview.mail && <div className="preview-envelope"><div><strong>To</strong><span>{preview.mail.to.email}</span><small>CC {preview.mail.cc.map(c => c.email).join("; ") || "None"}</small><small className="preview-subject">Subject: {preview.mail.subject}</small></div><div className="preview-view" role="group" aria-label="Email table view"><button aria-pressed={compactPreview} className={compactPreview ? "active" : ""} onClick={() => setCompactPreview(true)}>Compact</button><button aria-pressed={!compactPreview} className={!compactPreview ? "active" : ""} onClick={() => setCompactPreview(false)}>Full table</button></div></div>}
          <iframe
            className="email-preview"
            title="Email preview"
            sandbox=""
            srcDoc={compactPreview && preview.mail ? preview.html.replace(/<body(?=[ >])/, '<body class="rx-compact"') : preview.html}
          />
          <div className="modal-footer">
            {preview.mail && preview.sender && (
              <Button variant="secondary" onClick={() => {
                setAndroidQueue({ batch: { id: preview.mail!.id, mails: [preview.mail!], settings: preview.sender! } });
                setPreview(null);
              }}><Smartphone size={16} />Android mail</Button>
            )}
            {preview.mail && preview.sender && (
              <Button onClick={() => downloadEml(preview.mail!, preview.sender!, preview.createdAt)}>
                <Download size={16} />
                Download .eml
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                download(preview.html, "regional-email.html", "text/html")
              }
            >
              <Download size={16} />
              Download HTML
            </Button>
            <Button onClick={() => setPreview(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {sourcePicker && (
        <Modal
          title="Choose your MRW source sheets"
          onClose={() => setSourcePicker(null)}
        >
          <div className="modal-body">
            <p className="muted">
              {sourcePicker.file.name} ·{" "}
              {(sourcePicker.file.size / 1048576).toFixed(1)} MB
            </p>
            <div className="notice">
              <AlertCircle size={17} />
              <span>
                The main TRD sheet is selected. Include other sheets only when
                they contain additional records, to prevent duplicate counts.
              </span>
            </div>
            {sourcePicker.sheets.map((s) => (
              <label className="sheet-choice" key={s.path}>
                <input
                  type="checkbox"
                  checked={sourcePicker.selected.includes(s.path)}
                  onChange={(e) =>
                    setSourcePicker({
                      ...sourcePicker,
                      selected: e.target.checked
                        ? [...sourcePicker.selected, s.path]
                        : sourcePicker.selected.filter((p) => p !== s.path),
                    })
                  }
                />
                <FileSpreadsheet size={18} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setSourcePicker(null)}>
              Cancel
            </Button>
            <Button
              disabled={!sourcePicker.selected.length}
              onClick={processSource}
            >
              Process workbook
              <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {pendingSource && (
        <Modal
          title="Review your source import"
          onClose={() => {
            setPendingSource(null); pendingImport.current = null;
            if (pendingStaged.current?.stagedImportId) void clearStagedImport(pendingStaged.current.stagedImportId).catch(() => {});
            pendingStaged.current = null;
          }}
        >
          <div className="modal-body">
            <div className="success-symbol">
              <CheckCircle2 size={28} />
            </div>
            <h3>{pendingSource.name}</h3>
            <div className="review-stats">
              <div>
                <strong>{num(pendingSource.rows)}</strong>
                <small>Recorded occurrences</small>
              </div>
              <div>
                <strong>{pendingSource.catalog.length}</strong>
                <small>Beximco brand pairs</small>
              </div>
            </div>
            <p>
              {formatDate(pendingSource.from)} — {formatDate(pendingSource.to)}
            </p>
            <p className="muted">
              Raw Excel stays on your device. Select the generic markets to
              retain. All competitor brands within those markets are included;
              the full Beximco catalogue remains available.
            </p>
            <div className="scope-heading">
              <strong>{importMarkets.size} markets selected</strong>
              <button
                className="text-link"
                onClick={() =>
                  setImportMarkets(
                    new Set(datasetGenericNames(pendingSource)),
                  )
                }
              >
                Select all
              </button>
              <button
                className="text-link"
                onClick={() => setImportMarkets(new Set())}
              >
                Clear
              </button>
            </div>
            <div className="scope-list">
              {datasetGenericNames(pendingSource)
                .sort()
                .map((g) => (
                  <label className="sheet-choice" key={g}>
                    <input
                      type="checkbox"
                      checked={importMarkets.has(g)}
                      onChange={(e) => {
                        const next = new Set(importMarkets);
                        e.target.checked ? next.add(g) : next.delete(g);
                        setImportMarkets(next);
                      }}
                    />
                    {g}
                  </label>
                ))}
            </div>
            <p className="tiny">
              {mode === "cloud" ? "All generic markets are selected by default. Uncheck any you do not want to save." : "Select the markets to keep on this device, or use Select all."} A replacement import keeps the old version
              active until the new data finishes saving.
            </p>
            {workspace.datasets.filter(
              (d) => d.active && overlaps(d, pendingSource),
            ).length > 0 && (
              <div className="notice warning">
                <AlertCircle size={18} />
                <span>
                  This overlaps{" "}
                  {workspace.datasets
                    .filter((d) => d.active && overlaps(d, pendingSource))
                    .map((d) => d.name)
                    .join(", ")}
                  . Importing will archive those versions and use this file for
                  those dates.
                </span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => {
              setPendingSource(null); pendingImport.current = null;
              if (pendingStaged.current?.stagedImportId) void clearStagedImport(pendingStaged.current.stagedImportId).catch(() => {});
              pendingStaged.current = null;
            }}>
              Cancel
            </Button>
            <Button onClick={() => commitSource(true)}>
              Confirm import
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {deleteBrand && isAdmin && <Modal title="Delete brand pair?" onClose={() => !busy && setDeleteBrand(null)}>
        <div className="modal-body"><p>Delete <strong>{deleteBrand.brand} · {deleteBrand.generic}</strong> from the Brand Library?</p><p className="muted">Future imports will not add this pair again. Source data and saved email batches stay available.</p></div>
        <div className="modal-footer"><Button variant="secondary" disabled={busy} onClick={() => setDeleteBrand(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={async () => {
          if (!isAdmin) return;
          setBusy(true); setBusyText("Deleting brand pair");
          try {
            const catalogue = await cloudDeleteBrandPair(deleteBrand.id);
            const next = { ...workspaceRef.current, ...catalogue, profiles: reconcileBrandPairs(catalogue.profiles, workspaceRef.current.datasets, catalogue.deletedBrandPairs) };
            workspaceRef.current = next; setWorkspace(next); setDeleteBrand(null);
            notify("Brand pair deleted. Saved batches are unchanged.");
          } catch (error) { notify((error as Error).message, true); }
          finally { setBusy(false); }
        }}><Trash2 size={16} />Delete brand pair</Button></div>
      </Modal>}
      {deleteSource && <Modal title="Delete imported source?" onClose={() => !busy && setDeleteSource(null)}>
        <div className="modal-body"><p><strong>{deleteSource.name}</strong></p><p>Delete this import and its {num(deleteSource.rows)} product occurrences from the reporting library? Existing prepared emails and batch history remain available.</p></div>
        <div className="modal-footer"><Button variant="secondary" disabled={busy} onClick={() => setDeleteSource(null)}>Cancel</Button>
          <Button disabled={busy || !isAdmin} onClick={async () => {
            if (!isAdmin) return;
            setBusy(true);
            try {
              await cloudDeleteSource(deleteSource.id);
              const next = { ...workspaceRef.current, datasets: workspaceRef.current.datasets.filter(d => d.id !== deleteSource.id) };
              workspaceRef.current = next; setWorkspace(next); setDeleteSource(null); notify("Source deleted. Prepared email history is preserved.");
            } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
          }}><Trash2 size={15} />Delete source</Button></div>
      </Modal>}
      {hierarchyMap && (
        <Modal
          title="Map hierarchy columns"
          wide
          onClose={() => setHierarchyMap(null)}
        >
          <div className="modal-body">
            <p className="muted">
              {hierarchyMap.name} · {hierarchyMap.rows.length - 1} rows. Match
              your Excel columns to the recipient fields.
            </p>
            <div className="mapping-grid">
              {hierarchyColumns.map((c) => (
                <Field label={c} key={c}>
                  <select
                    value={hierarchyMap.mapping[c]}
                    onChange={(e) =>
                      setHierarchyMap({
                        ...hierarchyMap,
                        mapping: {
                          ...hierarchyMap.mapping,
                          [c]: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={-1}>Not mapped</option>
                    {hierarchyMap.rows[0].map((h, i) => (
                      <option value={i} key={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <h3>Additional hierarchy CC</h3>
            <p className="muted">Choose role titles from your file headers or from a title column. Blank contacts are skipped for that region.</p>
            {hierarchyMap.extraCc.map((cc, index) => <div className="mapping-grid custom-cc-mapping" key={index}>
              <Field label={`CC level ${index + 1} title`}><select value={cc.title} onChange={e => setHierarchyMap({ ...hierarchyMap, extraCc: hierarchyMap.extraCc.map((c, i) => i === index ? { ...c, title: e.target.value } : c) })}>
                {[...new Set([cc.title, ...hierarchyMap.rows[0].filter(Boolean)])].map(h => <option key={h}>{h}</option>)}
              </select></Field>
              {([['Title column', 'titleColumn'], ['Name column', 'nameColumn'], ['Email column', 'emailColumn']] as const).map(([label, field]) => <Field key={field} label={`CC level ${index + 1} ${label}`}>
                <select value={cc[field]} onChange={e => setHierarchyMap({ ...hierarchyMap, extraCc: hierarchyMap.extraCc.map((c, i) => i === index ? { ...c, [field]: Number(e.target.value) } : c) })}>
                  <option value={-1}>{field === 'titleColumn' ? 'Use selected title' : 'Not mapped'}</option>
                  {hierarchyMap.rows[0].map((header, i) => <option value={i} key={i}>{header || `Column ${i + 1}`}</option>)}
                </select></Field>)}
              <Button variant="text" onClick={() => setHierarchyMap({ ...hierarchyMap, extraCc: hierarchyMap.extraCc.filter((_, i) => i !== index) })}>Remove CC level</Button>
            </div>)}
            <Button variant="secondary" onClick={() => setHierarchyMap({ ...hierarchyMap, extraCc: [...hierarchyMap.extraCc, { title: hierarchyMap.rows[0].find(Boolean) || 'CC', titleColumn: -1, nameColumn: -1, emailColumn: -1 }] })}><Plus size={15} />Add hierarchy CC level</Button>
            <p className="tiny">
              Required: Structure, Region, RSE Name, RSE Email and Salutation.
              CC name columns are optional.
            </p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setHierarchyMap(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                try {
                  if (
                    [
                      "Structure",
                      "Region",
                      "RSE Name",
                      "RSE Email",
                      "Salutation",
                    ].some((k) => hierarchyMap.mapping[k] < 0)
                  )
                    throw new Error("Map all required hierarchy fields");
                  if (!isAdmin) throw new Error("Admin access required");
                  if (hierarchyMap.extraCc.some(cc => cc.emailColumn < 0)) throw new Error("Map an email column for each additional CC level.");
                  setPendingHierarchy(
                    mapHierarchy(hierarchyMap.rows, hierarchyMap.mapping, hierarchyMap.extraCc),
                  );
                  setHierarchyMap(null);
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}
            >
              Review recipients
              <ArrowRight size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {pendingHierarchy && !editingRow && (
        <Modal
          title="Review hierarchy version"
          wide
          onClose={() => setPendingHierarchy(null)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <Field label="Version name">
                <input
                  value={hierarchyName}
                  onChange={(e) => setHierarchyName(e.target.value)}
                />
              </Field>
              <Field label="Effective from">
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="notice">
              <Network size={17} />
              <span>
                {pendingHierarchy.length} assignments ·{" "}
                {
                  pendingHierarchy.filter(
                    (r) =>
                      !emailValid(r.rseEmail) ||
                      !r.salutation.trim() ||
                      r.cc.some((c) => !emailValid(c.email)),
                  ).length
                }{" "}
                need checks. Saved versions affect future batches only.
              </span>
            </div>
            <div className="table-scroll max-table">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>RSE</th>
                    <th>Greeting</th>
                    <th>CC</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendingHierarchy.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.structure} {r.region}
                      </td>
                      <td>
                        {r.rseName}
                        <small className="subvalue">{r.rseEmail}</small>
                      </td>
                      <td>{r.salutation}</td>
                      <td>{r.cc.length} recipients</td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() =>
                            setEditingRow({ row: structuredClone(r), index: i })
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remove region ${r.region}`}
                          onClick={() =>
                            setPendingHierarchy(
                              pendingHierarchy.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="text"
              onClick={() =>
                setEditingRow({
                  index: -1,
                  row: {
                    structure: "ACD",
                    region: "",
                    rseName: "",
                    rseEmail: "",
                    salutation: "",
                    cc: [],
                    active: true,
                  },
                })
              }
            >
              <Plus size={15} />
              Add region
            </Button>
            <p className="tiny">
              {
                pendingHierarchy.filter(
                  (r) =>
                    !currentHierarchy?.rows.some(
                      (o) => JSON.stringify(o) === JSON.stringify(r),
                    ),
                ).length
              }{" "}
              new or changed assignments compared with current version.
            </p>
          </div>
          <div className="modal-footer">
            <Button
              variant="secondary"
              onClick={() => setPendingHierarchy(null)}
            >
              Cancel
            </Button>
            <Button disabled={!pendingHierarchy.length} onClick={saveHierarchy}>
              Save hierarchy version
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {editingRow && (
        <Modal
          title="Regional RSE and hierarchy"
          onClose={() => setEditingRow(null)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <Field label="Structure">
                <select
                  value={editingRow.row.structure}
                  onChange={(e) =>
                    setEditingRow({
                      ...editingRow,
                      row: {
                        ...editingRow.row,
                        structure: e.target.value as Structure,
                      },
                    })
                  }
                >
                  <option>ACD</option>
                  <option>CCD</option>
                </select>
              </Field>
              <Field label="Region code">
                <input
                  value={editingRow.row.region}
                  onChange={(e) =>
                    setEditingRow({
                      ...editingRow,
                      row: { ...editingRow.row, region: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
            {[
              ["RSE name", "rseName"],
              ["RSE email / To", "rseEmail"],
              ["Salutation (e.g. Sample Bhai)", "salutation"],
            ].map(([label, k]) => (
              <Field label={label} key={k}>
                <input
                  value={
                    editingRow.row[k as "rseName" | "rseEmail" | "salutation"]
                  }
                  onChange={(e) =>
                    setEditingRow({
                      ...editingRow,
                      row: { ...editingRow.row, [k]: e.target.value },
                    })
                  }
                />
              </Field>
            ))}
            <h3>Hierarchy CC</h3>
            <ContactsEditor
              withTitles
              value={editingRow.row.cc}
              onChange={(cc) =>
                setEditingRow({ ...editingRow, row: { ...editingRow.row, cc } })
              }
            />
            <label className="sheet-choice">
              <input
                type="checkbox"
                checked={editingRow.row.active}
                onChange={(e) =>
                  setEditingRow({
                    ...editingRow,
                    row: { ...editingRow.row, active: e.target.checked },
                  })
                }
              />
              Active region
            </label>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setEditingRow(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const row = {
                  ...editingRow.row,
                  region: normalize(editingRow.row.region),
                };
                if (
                  !row.region ||
                  !row.rseName ||
                  !emailValid(row.rseEmail) ||
                  !row.salutation.trim() ||
                  row.cc.some((c) => !emailValid(c.email))
                ) {
                  notify(
                    "Complete the region, RSE, greeting and valid recipient emails.",
                    true,
                  );
                  return;
                }
                if (
                  pendingHierarchy?.some(
                    (r, i) =>
                      i !== editingRow.index &&
                      r.structure === row.structure &&
                      r.region === row.region &&
                      r.active &&
                      row.active,
                  )
                ) {
                  notify("This region already has an active assignment.", true);
                  return;
                }
                setPendingHierarchy(
                  editingRow.index < 0
                    ? [...(pendingHierarchy || []), row]
                    : pendingHierarchy!.map((r, i) =>
                        i === editingRow.index ? row : r,
                      ),
                );
                setEditingRow(null);
              }}
            >
              Save region
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {brandEdit && (
        <Modal
          title="Brand / generic market"
          onClose={() => setBrandEdit(null)}
        >
          <div className="modal-body">
            <Field label="Beximco brand">
              <input
                value={brandEdit.brand}
                onChange={(e) =>
                  setBrandEdit({ ...brandEdit, brand: e.target.value })
                }
              />
            </Field>
            <Field label="Generic (exact MRW spelling)">
              <input
                value={brandEdit.generic}
                onChange={(e) =>
                  setBrandEdit({ ...brandEdit, generic: e.target.value })
                }
              />
            </Field>
            <Field
              label="Dosage forms, separated by commas"
              hint="Leave blank for all forms. NASAL should use NASAL SPRAY only."
            >
              <input
                value={brandEdit.forms.join(", ")}
                onChange={(e) =>
                  setBrandEdit({
                    ...brandEdit,
                    forms: e.target.value.split(",").map((s) => s.trim()),
                  })
                }
              />
            </Field>
            <Field
              label="Explicit generic aliases, separated by |"
              hint="Aliases are matched exactly. No fuzzy medical grouping."
            >
              <input
                value={brandEdit.aliases?.join(" | ") || ""}
                onChange={(e) =>
                  setBrandEdit({
                    ...brandEdit,
                    aliases: e.target.value.split("|").map((s) => s.trim()),
                  })
                }
              />
            </Field>
            <label className="sheet-choice">
              <input
                type="checkbox"
                checked={!!brandEdit.favorite}
                onChange={(e) =>
                  setBrandEdit({ ...brandEdit, favorite: e.target.checked })
                }
              />
              Favorite brand pair
            </label>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setBrandEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!brandEdit.brand.trim() || !brandEdit.generic.trim()) {
                  notify("Enter a brand and generic.", true);
                  return;
                }
                const p = {
                  ...brandEdit,
                  brand: normalize(brandEdit.brand),
                  generic: brandEdit.generic.trim(),
                  forms: brandEdit.forms.map(normalize).filter(Boolean),
                  aliases: brandEdit.aliases?.filter(Boolean),
                };
                if (workspace.deletedBrandPairs?.includes(brandPairKey(p))) { notify("This brand pair was deleted by an admin.", true); return; }
                if (workspace.profiles.some(o => o.id !== p.id && brandPairKey(o) === brandPairKey(p))) { notify("This brand and generic pair already exists. Edit its existing entry.", true); return; }
                const exists = workspace.profiles.some((o) => o.id === p.id);
                if (
                  await update({
                    ...workspace,
                    profiles: exists
                      ? workspace.profiles.map((o) => (o.id === p.id ? p : o))
                      : [...workspace.profiles, p],
                  })
                ) {
                  setBrandEdit(null);
                  notify("Market definition saved");
                }
              }}
            >
              Save market
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {batchModal && !preview && !androidQueue && (
        <Modal
          title={`${batchModal.mails.length} emails prepared`}
          wide
          onClose={() => setBatchModal(null)}
        >
          <div className="modal-body">
            <div className="batch-success">
              <span className="success-symbol">
                <CheckCircle2 size={29} />
              </span>
              <div>
                <h3>
                  {batchModal.brand} · {reportingPeriod(batchModal.month, batchModal.endMonth || batchModal.month, batchModal.period)}
                </h3>

              </div>
            </div>
            <div className="table-scroll max-table">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>To</th>
                    <th>Prescribers</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batchModal.mails.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.structure} {m.region}
                      </td>
                      <td>
                        {m.to.name}
                        <small className="subvalue">{m.to.email}</small>
                      </td>
                      <td>{m.doctorCount}</td>
                      <td>
                        <span
                          className={`badge ${m.status === "Opened" ? "success" : m.status === "Failed" ? "warning" : "neutral"}`}
                        >
                          {m.status}
                        </span>
                        {m.error && (
                          <small className="subvalue">{m.error}</small>
                        )}
                      </td>
                      <td>
                        <button className="icon-button" aria-label={`Android mail for ${m.structure} ${m.region}`} onClick={() => setAndroidQueue({ batch: batchModal, initialMailId: m.id })}>
                          <Smartphone size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Preview ${m.region}`}
                          onClick={() =>
                            setPreview({ title: m.subject, html: m.html, mail: m, sender: batchModal.settings, createdAt: batchModal.createdAt })
                          }
                        >
                          <Eye size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Download ${m.structure} ${m.region} .eml`}
                          onClick={() => downloadEml(m, batchModal.settings, batchModal.createdAt)}
                        >
                          <Download size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny">Review and send manually. Outlook Excel requires Excel for Windows, permitted macros and Classic Outlook.</p>
          </div>
          <div className="modal-footer">
            <Button
              variant="secondary"
              onClick={() => {
                setBatchModal(null);
                setPage("history");
              }}
            >
              View history
            </Button>
            <Button
              variant="secondary"
              disabled={
                busy ||
                mode === "demo" ||
                !batchModal.mails.some((m) => m.status !== "Opened")
              }
              onClick={() => openBatch(batchModal)}
            >
              <Monitor size={16} />
              Open in Outlook
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => androidBatch(batchModal)}>
              <Smartphone size={16} />
              Android mail · Individual emails
            </Button>
            <Button
              variant="secondary"
              disabled={mode === "demo"}
              onClick={() => {
                const pending = {
                  ...batchModal,
                  mails: batchModal.mails.filter((m) => m.status !== "Opened"),
                };
                if (!pending.mails.length) {
                  notify(
                    "All messages were already opened. Create a new batch to open them again.",
                    true,
                  );
                  return;
                }
                download(
                  outlookPackage(pending) as unknown as BlobPart,
                  `rx-mail-${batchModal.brand}-${batchModal.month}.zip`,
                );
                notify(
                  "Launcher downloaded. Opening results will be recorded after you run it.",
                );
              }}
            >
              <Download size={17} />
              Download Outlook launcher
            </Button>
            <Button onClick={() => downloadEmlBatch(batchModal)}>
              <Download size={17} />
              Download .eml ZIP
            </Button>
            <Button variant="secondary" disabled={excelDownloading} onClick={() => downloadExcelBatch(batchModal)}>
              <FileSpreadsheet size={17} />
              {excelDownloading ? "Preparing Excel…" : "Download Outlook Excel (.xlsm)"}
            </Button>
          </div>
        </Modal>
      )}
      {androidQueue && !preview && <Modal title="Android mail · Individual emails" wide onClose={() => setAndroidQueue(null)}>
        <div className="modal-body"><AndroidMailQueue key={androidQueue.batch.id + (androidQueue.initialMailId || "")} batch={androidQueue.batch} initialMailId={androidQueue.initialMailId} sample={mode === "demo"} onPreview={id => {
          const mail = androidQueue.batch.mails.find(mail => mail.id === id);
          if (mail) {
            setAndroidQueue({ ...androidQueue, initialMailId: id });
            setPreview({ title: mail.subject, html: mail.html, mail, sender: { name: androidQueue.batch.settings.name ?? workspace.settings.name, email: androidQueue.batch.settings.email } });
          }
        }} /></div>
      </Modal>}
      {login && (
        <Modal
          title="Connect your SBM workspace"
          onClose={() => { setLogin(false); setPassword(""); }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loginSubmit();
            }}
          >
            <div className="modal-body">
              <div className="notice">
                <ShieldCheck size={18} />
                <span>
                  {cloudConfigured
                    ? "Sign in with the username and password created by your admin. No email confirmation is needed."
                    : "Cloud connection is not configured yet. Device imports, calculations and email preparation remain available."}
                </span>
              </div>
              <Field label="Username">
                <input autoComplete="username" aria-label="Username" value={username} required minLength={2} maxLength={32} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Field label="Password">
                <input
                  autoComplete="current-password"
                  aria-label="Password"
                  type="password"
                  minLength={4}
                  maxLength={128}
                  value={password}
                  required
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => { setLogin(false); setPassword(""); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !cloudConfigured}>
                Sign in
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

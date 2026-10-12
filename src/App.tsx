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
} from "./engine";
import {
  cloudConfigured,
  supabase,
  localLoad,
  localSave,
  cloudLoad,
  cloudHydrate,
  cloudSave,
} from "./storage";
import type { Mode } from "./storage";
import { usernameSignIn, currentAccount, AccountServiceError } from "./auth";
import type { UserAccount } from "./auth";
import UsersPage from "./UsersPage";
import RegionReview from "./RegionReview";
import { download, outlookPackage, mailEml, emlFilename, emlPackage, emlPackageFilename } from "./export";
import { hierarchyColumns, mapHierarchy } from "./excel";
import type { Sheet } from "./excel";
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
const monthLabel = (s: string) =>
  new Date(s + "-01T00:00:00Z").toLocaleDateString("en-GB", {
    month: "long",
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
}: {
  value: Contact[];
  onChange: (v: Contact[]) => void;
}) {
  return (
    <div className="contacts-editor">
      {value.map((c, i) => (
        <div className="contact-edit" key={i}>
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
  const [month, setMonth] = useState("2026-06"),
    [structure, setStructure] = useState<"ACD" | "CCD" | "Both">("ACD"),
    [period, setPeriod] = useState("all"),
    [profileId, setProfileId] = useState("tofen"),
    [dosageForm, setDosageForm] = useState("all"),
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
  const [importMarkets, setImportMarkets] = useState<Set<string>>(new Set());
  const [hierarchyMap, setHierarchyMap] = useState<{
      name: string;
      rows: string[][];
      mapping: Record<string, number>;
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
          if (last) setMonth(last.to.slice(0, 7));
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
    if (!userEmail) { setAccount(null); return; }
    let alive = true;
    currentAccount().then((value) => { if (alive) setAccount(value); })
      .catch(() => { if (alive) setAccount(null); });
    return () => { alive = false; };
  }, [userEmail]);
  useEffect(() => {
    if (page === "users" && (mode !== "cloud" || account?.role !== "owner")) setPage("settings");
  }, [page, mode, account?.role]);
  const profile =
    workspace.profiles.find((p) => p.id === profileId) || workspace.profiles[0];
  const marketProfile = useMemo(() => profile ? {
    ...profile, forms: dosageForm === "all" || !profile.forms.includes(dosageForm) ? profile.forms : [dosageForm],
  } : undefined, [profile, dosageForm]);
  useEffect(() => setDosageForm("all"), [profileId]);
  useEffect(() => {
    if (mode !== "cloud" || !profile) return;
    let alive = true;
    setLoading(true);
    cloudHydrate(workspaceRef.current.datasets, month, profile)
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
    profile?.generic,
    profile?.aliases?.join(","),
    workspace.datasets.map((d) => d.id + ":" + d.active).join(","),
  ]);
  const structureList: Structure[] =
    structure === "Both" ? ["ACD", "CCD"] : [structure];
  const marketSources = workspace.datasets.filter(
    (d) =>
      !d.includedGenerics ||
      d.includedGenerics.some((g) =>
        [profile?.generic, ...(profile?.aliases || [])]
          .map(normalize)
          .includes(normalize(g)),
      ),
  );
  const activeSources = eligibleDatasets(marketSources, month),
    days = coverage(marketSources, month),
    lastDay = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0,
    ).getDate();
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
          )
        : [],
    [workspace.datasets, month, marketProfile, structure, period],
  );
  const national = useMemo(() => marketProfile
    ? nationalRxShare(workspace.datasets, month, marketProfile, period, currentHierarchy?.rows)
    : { total: 0, own: 0, share: null, available: false, reason: "Choose a brand / generic." },
    [workspace.datasets, month, marketProfile, period, currentHierarchy]);
  const queue = useMemo(
    () =>
      regionalQueue(
        reportList,
        activeSources,
        currentHierarchy,
        structure === "Both" ? ["ACD", "CCD"] : [structure],
        profile?.brand || "",
        days.some(
          (date) =>
            period === "all" ||
            (period === "first" && Number(date.slice(8)) <= 10) ||
            (period === "second" &&
              Number(date.slice(8)) >= 11 &&
              Number(date.slice(8)) <= 20) ||
            (period === "third" && Number(date.slice(8)) >= 21),
        ),
        days.filter(
          (date) =>
            period === "all" ||
            (period === "first" && Number(date.slice(8)) <= 10) ||
            (period === "second" &&
              Number(date.slice(8)) >= 11 &&
              Number(date.slice(8)) <= 20) ||
            (period === "third" && Number(date.slice(8)) >= 21),
        ),
      ),
    [
      reportList,
      currentHierarchy,
      structure,
      activeSources.length,
      period,
      month,
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
    try {
      const m = makeMail(report, marketProfile, month + " · " + periodText, currentHierarchy, workspace.settings, national);
      setPreview({ html: m.html, title: m.subject, mail: m, sender: { name: workspace.settings.name, email: workspace.settings.email } });
    } catch (e) { notify((e as Error).message, true); }
  };
  async function update(next: Workspace) {
    initialChoice.current = true;
    setBusy(true);
    setBusyText("Saving workspace");
    try {
      if (mode === "local") await localSave(next);
      if (mode === "cloud")
        await cloudSave(next, workspaceRef.current, setBusyText);
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
      if (last) setMonth(last.to.slice(0, 7));
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
      const initialScope = [
        ...new Set([
          ...starterProfiles.map((p) => p.generic),
          ...workspace.datasets.flatMap((d) => d.includedGenerics || []),
        ]),
      ];
      const d = await runWorker<Dataset>(
        choice.file,
        "source",
        chosenSheets,
        initialScope,
      );
      if (d.invalidRows)
        throw new Error(
          `${num(d.invalidRows)} rows have missing doctor codes, generic names or invalid dates. Correct these rows and re-upload to keep the Rx totals accurate.`,
        );
      setImportMarkets(
        new Set(
          [
            ...starterProfiles.map((p) => p.generic),
            ...workspace.datasets.flatMap((d) => d.includedGenerics || []),
          ].filter((g) =>
            d.catalog.some((p) => normalize(p.generic) === normalize(g)),
          ),
        ),
      );
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
    if (workspace.datasets.some((d) => d.hash === scopeDigest)) {
      notify(
        "This file and market selection were already imported. Use its saved version in Source files.",
        true,
      );
      return;
    }
    let source = pendingSource;
    if (
      scope.some(
        (g) => !source.includedGenerics?.map(normalize).includes(normalize(g)),
      )
    ) {
      if (!pendingImport.current) {
        notify("Select the original workbook again to add markets.", true);
        return;
      }
      setBusy(true);
      setProgress(0);
      try {
        source = await runWorker<Dataset>(
          pendingImport.current.file,
          "source",
          pendingImport.current.sheets,
          scope,
        );
      } catch (e) {
        notify((e as Error).message, true);
        return;
      } finally {
        setBusy(false);
      }
    }
    const d = {
      ...source,
      sourceHash,
      hash: scopeDigest,
      includedGenerics: scope,
      facts: source.facts.filter((f) => importMarkets.has(f.generic)),
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
    const profiles = [...workspace.profiles];
    for (const p of d.catalog) {
      const existing = profiles.find(
        (o) =>
          normalize(o.brand) === normalize(p.brand) &&
          normalize(o.generic) === normalize(p.generic),
      );
      if (!existing) profiles.push(p);
    }
    const next = { ...workspace, datasets: [...datasets, d], profiles };
    if (await update(next)) {
      setPendingSource(null);
      setMonth(d.to.slice(0, 7));
      setPage("generate");
      notify(`${num(d.rows)} product occurrences imported`);
    }
  }
  async function saveHierarchy() {
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
  async function generate() {
    if (!marketProfile) return;
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
          month + " · " + periodText,
          currentHierarchy,
          workspace.settings,
          national,
        ),
      );
      const batch: Batch = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        month,
        period,
        brand: profile.brand,
        generic: profile.generic,
        sourceIds: activeSources.map((d) => d.id),
        hierarchyId: currentHierarchy!.id,
        settings: structuredClone(workspace.settings),
        profile: structuredClone(marketProfile),
        national: structuredClone(national),
        mails,
      };
      if (
        await update({ ...workspace, batches: [batch, ...workspace.batches] })
      ) {
        setBatchModal(batch);
        downloadEmlBatch(batch);
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
    setBusy(true);
    setBusyText("Connecting to Supabase");
    try {
      const signedIn = await usernameSignIn(username, password);
      setAccount(signedIn);
      setPassword("");
      const w = await cloudLoad();
      setWorkspace(w);
      setMode("cloud");
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
  const periodText =
    {
      all: "All available dates",
      first: "1–10",
      second: "11–20",
      third: "21–month end",
    }[period] || "";
  const demo = () => {
    initialChoice.current = true;
    setWorkspace(demoWorkspace());
    setMode("demo");
    setMonth("2026-06");
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
          <div className="side-tip">
            <ShieldCheck size={19} />
            <div>
              <strong>Your review comes first</strong>
              <p>Prepare together. Review and send from Outlook.</p>
            </div>
          </div>
          <button className="user" onClick={() => setPage("settings")}>
            <span className="avatar">{account?.username.slice(0, 2) || "SB"}</span>
            <span>
              <strong>
                {workspace.settings.name || "Set up your profile"}
              </strong>
              <small>SBM · Beximco</small>
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
              className={`mode-pill ${mode === "demo" ? "demo" : ""}`}
              onClick={openCloud}
            >
              {mode === "cloud" ? <Cloud size={14} /> : <Monitor size={14} />}
              <span>
                {mode === "cloud"
                  ? "Cloud connected"
                  : mode === "demo"
                    ? "Sample workspace"
                    : "On this device"}
              </span>
              <span className="status-dot" />
            </button>
            <span className="avatar small">{account?.username.slice(0, 2) || "SB"}</span>
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
              <p className="eyebrow">
                {page === "generate"
                  ? "REGIONAL COMMUNICATION"
                  : "RX MAIL STUDIO"}
              </p>
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
              <p>
                {
                  {
                    generate:
                      "Turn MRW prescription data into clear, personal regional updates.",
                    sources:
                      "Import your MRW workbooks and manage reporting coverage.",
                    hierarchy:
                      "Keep every region connected to the right RSE and hierarchy.",
                    brands:
                      "Define the brand, generic and dosage forms for each market.",
                    history:
                      "Every prepared email keeps its data and recipients as they were.",
                    settings:
                      "Personal recipients, email content and your SBM team.",
                    users: "Create team accounts and control access to your workspace.",
                  }[page]
                }
              </p>
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
                disabled={busy}
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
                  <Field label="Reporting month">
                    <div className="input-icon">
                      <CalendarDays size={17} />
                      <input
                        type="month"
                        value={month}
                        onChange={(e) =>
                          e.target.value && setMonth(e.target.value)
                        }
                        aria-label="Reporting month"
                      />
                    </div>
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
                  <Field label="Dosage form">
                    <select value={dosageForm} onChange={e => setDosageForm(e.target.value)} aria-label="Dosage form">
                      <option value="all">{profile?.forms.join(" + ") || "All forms"}</option>
                      {profile?.forms.map(form => <option key={form} value={form}>{form}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="filter-footer">
                  <span>
                    <span
                      className={`status-dot ${days.length === lastDay ? "" : "amber"}`}
                    />
                    {days.length
                      ? `${days.length} of ${lastDay} days available · ${monthLabel(month)}`
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
              <div className="stats">
                <div className="stat stat-teal"><div className="stat-icon"><Mail size={21} /></div><div><span>Emails ready</span><strong>{num(validQueue.length)}</strong><small>{structure === "Both" ? "ACD + CCD" : structure}</small></div></div>
                <div className="stat stat-blue"><div className="stat-icon"><FlaskConical size={21} /></div><div><span>National {profile?.brand} share</span><strong>{!loading && national.available && national.share !== null ? national.share.toFixed(1) + "%" : "N/A"}</strong><small>Same market and period</small></div></div>
                <div className="stat stat-violet"><div className="stat-icon"><Users size={21} /></div><div><span>Doctor review</span><strong>{national.available ? num(reportList.reduce((n, r) => n + r.doctors.filter(d => belowNational(d, national)).length, 0)) : "—"}</strong><small>Entries below national</small></div></div>
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
                    <p>
                      {profile?.brand} · {profile?.generic} · {periodText}
                    </p>
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
                                disabled={!!q.error}
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
                    {selected.size} selected · .eml ZIP, manual sending
                  </span>
                  <Button
                    disabled={busy || loading || !selected.size}
                    onClick={generate}
                  >
                    <Mail size={17} />
                    Generate {selected.size || ""} emails
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </section>
              <RegionReview report={review?.report} brand={profile?.brand || ""} recipient={review?.row?.rseName} national={national} blocked={review?.error} onPreview={() => review && previewRegional(review.report)} />
              </div>
              <div className="help-line">
                <span>
                  <Monitor size={15} />
                  Generate one ZIP with a separate .eml email for each region.
                </span>
                <button
                  onClick={() =>
                    setPreview({
                      title: "How .eml export works",
                      html: '<body style="font:16px Arial;padding:30px;line-height:1.7"><h2>Regional .eml emails</h2><p>Generate your batch to download one ZIP. Extract it and open the .eml files in Outlook. Each file has its own To, CC, subject, Rx share summary, prescriber table and signature.</p><p>Check one file first: email clients differ in how they open unsent .eml messages. If yours opens a read-only message, use its edit/compose option or the optional Classic Outlook launcher.</p><p>Review and send manually. Downloads never mark emails Opened or Sent. Download the ZIP again or a single .eml from Batch history. Outlook may autosave messages after you open them.</p></body>',
                    })
                  }
                >
                  How it works
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          {page === "sources" && (
            <>
              <div className="upload-grid">
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
                <h2>Bring your MRW workbook</h2>
                <p>
                  Drop an Excel file here, or choose one from your device.
                  <br />
                  Review the detected columns before importing.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => sourceInput.current?.click()}
                >
                  Choose .xlsx file
                  <ArrowRight size={16} />
                </Button>
                <small>
                  Prescription date determines reporting month · ACD and CCD
                  supported
                </small>
              </section>
              <section className="upload-card hierarchy-upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void selectFile(e.dataTransfer.files[0], "hierarchy"); }}>
                <div className="upload-symbol"><Network size={31} /></div><h2>Quarterly hierarchy</h2><p>Upload the latest regional recipients.<br />Review RSE and PSL routing, then set the effective date.</p><Button variant="secondary" disabled={busy} onClick={() => hierarchyInput.current?.click()}>Choose hierarchy file <ArrowRight size={16} /></Button><small>Excel or CSV · Versioned by effective date</small>
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
                    <p>
                      Overlapping reporting dates are replaced explicitly to
                      avoid double counting.
                    </p>
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
              <div className="info-grid">
                <div className="card small-card">
                  <span className="label">CURRENT VERSION</span>
                  <h3>{currentHierarchy?.name || "Not configured"}</h3>
                  <p>
                    {currentHierarchy
                      ? `Effective ${formatDate(currentHierarchy.effectiveFrom)} · ${currentHierarchy.rows.filter((r) => r.active).length} active region assignments`
                      : "Upload your quarterly hierarchy or add regions manually."}
                  </p>
                </div>
                <div className="card small-card">
                  <span className="label">QUARTERLY CHANGES</span>
                  <h3>History stays intact</h3>
                  <p>
                    Every new version has an effective date. Prepared batches
                    keep their original recipients.
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
                    <p>
                      To: regional RSE · CC: hierarchy + your saved personal
                      recipients
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
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
                                  {c.email}
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
                      <Button onClick={() => hierarchyInput.current?.click()}>
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
                          onClick={() => {
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
              <div className="notice">
                <FlaskConical size={17} />
                <span>
                  Brand pairs are discovered from Beximco rows in your MRW
                  files. Review dosage forms before generating emails.
                </span>
              </div>
              <div className="brand-grid">
                {workspace.profiles
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
                  <p>
                    Opening status comes from your Outlook launcher results,
                    never from a download.
                  </p>
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
                          {monthLabel(b.month)} · {b.mails.length} regional
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
                    <p>
                      Saved personally for each user in the cloud workspace.
                    </p>
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
                    <Field label="Company">
                      <input
                        value={settingsDraft.company}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            company: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Office address">
                    <input
                      value={settingsDraft.address}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          address: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <hr />
                  <h3>Your team and boss in CC</h3>
                  <p className="muted">
                    These recipients are added to every regional email after
                    hierarchy CC.
                  </p>
                  <ContactsEditor
                    value={settingsDraft.personalCc}
                    onChange={(personalCc) =>
                      setSettingsDraft({ ...settingsDraft, personalCc })
                    }
                  />
                  <hr />
                  <h3>Email wording</h3>
                  <Field label="Opening message">
                    <textarea
                      rows={3}
                      value={settingsDraft.intro}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          intro: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Closing">
                    <input
                      value={settingsDraft.closing}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          closing: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <div className="settings-footer">
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !emailValid(settingsDraft.email) ||
                          settingsDraft.personalCc.some(
                            (c) => !emailValid(c.email),
                          )
                        ) {
                          notify(
                            "Check your sender and CC email addresses.",
                            true,
                          );
                          return;
                        }
                        if (
                          await update({
                            ...workspace,
                            settings: settingsDraft,
                          })
                        )
                          notify("Your defaults are saved");
                      }}
                    >
                      <Check size={16} />
                      Save my defaults
                    </Button>
                  </div>
                </div>
              </section>
              <div>
                <section className="card small-card">
                  <div className="connection-icon">
                    <Monitor size={24} />
                  </div>
                  <h3>Classic Outlook companion</h3>
                  <p>
                    Optional: open editable messages directly on your Windows PC.
                    The default .eml export works without this companion.
                  </p>
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
                  <p className="tiny">
                    Keep the companion running. Messages open for your review;
                    sending stays manual. If local connections are blocked, use
                    Download .eml ZIP.
                  </p>
                </section>
                <section className="card small-card connection-card">
                  <div className="connection-icon">
                    <Cloud size={24} />
                  </div>
                  <h3>SBM cloud workspace</h3>
                  <p>
                    {mode === "cloud"
                      ? `Signed in as ${account?.username || "your account"}`
                      : cloudConfigured
                        ? "Sign in with your username to share sources and hierarchy with your SBM team."
                        : "Cloud connection is not configured yet."}
                  </p>
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
                  {mode === "cloud" && (
                    <Button
                      variant="text"
                      onClick={async () => {
                        await supabase?.auth.signOut();
                        await switchLocal();
                      }}
                    >
                      <LogOut size={15} />
                      Sign out
                    </Button>
                  )}
                  <p className="tiny">
                    Device data is saved in this browser. It is not
                    automatically uploaded when you sign in.
                  </p>
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
                            ...workspace.hierarchies.filter(
                              (h) =>
                                !existing.hierarchies.some(
                                  (o) => o.id === h.id,
                                ),
                            ),
                          ],
                          profiles: workspace.profiles,
                          settings: workspace.settings,
                          batches: [
                            ...workspace.batches,
                            ...existing.batches.filter(
                              (b) =>
                                !workspace.batches.some((o) => o.id === b.id),
                            ),
                          ],
                        };
                        await cloudSave(next, existing, setBusyText);
                        setWorkspace(next);
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
                {mode === "cloud" && account?.role === "owner" && (
                  <section className="card small-card team-card">
                    <h3>Team accounts</h3>
                    <p>Create usernames and passwords, choose access roles, and reset passwords from the Users page.</p>
                    <Button variant="secondary" onClick={() => setPage("users")}><Users size={16} />Manage users</Button>
                  </section>
                )}
                <section className="card small-card">
                  <h3>Install on your phone</h3>
                  <p>
                    Use your browser’s “Install app” or “Add to Home Screen”
                    menu. The same responsive workspace works on mobile.
                  </p>
                  <span className="badge neutral">
                    <Monitor size={13} />
                    .eml download available on mobile
                  </span>
                </section>
              </div>
            </div>
          )}
          {page === "users" && mode === "cloud" && account?.role === "owner" && <UsersPage admin={account} notify={notify} onAccountChange={setAccount} />}
          <footer className="page-footer">
            <span>Rx Mail Studio</span>
            <span>Built for your SBM workflow</span>
          </footer>
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
          {preview.mail && <div className="preview-envelope"><div><strong>To {preview.mail.to.name}</strong><span>{preview.mail.to.email}</span><small>CC {preview.mail.cc.map(c => c.name || c.email).join(" · ") || "None"}</small></div><div className="preview-view" role="group" aria-label="Email table view"><button aria-pressed={compactPreview} className={compactPreview ? "active" : ""} onClick={() => setCompactPreview(true)}>Compact</button><button aria-pressed={!compactPreview} className={!compactPreview ? "active" : ""} onClick={() => setCompactPreview(false)}>Full table</button></div></div>}
          <iframe
            className="email-preview"
            title="Email preview"
            sandbox=""
            srcDoc={compactPreview && preview.mail ? preview.html.replace(/<body(?=[ >])/, '<body class="rx-compact"') : preview.html}
          />
          <div className="modal-footer">
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
          onClose={() => setPendingSource(null)}
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
                    new Set(pendingSource.catalog.map((p) => p.generic)),
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
              {[...new Set(pendingSource.catalog.map((p) => p.generic))]
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
              Default: your allergy markets. Saving selected markets reduces
              cloud storage. Re-import this file with an expanded selection to
              replace its saved version.
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
            <Button variant="secondary" onClick={() => setPendingSource(null)}>
              Cancel
            </Button>
            <Button onClick={() => commitSource(true)}>
              Confirm import
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
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
                  setPendingHierarchy(
                    mapHierarchy(hierarchyMap.rows, hierarchyMap.mapping),
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
      {batchModal && !preview && (
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
                  {batchModal.brand} · {monthLabel(batchModal.month)}
                </h3>
                <p>
                  Recipients, prescriber tables and regional Rx shares are
                  ready.
                </p>
              </div>
            </div>
            <div className="notice">
              <Monitor size={19} />
              <span>
                Download the .eml ZIP, extract it, and open each email in Outlook.
                Each region has its own To and CC. Review and send manually.
                No companion or PowerShell is needed for .eml files.
              </span>
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
            <p className="tiny">
              Check one .eml first; editable opening depends on your email client.
              Downloading leaves opening status unchanged. Outlook may autosave
              messages after you open them. The Classic Outlook options remain
              available below.
            </p>
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
                mode === "demo" ||
                !batchModal.mails.some((m) => m.status !== "Opened")
              }
              onClick={() => openBatch(batchModal)}
            >
              <Monitor size={16} />
              Open in Outlook
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
          </div>
        </Modal>
      )}
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
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quote in CSV");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

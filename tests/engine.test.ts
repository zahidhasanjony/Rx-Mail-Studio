import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reports,
  makeMail,
  recipientFor,
  coverage,
  overlaps,
  regionalQueue,
  workspaceToday,
  hierarchyFor,
} from "../src/engine";
import {
  defaultSettings as blankSettings,
  starterProfiles,
  settingsForNewUser,
} from "../src/types";
import type { Dataset, Hierarchy, RxFact } from "../src/types";
import { applyResults } from "../src/bridge";
import { outlookPackage } from "../src/export";
import { unzipSync, strFromU8 } from "fflate";
const defaultSettings = {
  ...blankSettings,
  name: "Sample User",
  email: "owner@example.com",
  personalCc: [
    { name: "Boss", email: "boss@example.com" },
    { name: "Team", email: "team@example.com" },
  ],
};
const base: RxFact = {
  date: "2026-06-15",
  generic: "Ketotifen",
  brand: "TOFEN",
  company: "BEXIMCO",
  form: "SYP",
  doctorCode: "D01",
  doctorName: "Same doctor name",
  specialty: "Medicine",
  acdRegion: "D5",
  acdMpe: "D501",
  ccdRegion: "D6",
  ccdMpe: "D601",
  count: 17,
  sourceRow: 2,
  sheet: "TRD",
};
const data = (facts: RxFact[]): Dataset => ({
  id: crypto.randomUUID(),
  name: "test",
  hash: "hash",
  importedAt: "2026-07-01",
  active: true,
  rows: facts.reduce((a, b) => a + b.count, 0),
  invalidRows: 0,
  from: "2026-06-01",
  to: "2026-06-30",
  sheets: ["TRD"],
  facts,
  catalog: [],
});
const hierarchy: Hierarchy = {
  id: "h",
  name: "Quarterly",
  effectiveFrom: "2026-04-01",
  createdAt: "2026-04-01",
  rows: [
    {
      structure: "ACD",
      region: "D5",
      rseName: "Sample RSE",
      rseEmail: "rse@example.com",
      salutation: "Sample Bhai",
      active: true,
      cc: [
        { name: "Hierarchy", email: "manager@example.com" },
        { name: "Duplicate team", email: "boss@example.com" },
      ],
    },
  ],
};
test("own brand is first, top four competitors use the entire generic denominator", () => {
  const counts: { [k: string]: number } = {
    TOFEN: 17,
    FENAT: 37,
    TOTIFEN: 12,
    KETIFEN: 8,
    KETOMAR: 6,
    ALARID: 5,
    PROSMA: 4,
    STAFEN: 4,
    KOFEN: 3,
    ALAFIX: 2,
    KETOF: 1,
    TOTI: 1,
  };
  const r = reports(
    [
      data(
        Object.entries(counts).map(([brand, count]) => ({
          ...base,
          brand,
          count,
        })),
      ),
    ],
    "2026-06",
    starterProfiles[0],
    ["ACD"],
  )[0];
  assert.equal(r.total, 100);
  assert.deepEqual(
    r.shares.map((b) => [b.brand, b.share]),
    [
      ["TOFEN", 17],
      ["FENAT", 37],
      ["TOTIFEN", 12],
      ["KETIFEN", 8],
      ["KETOMAR", 6],
    ],
  );
  assert.equal(r.otherShare, 20);
});
test("doctor codes and MPE define rows; territory uses source RSE, not an MPE prefix", () => {
  const f = [
    base,
    { ...base, doctorCode: "D02", count: 1 },
    { ...base, acdMpe: "D502", count: 1 },
    { ...base, acdRegion: "A1", acdMpe: "D599", count: 1 },
  ];
  const r = reports([data(f)], "2026-06", starterProfiles[0], ["ACD", "CCD"]);
  assert.equal(r.find((r) => r.region === "D5")!.doctors.length, 3);
  assert.equal(r.find((r) => r.region === "D5")!.total, 19);
  assert.equal(r.find((r) => r.region === "A1")!.total, 1);
  assert.equal(r.find((r) => r.structure === "CCD")!.total, 20);
});
test("prescription month, dosage market and ten-day cycle filter before counting", () => {
  const f = [
    base,
    { ...base, date: "2026-06-03", count: 2 },
    { ...base, date: "2026-07-01", count: 3 },
    { ...base, form: "EYE DROP", count: 4 },
  ];
  const r = reports(
    [data(f)],
    "2026-06",
    starterProfiles[0],
    ["ACD"],
    "first",
  )[0];
  assert.equal(r.total, 2);
  const p = starterProfiles.find((p) => p.brand === "NASAL")!;
  assert.equal(
    reports(
      [
        data([
          {
            ...base,
            generic: "Sodium Chloride",
            brand: "NASAL",
            form: "IV INF",
          },
        ]),
      ],
      "2026-06",
      p,
      ["ACD"],
    ).length,
    0,
  );
});
test("missing, duplicate and malformed recipients block generation", () => {
  assert.match(
    recipientFor(undefined, { structure: "ACD", region: "D5" }).error!,
    /Missing/,
  );
  assert.match(
    recipientFor(
      { ...hierarchy, rows: [...hierarchy.rows, ...hierarchy.rows] },
      { structure: "ACD", region: "D5" },
    ).error!,
    /Duplicate/,
  );
  assert.throws(
    () =>
      makeMail(
        reports([data([base])], "2026-06", starterProfiles[0], ["ACD"])[0],
        starterProfiles[0],
        "2026-06",
        { ...hierarchy, rows: [{ ...hierarchy.rows[0], rseEmail: "bad" }] },
        defaultSettings,
      ),
    /Invalid RSE/,
  );
});
test("email escapes source text, preserves To/CC, and deduplicates CC", () => {
  const r = reports(
    [data([{ ...base, doctorName: "Doctor <script>alert(1)</script>" }])],
    "2026-06",
    starterProfiles[0],
    ["ACD"],
  )[0];
  const mail = makeMail(
    r,
    starterProfiles[0],
    "2026-06",
    hierarchy,
    defaultSettings,
  );
  assert.equal(mail.to.email, "rse@example.com");
  assert.deepEqual(
    mail.cc.map((c) => c.email),
    ["boss@example.com", "team@example.com", "manager@example.com"],
  );
  assert.match(mail.html, /Dear Sample Bhai,/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(
    mail.html.indexOf("Regional Rx share") <
      mail.html.indexOf("Prescriber list"),
  );
  assert.equal(mail.status, "Prepared");
});
test("opening status accepts only results for known messages in the same batch", () => {
  const mail = makeMail(
    reports([data([base])], "2026-06", starterProfiles[0], ["ACD"])[0],
    starterProfiles[0],
    "2026-06",
    hierarchy,
    defaultSettings,
  );
  const batch = {
    id: "b",
    createdAt: "",
    month: "2026-06",
    brand: "TOFEN",
    generic: "Ketotifen",
    sourceIds: [],
    hierarchyId: "h",
    settings: defaultSettings,
    profile: starterProfiles[0],
    mails: [mail],
  };
  assert.throws(
    () =>
      applyResults(batch, { schemaVersion: 1, batchId: "wrong", results: [] }),
    /does not belong/,
  );
  assert.throws(
    () =>
      applyResults(batch, {
        schemaVersion: 1,
        batchId: "b",
        results: [{ id: "unknown", status: "Opened" }],
      }),
    /Invalid/,
  );
  assert.equal(
    applyResults(batch, {
      schemaVersion: 1,
      batchId: "b",
      results: [{ id: mail.id, status: "Opened" }],
    }).mails[0].status,
    "Opened",
  );
  const files = unzipSync(outlookPackage(batch));
  const script = strFromU8(files["Open-Outlook.ps1"]);
  assert.match(script, /\.Display\(\$false\)/);
  assert.ok(!/\.Send\(|\.Save\(/.test(script));
  assert.equal(batch.mails[0].status, "Prepared");
});
test("coverage respects actual observed dates and replacement overlap", () => {
  const d = data([base]);
  d.dates = ["2026-06-01", "2026-06-03"];
  assert.deepEqual(coverage([d], "2026-06"), d.dates);
  assert.ok(overlaps(d, { from: "2026-06-10", to: "2026-06-20" }));
  assert.ok(!overlaps(d, { from: "2026-07-01", to: "2026-07-10" }));
});
test("covered zero-Rx regions are distinct from missing coverage and duplicate routing", () => {
  const d = data([]);
  d.regions = { ACD: ["D5", "A1"], CCD: [] };
  const q = regionalQueue([], [d], hierarchy, ["ACD"], "TOFEN", true);
  assert.equal(q.find((r) => r.report.region === "D5")!.error, undefined);
  assert.match(
    q.find((r) => r.report.region === "A1")!.error!,
    /Missing active RSE/,
  );
  const duplicate = regionalQueue(
    [],
    [d],
    { ...hierarchy, rows: [...hierarchy.rows, ...hierarchy.rows] },
    ["ACD"],
    "TOFEN",
    true,
  );
  assert.match(
    duplicate.find((r) => r.report.region === "D5")!.error!,
    /Duplicate/,
  );
  const uncovered = regionalQueue([], [], hierarchy, ["ACD"], "TOFEN", true);
  assert.match(uncovered[0].error!, /No regional source coverage/);
  const mail = makeMail(
    q.find((r) => r.report.region === "D5")!.report,
    starterProfiles[0],
    "2026-06",
    hierarchy,
    defaultSettings,
  );
  assert.match(mail.html, /No Rx records/);
  assert.ok(!mail.html.includes("NaN"));
  d.regionDates = { ACD: { D5: ["2026-06-03"], A1: ["2026-06-21"] }, CCD: {} };
  const late = regionalQueue([], [d], hierarchy, ["ACD"], "TOFEN", true, [
    "2026-06-21",
  ]);
  assert.match(
    late.find((q) => q.report.region === "D5")!.error!,
    /No regional source coverage/,
  );
});
test("quarterly hierarchy activation follows the Bangladesh business date", () => {
  const date = workspaceToday(new Date("2026-09-30T18:01:00Z"));
  assert.equal(date, "2026-10-01");
  const revised = { ...hierarchy, id: "new", effectiveFrom: "2026-10-01" };
  assert.equal(hierarchyFor([hierarchy, revised], date)?.id, "new");
  assert.equal(hierarchyFor([hierarchy, revised], "2026-09-30")?.id, "h");
});

test("each new team user supplies their own signature and personal CC", () => {
  const team = settingsForNewUser("team@example.com");
  assert.equal(team.name, "");
  assert.equal(team.email, "team@example.com");
  assert.deepEqual(team.personalCc, []);
  const owner = settingsForNewUser("owner@example.com");
  assert.equal(owner.name, "");
  assert.equal(owner.email, "owner@example.com");
  assert.deepEqual(owner.personalCc, []);
  owner.personalCc = [];
  assert.deepEqual(blankSettings.personalCc, []);
  const r = reports([data([base])], "2026-06", starterProfiles[0], ["ACD"])[0];
  assert.throws(
    () => makeMail(r, starterProfiles[0], "2026-06", hierarchy, team),
    /Complete your name/,
  );
});

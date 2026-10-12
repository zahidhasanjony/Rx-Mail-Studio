import { emptyWorkspace } from "./types";
import type { RxFact, Workspace } from "./types";
export function demoWorkspace(): Workspace {
  const w = emptyWorkspace();
  w.settings = {
    ...w.settings,
    name: "Sample User",
    title: "Sample Manager",
    company: "Sample Company",
    email: "owner@example.com",
  };
  const facts: RxFact[] = [];
  for (const region of ["D5", "A1", "C3", "F3", "M1", "S2"])
    for (let i = 0; i < 5; i++)
      for (const [brand, count] of [
        ["TOFEN", 17 + i],
        ["FENAT", 37 - i],
        ["TOTIFEN", 12],
        ["KETIFEN", 8],
        ["KETOMAR", 6],
        ["ALARID", 5],
      ] as [string, number][]) {
        facts.push({
          date: `2026-06-${String(i + 1).padStart(2, "0")}`,
          generic: "Ketotifen",
          brand,
          company: brand === "TOFEN" ? "BEXIMCO" : "Sample competitor",
          form: "SYP",
          doctorCode: `DEMO-${region}-${i}`,
          doctorName: `Sample Doctor ${i + 1}`,
          specialty: ["Medicine", "Pediatrics", "Dermatology"][i % 3],
          acdRegion: region,
          acdMpe: region + "0" + i,
          acdAse: region + "00",
          ccdRegion: "D6",
          ccdMpe: "D60" + i,
          ccdAse: "D600",
          count,
          sourceRow: i + 2,
          sheet: "Sample data",
        });
      }
  w.datasets = [
    {
      id: "demo-source",
      name: "Sample workspace · fictional doctors",
      hash: "demo",
      importedAt: "2026-07-01T00:00:00Z",
      active: true,
      rows: facts.reduce((a, b) => a + b.count, 0),
      invalidRows: 0,
      from: "2026-06-01",
      to: "2026-06-30",
      sheets: ["Sample data"],
      facts,
      catalog: w.profiles,
    },
  ];
  w.hierarchies = [
    {
      id: "demo-hierarchy",
      name: "Sample hierarchy",
      effectiveFrom: "2026-04-01",
      createdAt: "2026-04-01T00:00:00Z",
      rows: ["D5", "A1", "C3", "F3", "M1", "S2"].map((region) => ({
        region,
        structure: "ACD",
        rseName: "Sample RSE",
        rseEmail: "sample@example.com",
        salutation: "Sample Bhai",
        cc: [],
        active: true,
      })),
    },
  ];
  return w;
}

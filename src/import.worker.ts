import { inspectWorkbook, importRx, readSheetRows } from "./excel";
self.onmessage = async (e) => {
  const { file, action, sheets, generics } = e.data;
  try {
    const progress = (percent: number, message: string) =>
      self.postMessage({ type: "progress", percent, message });
    const result =
      action === "inspect"
        ? await inspectWorkbook(file, progress)
        : action === "hierarchy"
          ? await readSheetRows(file, sheets[0], progress)
          : await importRx(file, sheets, progress, generics);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: (error as Error).message });
  }
};

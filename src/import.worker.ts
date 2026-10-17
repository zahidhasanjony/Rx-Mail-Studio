import { inspectWorkbook, importRx, readSheetRows } from "./excel";
import { stageFacts, clearStagedImport } from "./import-staging";
import { prepareUpload } from "./upload";
self.onmessage = async (e) => {
  const { file, action, sheets, generics } = e.data;
  try {
    let lastProgress = 0;
    const progress = (percent: number, message: string) => {
      const now = Date.now();
      if (percent === 100 || now - lastProgress >= 150) {
        lastProgress = now;
        self.postMessage({ type: "progress", percent, message });
      }
    };
    if (action === "prepare-upload") {
      const result = await prepareUpload(e.data.dataset, done => progress(0, `Preparing upload batches · ${done.toLocaleString()} records`));
      self.postMessage({ type: "result", result });
      return;
    }
    if (action === "source-staged") {
      const stagedImportId = crypto.randomUUID();
      let sequence = 0, stagedFactCount = 0;
      try {
        const result = await importRx(file, sheets, progress, generics, async facts => {
          sequence = await stageFacts(stagedImportId, sequence, facts);
          stagedFactCount += facts.length;
        });
        self.postMessage({ type: "result", result: { ...result, includedGenerics: generics || result.availableGenerics, stagedImportId, stagedFactCount } });
      } catch (error) {
        await clearStagedImport(stagedImportId).catch(() => {});
        throw error;
      }
      return;
    }
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

import type { UploadProgress } from "./upload";

export function UploadPanel({ name, progress, onPause, onResume, onDiscard, onDismiss }: {
  name: string; progress: UploadProgress; onPause?: () => void; onResume?: () => void; onDiscard?: () => void; onDismiss?: () => void;
}) {
  const running = ["preparing", "uploading", "verifying"].includes(progress.phase);
  const label = { preparing: "Preparing source", uploading: "Uploading source", verifying: "Verifying uploaded data", paused: "Upload paused", failed: "Upload stopped", complete: "Import complete" }[progress.phase];
  return <section className="upload-panel" aria-label="Source import status">
    <div className="upload-panel-heading"><div><strong>{label}</strong><span>{name}</span></div><div className="upload-actions">
      {onPause && progress.phase === "uploading" && <button onClick={onPause}>Pause upload</button>}
      {onResume && !running && progress.phase !== "complete" && <button onClick={onResume}>Resume upload</button>}
      {onDiscard && !running && progress.phase !== "complete" && <button onClick={onDiscard}>Discard upload</button>}
      {onDismiss && progress.phase === "complete" && <button onClick={onDismiss}>Dismiss</button>}
    </div></div>
    <progress aria-label={progress.phase === "preparing" ? "Source preparation" : "Uploaded records"} max={100} value={progress.percent < 0 || (progress.phase === "preparing" && !progress.percent) ? undefined : progress.percent} />
    <p role="status">{progress.total && progress.percent >= 0 ? `${progress.saved.toLocaleString()} / ${progress.total.toLocaleString()} records saved · ${Math.floor(progress.percent)}%` : progress.message || "Reading and preparing the workbook…"}</p>
    {progress.total > 0 && progress.percent >= 0 && progress.message && <p>{progress.message}</p>}
    {progress.phase === "paused" && <p>Your progress is saved. Resume on this device when ready.</p>}
  </section>;
}

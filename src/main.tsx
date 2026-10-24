import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PageReview from "./PageReview";
import { AppErrorBoundary } from "./AppErrorBoundary";
import "./styles.css";
import "./theme.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><div data-review-root><App /></div><PageReview /></AppErrorBoundary>
  </React.StrictMode>,
);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );

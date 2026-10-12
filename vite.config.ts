import { defineConfig } from "vite";
export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022", emptyOutDir: true, modulePreload: { polyfill: false }, rollupOptions: { input: { index: "index.html", outlookAuth: "outlook-auth.html" } } },
  server: { host: "0.0.0.0" },
});

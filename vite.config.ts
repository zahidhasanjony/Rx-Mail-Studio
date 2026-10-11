import { defineConfig } from "vite";
export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022", emptyOutDir: true },
  server: { host: "0.0.0.0" },
});

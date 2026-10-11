import { rmSync } from "node:fs";
// Remove only this project's reproducible build output.
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });

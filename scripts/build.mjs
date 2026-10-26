import { build, context } from "esbuild";
import fs from "node:fs/promises";

const watch = process.argv.includes("--watch");
const common = { bundle: true, sourcemap: true, logLevel: "info", target: "es2022" };

const configs = [
  {
    ...common,
    entryPoints: { main: "src/main/main.ts", "preload-overlay": "src/preload/overlay.ts", "preload-app": "src/preload/app.ts", "preload-listen": "src/preload/listen.ts" },
    outdir: "dist",
    platform: "node",
    format: "cjs",
    external: ["electron", "electron-updater"],
  },
  {
    ...common,
    entryPoints: { overlay: "src/renderer/overlay.ts", app: "src/renderer/app.ts", listen: "src/renderer/listen.ts" },
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
  },
];

await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist/renderer", { recursive: true });
for (const f of ["overlay.html", "overlay.css", "app.html", "app.css", "listen.html", "listen.css"]) {
  await fs.copyFile(`src/renderer/${f}`, `dist/renderer/${f}`);
}

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}

// Builds the web app into web-dist/: the desktop app's page and code, with the
// browser bridge (web/) in place of Electron. Vercel serves web-dist/ and runs
// api/ as functions.
import { execSync } from "node:child_process";
import { build } from "esbuild";
import fs from "node:fs/promises";

const OUT = "web-dist";
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

// A new id per deploy: it names the service worker's cache, so each deploy is an update.
const commit =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (() => {
    try {
      return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  })();
const buildId = `${commit.slice(0, 7) || "dev"}-${Date.now().toString(36)}`;
const version = commit ? `${pkg.version} (${commit.slice(0, 7)})` : pkg.version;

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

await build({
  entryPoints: { web: "web/main.ts" },
  outdir: OUT,
  bundle: true,
  minify: true,
  sourcemap: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: "info",
});

let html = await fs.readFile("src/renderer/app.html", "utf8");
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`build-web: app.html no longer contains ${from}`);
  html = html.replace(from, to);
};
swap(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(html)?.[0] ?? "<meta http-equiv",
  `<meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob: https://*.giphy.com; connect-src 'self'; media-src 'self' blob: https://www.myinstants.com; worker-src 'self'; manifest-src 'self'" />
    <meta name="description" content="Wispr Max: a little AI buddy on your desktop that teaches you how to do the work. It talks first, points at the buttons, and roasts you with memes and slang. Built on Wispr Flow." />
    <meta name="theme-color" content="#faf9f6" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon-192.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />`,
);
swap(`<link rel="stylesheet" href="app.css" />`, `<link rel="stylesheet" href="/app.css" />\n    <link rel="stylesheet" href="/web.css" />`);
swap("<body>", `<body class="web">`);
swap(`<script src="app.js"></script>`, `<script src="/web.js"></script>`);
await fs.writeFile(`${OUT}/index.html`, html);

await fs.copyFile("src/renderer/app.css", `${OUT}/app.css`);
for (const f of ["web.css", "manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
  await fs.copyFile(`web/${f}`, `${OUT}/${f}`);
}
const sw = await fs.readFile("web/sw.js", "utf8");
await fs.writeFile(`${OUT}/sw.js`, sw.replace("__BUILD__", buildId));

console.log(`web-dist ready: version ${version}, build ${buildId}`);

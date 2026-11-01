// Builds the web app into web-dist/: the desktop app's page and code, with the
// browser bridge (web/) in place of Electron. Vercel serves web-dist/ and runs
// api/ as functions.
import { execSync } from "node:child_process";
import { build } from "esbuild";
import fs from "node:fs/promises";
import zlib from "node:zlib";

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
  entryPoints: { web: "web/main.ts", landing: "web/landing.ts" },
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob: https://*.giphy.com; connect-src 'self'; media-src 'self' blob: https://www.myinstants.com; worker-src 'self'; manifest-src 'self'; frame-src https://www.youtube-nocookie.com" />
    <meta name="description" content="Wispr Max: a little AI buddy on your desktop that teaches you how to do the work. Wispr Flow is its ears; Max reads your screen, points at the buttons, and roasts you with memes and slang." />
    <meta name="theme-color" content="#faf9f6" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon-192.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />`,
);
swap(`<link rel="stylesheet" href="app.css" />`, `<link rel="stylesheet" href="/app.css" />\n    <link rel="stylesheet" href="/web.css" />`);
swap("<body>", `<body class="web">`);
swap(`<script src="app.js"></script>`, `<script src="/web.js"></script>`);
// The dashboard lives at /app/; the landing page is the front door.
await fs.mkdir(`${OUT}/app`, { recursive: true });
await fs.writeFile(`${OUT}/app/index.html`, html);
await fs.copyFile("web/landing.html", `${OUT}/index.html`);
await fs.copyFile("web/landing.css", `${OUT}/landing.css`);

await fs.copyFile("src/renderer/app.css", `${OUT}/app.css`);
for (const f of ["web.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "how-it-works.png", "sample-app.png", "sample-mail.png"]) {
  await fs.copyFile(`web/${f}`, `${OUT}/${f}`);
}
const sw = await fs.readFile("web/sw.js", "utf8");
await fs.writeFile(`${OUT}/sw.js`, sw.replace("__BUILD__", buildId));

// The Chrome extension, as a zip people can unzip and "Load unpacked".
await fs.writeFile(`${OUT}/wispr-max-extension.zip`, await zipFolder("extension", "wispr-max-extension"));

/** A plain zip (deflate) of a folder's files, without extra dependencies. */
async function zipFolder(dir, prefix) {
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of (await fs.readdir(dir)).sort()) {
    const data = await fs.readFile(`${dir}/${name}`);
    const packed = zlib.deflateRawSync(data);
    const path = Buffer.from(`${prefix}/${name}`);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(path.length, 26);
    local.push(head, path, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, path);
    offset += head.length + path.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

console.log(`web-dist ready: version ${version}, build ${buildId}`);

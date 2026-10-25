// Renders the app and tray icons from the pixel ghost. Run with: npm run icons
import { createRequire } from "node:module";
import { GHOST_HEIGHT, GHOST_WIDTH, ghostSvg } from "../src/renderer/ghost.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ghost = (eyes: "center" | "right", colors?: Record<string, string>) =>
  ghostSvg({ eyes, colors }).replace("<svg ", `<svg width="100%" height="100%" `);

// App icon: the ghost on the slate background from the mascot sheet, with its
// little shadow dashes underneath.
const appIcon = `
<div style="width:1024px;height:1024px;border-radius:228px;background:linear-gradient(160deg,#7f9ba5,#668590);position:relative;overflow:hidden">
  <div style="position:absolute;left:262px;top:170px;width:${GHOST_WIDTH * 28}px;height:${GHOST_HEIGHT * 28}px">${ghost("center")}</div>
  <div style="position:absolute;left:316px;top:812px;display:flex;gap:28px;align-items:center">
    <i style="width:28px;height:28px;background:#4b6f6c"></i>
    <i style="width:84px;height:28px;background:#4b6f6c"></i>
    <i style="width:168px;height:28px;background:#4b6f6c"></i>
    <i style="width:28px;height:28px;background:#4b6f6c"></i>
  </div>
</div>`;

// Tray: a solid silhouette. macOS tints "Template" images itself.
const silhouette = (color: string) =>
  ghost("center", { O: color, W: color, L: color, M: color })
    .replace(/(<g class="eyes"[^>]*>)(.*?)(<\/g>)/, (_m, a, b, c) => a + b.replaceAll(`fill="${color}"`, 'fill="#fff" class="cut"') + c);

const icons: [string, number, string][] = [
  ["icon.png", 1024, appIcon],
  ["trayTemplate.png", 22, silhouette("#000")],
  ["trayTemplate@2x.png", 44, silhouette("#000")],
  ["tray.png", 32, ghost("center")],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, html] of icons) {
  await page.setViewportSize({ width: size, height: size });
  const scaled = name === "icon.png" ? `<div style="transform:scale(${size / 1024});transform-origin:0 0">${html}</div>` : html;
  await page.setContent(
    `<style>html,body{margin:0;background:transparent;width:${size}px;height:${size}px;display:grid;place-items:center} body>svg{width:${size}px;height:${size}px}</style>${scaled}`,
  );
  if (name.startsWith("trayTemplate")) {
    // Punch the eyes out of the silhouette so they read as holes.
    await page.evaluate(() => document.querySelectorAll(".cut").forEach((r) => r.setAttribute("fill", "transparent")));
  }
  await page.screenshot({ path: `assets/${name}`, omitBackground: true });
  console.log(`wrote assets/${name}`);
}
await browser.close();

// The web app's entry: the browser bridge first (window.wispr), then the same
// app the desktop window runs, then the web-only parts.
import "./web-api";
import "../src/renderer/app";
import "./float-ghost";
import "./demo-mail";
import "piixpal/core";
import "piixpal/c/scout";
import { toast } from "../src/renderer/app";
import { install, installed, onInstallable } from "./pwa";

const installButtons = () => document.querySelectorAll<HTMLButtonElement>("[data-install]");

onInstallable((canInstall) => {
  installButtons().forEach((b) => b.classList.toggle("hidden", !canInstall));
  document.querySelectorAll<HTMLElement>("[data-installed]").forEach((el) => {
    el.textContent = installed() ? "Installed. You're using the app." : canInstall ? "" : "Use your browser's menu to install it (Install app, or Add to Home Screen).";
  });
});

document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-install]")) void install();
});

// ---------- download the desktop app: straight to the right installer ----------

type UAData = { platform?: string; getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string }> };
const uaData = (navigator as { userAgentData?: UAData }).userAgentData;
const platform = (uaData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
const os = /mac|iphone|ipad/.test(platform) ? "mac" : /linux|x11/.test(platform) && !/android/.test(platform) ? "linux" : "win";
const OS_NAME = { win: "Windows", mac: "Mac", linux: "Linux" }[os];
let arch = os === "mac" ? "arm64" : "x64";
void uaData?.getHighEntropyValues?.(["architecture"]).then((v) => {
  if (os === "mac" && v.architecture === "x86") arch = "x64";
});

document.querySelectorAll<HTMLElement>("[data-download-label]").forEach((el) => (el.textContent = `Download for ${OS_NAME}`));
document.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest("[data-download]");
  if (!link) return;
  e.preventDefault();
  void download();
});

async function download() {
  const url = `/api/download?os=${os}&arch=${arch}`;
  // Is there an installer for this computer? (An available one answers with a redirect to the file.)
  const probe = await fetch(`${url}&check=1`, { redirect: "manual" }).catch(() => null);
  if (probe && probe.type !== "opaqueredirect" && !probe.ok) {
    const body = (await probe.json().catch(() => ({}))) as { error?: string };
    return toast(body.error ?? `The ${OS_NAME} installer isn't available right now.`, true);
  }
  // The server answers with the installer itself, so the download starts and this page stays.
  location.href = url;
  toast(`Downloading Wispr Max for ${OS_NAME}…`);
  showInstallHelp();
}

/** The app isn't code-signed yet, so Windows and macOS warn once. Say how to get past it. */
function showInstallHelp() {
  const steps =
    os === "win"
      ? "Your browser may ask if you trust the file: choose <b>Keep</b>. Windows may then say <b>“Windows protected your PC”</b> or <b>“Unknown publisher”</b>: click <b>More info → Run anyway</b>. It's only because the app isn't code-signed yet."
      : os === "mac"
        ? "macOS may say the app is from an unidentified developer: <b>right-click the app → Open → Open</b> the first time. It's only because the app isn't signed yet."
        : "Make the AppImage executable (<b>chmod +x</b>) and run it.";
  document.querySelectorAll<HTMLElement>("[data-download]").forEach((link) => {
    if (link.nextElementSibling?.classList.contains("install-help")) return;
    const help = document.createElement("p");
    help.className = "install-help";
    help.innerHTML = steps;
    link.insertAdjacentElement("afterend", help);
  });
}

const params = new URLSearchParams(location.search);
if (params.get("download") === "unavailable") {
  history.replaceState(null, "", location.pathname);
  toast(`The ${OS_NAME} installer isn't published yet. Check back soon.`, true);
}

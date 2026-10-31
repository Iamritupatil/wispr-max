import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { UpdateState } from "../shared/types";

// Two ways people run Wispr Max, two ways to update:
//  - an installer from GitHub Releases: electron-updater downloads the new
//    version and installs it on restart;
//  - a git clone run with `npm run dev`: pull, reinstall if needed, rebuild,
//    relaunch.

export const REPO = "Iamritupatil/wispr-max";
const ROOT = path.join(__dirname, "..");
const isWin = process.platform === "win32";

let state: UpdateState = { status: "idle", current: app.getVersion(), kind: kindOfInstall() };
const listeners = new Set<(s: UpdateState) => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
  return state;
}

export function onUpdateState(listener: (s: UpdateState) => void) {
  listeners.add(listener);
}

export function updateState() {
  return state;
}

function kindOfInstall(): UpdateState["kind"] {
  if (app.isPackaged) return "release";
  return fs.existsSync(path.join(ROOT, ".git")) ? "source" : "none";
}

function run(cmd: string, args: string[], timeout = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      // npm is a .cmd script on Windows, which needs a shell.
      { cwd: ROOT, timeout, windowsHide: true, shell: isWin, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())),
    );
  });
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (["checking", "downloading", "installing"].includes(state.status)) return state;
  set({ status: "checking", message: undefined });
  try {
    if (state.kind === "release") {
      autoUpdater.autoDownload = false;
      const result = await autoUpdater.checkForUpdates();
      return result?.isUpdateAvailable
        ? set({ status: "available", latest: result.updateInfo.version, message: `Version ${result.updateInfo.version} is ready to download.` })
        : set({ status: "none", message: "You're on the latest version." });
    }

    if (state.kind === "source") {
      const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
      await run("git", ["fetch", "--quiet", "origin", branch], 60_000);
      const behind = Number(await run("git", ["rev-list", "--count", `HEAD..origin/${branch}`]));
      if (!behind) return set({ status: "none", message: "You're on the latest version." });
      const latest = await run("git", ["log", "-1", "--format=%s", `origin/${branch}`]);
      return set({
        status: "available",
        latest,
        message: `${behind} update${behind === 1 ? "" : "s"} available. Latest: “${latest}”`,
      });
    }

    return set({ status: "none", message: `Get new versions from github.com/${REPO}/releases.` });
  } catch (err) {
    return set({ status: "error", message: `Couldn't check for updates: ${(err as Error).message.split("\n")[0]}` });
  }
}

/**
 * Installed apps update themselves: a new release downloads quietly in the
 * background and is installed the next time Wispr Max quits or restarts.
 */
export async function updateQuietly() {
  if (state.kind !== "release") return void checkForUpdates();
  const checked = await checkForUpdates();
  if (checked.status !== "available") return;
  try {
    autoUpdater.autoInstallOnAppQuit = true;
    set({ status: "downloading", message: `Getting version ${checked.latest} in the background…` });
    await autoUpdater.downloadUpdate();
    set({ status: "none", message: `Version ${checked.latest} is ready. It installs the next time Wispr Max restarts.` });
  } catch (err) {
    set({ status: "error", message: `Couldn't download the update: ${(err as Error).message.split("\n")[0]}` });
  }
}

export async function installUpdate(): Promise<UpdateState> {
  if (state.status !== "available") return state;
  try {
    if (state.kind === "release") {
      set({ status: "downloading", message: "Downloading…" });
      autoUpdater.on("download-progress", (p) => set({ message: `Downloading… ${Math.round(p.percent)}%` }));
      await autoUpdater.downloadUpdate();
      set({ status: "installing", message: "Restarting to finish the update…" });
      setTimeout(() => autoUpdater.quitAndInstall(), 800);
      return state;
    }

    // From source: fast-forward only, so local edits are never overwritten.
    set({ status: "downloading", message: "Getting the latest code…" });
    const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
    const before = await run("git", ["rev-parse", "HEAD"]);
    try {
      await run("git", ["pull", "--ff-only", "origin", branch], 120_000);
    } catch (err) {
      return set({
        status: "error",
        message: `Couldn't update automatically because this folder has its own changes. Run "git pull" in it yourself. (${(err as Error).message.split("\n")[0]})`,
      });
    }
    const changed = await run("git", ["diff", "--name-only", before, "HEAD"]);
    if (/^package(-lock)?\.json$/m.test(changed)) {
      set({ message: "Installing new packages…" });
      await run("npm", ["install", "--no-audit", "--no-fund"]);
    }
    set({ status: "installing", message: "Rebuilding…" });
    await run("npm", ["run", "build"]);
    set({ message: "Restarting…" });
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 600);
    return state;
  } catch (err) {
    return set({ status: "error", message: `Update failed: ${(err as Error).message.split("\n")[0]}` });
  }
}

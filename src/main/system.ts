import { ClipboardItem, clipboard, desktopCapturer, screen, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import type { FocusContext, Screenshot } from "../shared/types";

/** Small enough to upload and read fast, big enough to read a chat. */
const SCREENSHOT_EDGE = 1280;

/**
 * The screen the user is working on, so Max can read the conversation they're
 * in. Sent only with the request it belongs to; never stored.
 */
export async function captureScreen(): Promise<Screenshot | undefined> {
  try {
    if (process.platform === "darwin") {
      const access = systemPreferences.getMediaAccessStatus("screen");
      if (access === "denied" || access === "restricted") return undefined;
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width, height } = display.size;
    const scale = Math.min(1, SCREENSHOT_EDGE / Math.max(width, height));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return undefined;
    return { data: source.thumbnail.toJPEG(65).toString("base64"), mediaType: "image/jpeg" };
  } catch {
    return undefined; // No permission or no capture support: Max still works without it.
  }
}

// OS integration without native modules: everything shells out to tools that
// ship with the OS (osascript, PowerShell) or are one package away (xdotool).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.toString().trim()),
    );
  });
}

/** Sends Cmd/Ctrl + key to the focused app: natively and instantly, with the OS tools as a fallback. */
async function chord(key: "c" | "v" | "z") {
  try {
    const { uIOhook, UiohookKey } = await import("uiohook-napi");
    const code = { c: UiohookKey.C, v: UiohookKey.V, z: UiohookKey.Z }[key];
    uIOhook.keyTap(code, [process.platform === "darwin" ? UiohookKey.Meta : UiohookKey.Ctrl]);
    await sleep(30);
    return;
  } catch {
    await osChord(key);
  }
}

async function osChord(key: "c" | "v" | "z") {
  switch (process.platform) {
    case "darwin":
      await run("osascript", [
        "-e",
        `tell application "System Events" to keystroke "${key}" using command down`,
      ]);
      return;
    case "win32":
      await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(New-Object -ComObject WScript.Shell).SendKeys('^${key}')`,
      ]);
      return;
    default:
      try {
        await run("xdotool", ["key", "--clearmodifiers", `ctrl+${key}`]);
      } catch {
        await run("wtype", ["-M", "ctrl", key, "-m", "ctrl"]); // Wayland
      }
  }
}

type ClipboardSnapshot = ClipboardItem[];

/** Copies every format on the clipboard (text, rich text, images…) so it can be put back. */
async function snapshot(): Promise<ClipboardSnapshot> {
  try {
    const items = await clipboard.read();
    return await Promise.all(
      items.map(async (item) => {
        const entries = await Promise.all(
          item.types.map(async (type) => [type, await item.getType(type).catch(() => null)] as const),
        );
        return new ClipboardItem(
          Object.fromEntries(entries.filter(([, v]) => v !== null)) as ConstructorParameters<typeof ClipboardItem>[0],
        );
      }),
    );
  } catch {
    return [];
  }
}

async function restore(s: ClipboardSnapshot) {
  try {
    if (s.length) await clipboard.write(s);
    else clipboard.clear();
  } catch {
    // Losing the user's previous clipboard is better than failing the insert.
  }
}

/**
 * Types `text` at the cursor by pasting it, then restores the clipboard unless asked to keep it.
 * Returns false when the paste keystroke couldn't be sent; the text is then left on the clipboard.
 */
export async function insertText(text: string, keepOnClipboard: boolean): Promise<boolean> {
  const before = await snapshot();
  await clipboard.writeText(text);
  try {
    await chord("v");
  } catch {
    return false;
  }
  if (!keepOnClipboard) {
    // Give slow apps time to read the clipboard before swapping it back.
    setTimeout(() => void restore(before), 800);
  }
  return true;
}

/** Undoes the last edit in the focused app (used to take back what Flow just typed). */
export async function undoLastEdit() {
  await chord("z");
  await sleep(60);
}

/** Copies whatever is highlighted in the focused app, leaving the clipboard as it was. */
export async function readSelection(): Promise<string> {
  const before = await snapshot();
  clipboard.clear();
  let selection = "";
  try {
    await chord("c");
    for (let i = 0; i < 8 && !selection; i++) {
      await sleep(50);
      selection = await clipboard.readText();
    }
  } catch {
    // No keystroke permission; Max still works without the selection.
  } finally {
    await restore(before);
  }
  return selection.trim();
}

const MAC_FRONT_APP = `
tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  set winTitle to ""
  try
    set winTitle to name of front window of p
  end try
end tell
return appName & linefeed & winTitle`;

const WIN_FRONT_APP = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$h = [W]::GetForegroundWindow(); $sb = New-Object System.Text.StringBuilder 512
[void][W]::GetWindowText($h, $sb, 512); $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
(Get-Process -Id $p).ProcessName; $sb.ToString()`;

const TERMINALS =
  /\b(terminal|iterm2?|warp|alacritty|kitty|wezterm|hyper|ghostty|tabby|konsole|xterm|tilix|terminator|cmd|powershell|pwsh|windowsterminal|conhost|mintty|wt)\b/i;

export function isTerminal(ctx: Pick<FocusContext, "app" | "windowTitle">): boolean {
  return TERMINALS.test(ctx.app ?? "");
}

/** Name and window title of the app the user is typing into. */
export async function activeApp(): Promise<Pick<FocusContext, "app" | "windowTitle">> {
  try {
    let out = "";
    if (process.platform === "darwin") {
      out = await run("osascript", ["-e", MAC_FRONT_APP]);
    } else if (process.platform === "win32") {
      out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_FRONT_APP], 6000);
    } else {
      const title = await run("xdotool", ["getactivewindow", "getwindowname"]);
      const pid = await run("xdotool", ["getactivewindow", "getwindowpid"]);
      const comm = await fs.readFile(`/proc/${pid}/comm`, "utf8").catch(() => "");
      out = `${comm.trim()}\n${title}`;
    }
    const [app = "", windowTitle = ""] = out.split(/\r?\n/);
    return { app: app.trim() || undefined, windowTitle: windowTitle.trim() || undefined };
  } catch {
    return {};
  }
}

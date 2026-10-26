import { talk, toast } from "../src/renderer/app";
import { watchFlowInput } from "../src/renderer/flow-input";
import { ghostSvg } from "../src/renderer/ghost";
import type { TalkView } from "../src/renderer/talk";
import type { Settings } from "../src/shared/types";
import { onSharingChange, sharing, startSharing, stopSharing } from "./screen";

// The floating ghost on the web: drag it anywhere on the page, click it, and
// talk with Wispr Flow into its bubble. "Pop out" puts it in a small window
// that stays on top of every other app (Chrome and Edge), so it works next to
// LinkedIn or Gmail like the desktop ghost does; the result lands on your
// clipboard, ready to paste.

const POS_KEY = "wm.ghost";
const isMac = navigator.platform.toLowerCase().includes("mac");

const root = document.createElement("div");
root.className = "fg";
root.innerHTML = `
  <div class="fg-panel" role="dialog" aria-label="Talk to Max">
    <p class="fg-title"></p>
    <p class="fg-live muted small"></p>
    <pre class="fg-out output"></pre>
    <div class="fg-actions">
      <span class="fg-note muted small"></span>
      <span class="spacer"></span>
      <button class="link-btn fg-draft hidden">Open draft</button>
      <button class="link-btn fg-copy">Copy</button>
    </div>
    <textarea class="fg-input" rows="2" placeholder="Hold your Wispr Flow key and talk here"></textarea>
    <div class="fg-tools">
      <button class="fg-tool fg-mic" title="No Wispr Flow? Use your browser's microphone">
        <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>Mic
      </button>
      <button class="fg-tool fg-screen" title="Let Max read a tab or window, like the LinkedIn chat you're replying to">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><span>Read a tab</span>
      </button>
      <span class="spacer"></span>
      <button class="fg-tool fg-pop" title="Keep the ghost on top of other apps">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/></svg><span>Pop out</span>
      </button>
    </div>
  </div>
  <button class="fg-ghost" title="Drag me anywhere. Click to talk to Max.">
    <span class="ghost-slot big" data-eyes="center">${ghostSvg()}</span>
    <span class="talk-shadow"><i></i><i></i><i></i><i></i></span>
  </button>`;
document.body.append(root);

const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const ghost = q("button.fg-ghost");
const art = q(".fg-ghost .ghost-slot");
const panel = q(".fg-panel");
const input = q<HTMLTextAreaElement>(".fg-input");
const out = q(".fg-out");
const note = q(".fg-note");

let open = false;
let pip: Window | null = null;
let enabled = true;
let onHome = true;

// ---------- position and dragging ----------

let pos = (() => {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "") as { x: number; y: number };
  } catch {
    return { x: innerWidth - 110, y: innerHeight - 120 };
  }
})();

function place() {
  if (pip) return;
  const w = ghost.offsetWidth || 64;
  const h = ghost.offsetHeight || 72;
  pos = { x: Math.max(8, Math.min(innerWidth - w - 8, pos.x)), y: Math.max(8, Math.min(innerHeight - h - 8, pos.y)) };
  root.style.left = `${pos.x}px`;
  root.style.top = `${pos.y}px`;
  // Open the bubble towards the roomier side of the window.
  root.classList.toggle("below", pos.y < 300);
  root.classList.toggle("left", pos.x > innerWidth / 2);
}
addEventListener("resize", place);

let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
ghost.addEventListener("pointerdown", (e) => {
  if (pip || e.button !== 0) return;
  ghost.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false };
});
ghost.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  root.classList.add("dragging");
  pos = { x: drag.px + dx, y: drag.py + dy };
  place();
});
ghost.addEventListener("pointerup", () => {
  const wasDrag = drag?.moved;
  drag = null;
  root.classList.remove("dragging");
  if (wasDrag) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // Not remembered; it still moved.
    }
  } else if (!pip) {
    setOpen(!open);
  }
});
ghost.addEventListener("click", (e) => e.preventDefault());

function setOpen(on: boolean) {
  open = on;
  root.classList.toggle("open", on);
  // Wispr Flow types into whatever has focus: give it the box.
  if (on) input.focus();
}

// ---------- talking ----------

watchFlowInput(input, (text) => void talk.submit(text));
let lastStatus: TalkView["status"] = "idle";
let lookAround: number | undefined;

function render(v: TalkView) {
  root.dataset.state = v.status;
  const asking = v.status === "asking";
  q(".fg-title").textContent =
    v.status === "idle" && !v.showResult
      ? `Hold your Flow key (${isMac ? "fn" : "Ctrl + Win"}) and tell Max what to write.`
      : v.title;
  q(".fg-title").classList.toggle("bubble-q", asking);
  q(".fg-live").textContent = v.status === "listening" && v.live ? `“${v.live}”` : "";
  input.placeholder = asking ? "Answer with Wispr Flow, or type it" : "Hold your Wispr Flow key and talk here";
  q(".fg-mic").classList.toggle("recording", v.status === "listening");

  const showOut = v.showResult && Boolean(v.output || v.streaming);
  out.classList.toggle("hidden", !showOut);
  q(".fg-actions").classList.toggle("hidden", !showOut || v.streaming);
  q(".fg-draft").classList.toggle("hidden", !v.draft);
  out.textContent = v.output;
  out.classList.toggle("streaming", v.streaming);

  clearInterval(lookAround);
  art.dataset.eyes = v.status === "done" ? "happy" : asking ? "right" : "center";
  if (v.status === "thinking") {
    let left = false;
    lookAround = window.setInterval(() => (art.dataset.eyes = (left = !left) ? "left" : "right"), 420);
  }

  // A question pops the bubble open, wherever you are in the app (the Home
  // screen asks with its own ghost).
  const shown = Boolean(pip) || !root.classList.contains("hidden");
  if (asking && !open && shown) setOpen(true);
  if (v.status === "done" && lastStatus !== "done" && open && shown) void copyResult(true);
  if (v.status !== "done") note.textContent = "";
  lastStatus = v.status;
}
talk.onChange(render);

/** Copies with the clipboard of whichever window the ghost is in (the pop-out has its own). */
async function copyResult(auto: boolean) {
  const win = root.ownerDocument.defaultView ?? window;
  try {
    await win.navigator.clipboard.writeText(talk.view.output);
    note.textContent = auto ? `Copied. Paste it with ${isMac ? "⌘" : "Ctrl"} + V.` : "Copied";
  } catch {
    if (!auto) note.textContent = "Couldn't copy. Select the text instead.";
  }
}

q(".fg-copy").addEventListener("click", () => void copyResult(false));
q(".fg-draft").addEventListener("click", () => void talk.openDraft());
q(".fg-mic").addEventListener("click", () => void talk.toggleVoice());

// ---------- reading a tab ----------

const screenButton = q(".fg-screen");
function renderSharing(on: boolean) {
  screenButton.classList.toggle("on", on);
  screenButton.querySelector("span")!.textContent = on ? "Reading your tab" : "Read a tab";
  document.querySelectorAll<HTMLElement>("[data-share-screen]").forEach((b) => {
    b.textContent = on ? "Stop sharing" : "Share a tab with Max";
    b.classList.toggle("on", on);
  });
  document.querySelectorAll<HTMLElement>("[data-share-status]").forEach((s) => {
    s.textContent = on
      ? "Max can see the tab you shared and will use it as context."
      : "Share the tab you're replying in (LinkedIn, Gmail, Slack) and Max reads the conversation first.";
  });
}
export async function toggleSharing() {
  try {
    if (sharing()) stopSharing();
    else await startSharing();
  } catch (err) {
    // NotAllowedError is the picker being cancelled.
    if (err instanceof Error && err.name !== "NotAllowedError") toast(`Couldn't share the screen: ${err.message}`, true);
  }
}
screenButton.addEventListener("click", () => void toggleSharing());
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-share-screen]")) void toggleSharing();
});
onSharingChange(renderSharing);
renderSharing(sharing());

// ---------- pop out (Document Picture-in-Picture) ----------

type PipApi = { requestWindow(opts: { width: number; height: number }): Promise<Window> };
const pipApi = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
q(".fg-pop").classList.toggle("hidden", !pipApi);

async function popOut() {
  if (pip) return pip.close();
  if (!pipApi) return;
  const win = await pipApi.requestWindow({ width: 380, height: 320 });
  for (const node of Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))) {
    win.document.head.append(node.cloneNode(true));
  }
  win.document.body.className = "fg-pip-body";
  pip = win;
  root.classList.add("pip", "open");
  q(".fg-pop span").textContent = "Back to page";
  win.document.body.append(root);
  input.focus();
  win.addEventListener("pagehide", () => {
    pip = null;
    root.classList.remove("pip");
    q(".fg-pop span").textContent = "Pop out";
    document.body.append(root);
    setOpen(false);
    sync();
  });
  sync();
}
q(".fg-pop").addEventListener("click", () => void popOut().catch(() => undefined));

// ---------- when to show it ----------

function sync() {
  // The Home screen has its own big ghost.
  root.classList.toggle("hidden", !pip && (!enabled || onHome));
  place();
}

const home = document.getElementById("tab-home")!;
new MutationObserver(() => {
  onHome = home.classList.contains("active");
  sync();
}).observe(home, { attributes: true, attributeFilter: ["class"] });
onHome = home.classList.contains("active");

document.addEventListener("wispr:state", (e) => {
  enabled = (e as CustomEvent<{ settings: Settings }>).detail.settings.showIdleGhost;
  sync();
});

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open && !pip) setOpen(false);
});
sync();

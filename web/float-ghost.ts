import { talk, toast } from "../src/renderer/app";
import { watchFlowInput } from "../src/renderer/flow-input";
import { ghostSvg } from "../src/renderer/ghost";
import { applyTheme } from "../src/renderer/theme";
import type { TalkView } from "../src/renderer/talk";
import type { Settings } from "../src/shared/types";
import { attachImage, clearImage, hasPasted, imageIn, onContextChange, sharing, startSharing, stopSharing } from "./screen";

// The floating ghost on the web: a small ghost you can drag anywhere. Click it
// and a slim pill opens for Wispr Flow to type into. Otherwise it stays out of
// the way: a speech bubble appears only when Max has something to say (a
// question, what it heard, or the result). "Pop out" puts it in a small window
// that stays on top of other apps (Chrome and Edge), so it works next to
// LinkedIn or Gmail; the result lands on your clipboard, ready to paste.

const POS_KEY = "wm.ghost";
const isMac = navigator.platform.toLowerCase().includes("mac");
const RESULT_MS = 10_000;

const icon = (path: string) => `<svg viewBox="0 0 24 24">${path}</svg>`;

const root = document.createElement("div");
root.className = "fg";
root.innerHTML = `
  <div class="fg-stack">
    <div class="fg-bubble" role="status">
      <p class="fg-say"></p>
      <pre class="fg-out"></pre>
      <div class="fg-actions">
        <span class="fg-note"></span>
        <span class="spacer"></span>
        <button class="link-btn fg-draft hidden">Open draft</button>
        <button class="link-btn fg-copy">Copy</button>
      </div>
    </div>
    <div class="fg-bar">
      <input class="fg-input" autocomplete="off" />
      <button class="fg-icon fg-mic" title="No Wispr Flow? Use your microphone">${icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')}</button>
      <button class="fg-icon fg-screen" title="Read a tab: let Max see the chat you're replying to">${icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>')}</button>
      <button class="fg-icon fg-pop" title="Pop out: keep the ghost on top of other apps">${icon('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>')}</button>
    </div>
  </div>
  <button class="fg-ghost" title="Drag me anywhere. Click to talk to Max.">
    <span class="ghost-slot" data-eyes="center">${ghostSvg()}</span>
    <span class="talk-shadow"><i></i><i></i><i></i><i></i></span>
  </button>`;
document.body.append(root);

const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const ghost = q("button.fg-ghost");
const art = q(".fg-ghost .ghost-slot");
const input = q<HTMLInputElement>(".fg-input");
const out = q(".fg-out");
const note = q(".fg-note");

let barOpen = false;
let bubbleOpen = false;
let pip: Window | null = null;
let enabled = true;
let onHome = true;
let hideTimer: number | undefined;

// ---------- position and dragging ----------

let pos = (() => {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "") as { x: number; y: number };
  } catch {
    return { x: innerWidth - 80, y: innerHeight - 170 };
  }
})();

function place() {
  if (pip) return;
  const w = ghost.offsetWidth || 44;
  const h = ghost.offsetHeight || 48;
  pos = { x: Math.max(8, Math.min(innerWidth - w - 8, pos.x)), y: Math.max(8, Math.min(innerHeight - h - 8, pos.y)) };
  root.style.left = `${pos.x}px`;
  root.style.top = `${pos.y}px`;
  // Open towards the roomier side of the window.
  root.classList.toggle("below", pos.y < 260);
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
    return;
  }
  // Click: open the pill (and put away an old result), or close it again.
  if (bubbleOpen && talk.view.status === "done") showBubble(false);
  setBar(pip ? true : !barOpen);
});
ghost.addEventListener("click", (e) => e.preventDefault());

function setBar(on: boolean) {
  barOpen = on;
  root.classList.toggle("bar-open", on);
  // Wispr Flow types into whatever has focus: give it the pill.
  if (on) input.focus();
  else input.blur();
}

function showBubble(on: boolean, autoHide = false) {
  bubbleOpen = on;
  root.classList.toggle("bubble-open", on);
  clearTimeout(hideTimer);
  if (on && autoHide) {
    hideTimer = window.setTimeout(() => {
      if (!root.matches(":hover")) showBubble(false);
      else root.addEventListener("mouseleave", () => showBubble(false), { once: true });
    }, RESULT_MS);
  }
}

// Clicking elsewhere on the page puts the pill away (not while Max is asking).
document.addEventListener("pointerdown", (e) => {
  if (pip || root.contains(e.target as Node) || talk.view.status === "asking") return;
  if (barOpen && !input.value.trim()) setBar(false);
  if (bubbleOpen && talk.view.status === "done") showBubble(false);
});

// ---------- talking ----------

watchFlowInput(input, (text) => {
  if (!pip) setBar(false);
  void talk.submit(text);
});
let lastStatus: TalkView["status"] = "idle";
let lookAround: number | undefined;

function render(v: TalkView) {
  root.dataset.state = v.status;
  const asking = v.status === "asking";
  const shown = Boolean(pip) || !root.classList.contains("hidden");

  input.placeholder = asking ? "Answer with Flow, or type it" : "Hold your Flow key and talk";
  q(".fg-mic").classList.toggle("on", v.status === "listening");

  // What the bubble says, when there's something to say.
  const say =
    asking ? v.question ?? v.title
    : v.status === "listening" ? (v.live ? `“${v.live}”` : "Listening…")
    : v.status === "thinking" && !v.output ? "Writing…"
    : v.status === "done" ? (v.intent === "command" ? "Here's what I wrote." : "Here's your text.")
    : "";
  q(".fg-say").textContent = say;
  root.classList.toggle("asking", asking);

  const showOut = !asking && Boolean(v.output) && (v.status === "thinking" || v.status === "done");
  out.classList.toggle("hidden", !showOut);
  out.textContent = v.output;
  out.classList.toggle("streaming", v.streaming);
  q(".fg-actions").classList.toggle("hidden", v.status !== "done");
  q(".fg-draft").classList.toggle("hidden", !v.draft);
  if (v.status !== "done") note.textContent = "";

  clearInterval(lookAround);
  art.dataset.eyes = v.status === "done" ? "happy" : asking ? "right" : "center";
  if (v.status === "thinking") {
    let left = false;
    lookAround = window.setInterval(() => (art.dataset.eyes = (left = !left) ? "left" : "right"), 420);
  }

  if (shown) {
    if (asking) {
      // Max needs one detail: ask in the bubble and open the pill for the answer.
      showBubble(true);
      setBar(true);
    } else if (v.status === "listening" || v.status === "thinking") {
      showBubble(true);
    } else if (v.status === "done" && lastStatus !== "done") {
      showBubble(true, true);
      void copyResult(true);
    } else if (v.status === "idle") {
      showBubble(false);
    }
  }
  lastStatus = v.status;
}
talk.onChange(render);

/** Copies with the clipboard of whichever window the ghost is in (the pop-out has its own). */
async function copyResult(auto: boolean) {
  const win = root.ownerDocument.defaultView ?? window;
  try {
    await win.navigator.clipboard.writeText(talk.view.output);
    note.textContent = auto ? `Copied · ${isMac ? "⌘" : "Ctrl"} + V to paste` : "Copied";
  } catch {
    if (!auto) note.textContent = "Couldn't copy. Select the text instead.";
  }
}

q(".fg-copy").addEventListener("click", () => void copyResult(false));
q(".fg-draft").addEventListener("click", () => void talk.openDraft());
q(".fg-mic").addEventListener("click", () => void talk.toggleVoice());

// ---------- screen context: a pasted screenshot or a shared tab ----------

const isMacKeys = isMac ? "Cmd + Shift + 4, then Cmd + V" : "Win + Shift + S, then Ctrl + V";
const screenButton = q(".fg-screen");
function renderContext() {
  const on = sharing() || hasPasted();
  screenButton.classList.toggle("on", on);
  screenButton.title = sharing()
    ? "Max is reading the tab you shared. Click to stop."
    : hasPasted()
      ? "Max will read the screenshot you pasted. Click to remove it."
      : "Read a tab: let Max see the chat you're replying to (or just paste a screenshot)";
  document.querySelectorAll<HTMLElement>("[data-share-screen]").forEach((b) => {
    b.textContent = sharing() ? "Stop sharing" : "Share a tab";
    b.classList.toggle("on", sharing());
  });
  document.querySelectorAll<HTMLElement>("[data-share-status]").forEach((el) => {
    el.innerHTML = sharing()
      ? "Max can see the tab you shared and will use it as context."
      : hasPasted()
        ? `Max will read the screenshot you pasted. <button type="button" class="link-btn" data-clear-shot>Remove</button>`
        : `Show Max the chat you're replying to: paste a screenshot here (${isMacKeys}), or share a tab.`;
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
screenButton.addEventListener("click", () => {
  if (hasPasted() && !sharing()) clearImage();
  else void toggleSharing();
});
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-share-screen]")) void toggleSharing();
  if (target.closest("[data-clear-shot]")) clearImage();
});

/** A screenshot pasted into either talk box becomes Max's context. */
function acceptScreenshots(el: HTMLElement) {
  el.addEventListener("paste", (e) => {
    const image = imageIn(e.clipboardData);
    if (!image) return; // Text (including Wispr Flow's) goes in as usual.
    e.preventDefault();
    void attachImage(image)
      .then(() => toast("Got it. Max will read that screenshot."))
      .catch(() => toast("Couldn't read that image.", true));
  });
}
acceptScreenshots(input);
acceptScreenshots(document.getElementById("talk-input")!);
onContextChange(renderContext);
renderContext();

// ---------- pop out (Document Picture-in-Picture) ----------

type PipApi = { requestWindow(opts: { width: number; height: number }): Promise<Window> };
const pipApi = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
q(".fg-pop").classList.toggle("hidden", !pipApi);

async function popOut() {
  if (pip) return pip.close();
  if (!pipApi) return;
  const win = await pipApi.requestWindow({ width: 340, height: 220 });
  for (const node of Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))) {
    win.document.head.append(node.cloneNode(true));
  }
  const theme = document.documentElement.dataset.theme;
  if (theme) win.document.documentElement.dataset.theme = theme;
  win.document.title = "Wispr Max";
  win.document.body.className = "fg-pip-body";
  pip = win;
  root.classList.add("pip");
  q(".fg-pop").title = "Back to the page";
  win.document.body.append(root);
  setBar(true);
  win.addEventListener("pagehide", () => {
    pip = null;
    root.classList.remove("pip");
    q(".fg-pop").title = "Pop out: keep the ghost on top of other apps";
    document.body.append(root);
    setBar(false);
    showBubble(false);
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
  const settings = (e as CustomEvent<{ settings: Settings }>).detail.settings;
  enabled = settings.showIdleGhost;
  if (pip) applyTheme(settings.theme, pip.document);
  sync();
});

addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || pip) return;
  setBar(false);
  showBubble(false);
});
sync();

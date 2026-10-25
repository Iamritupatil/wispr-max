import { hasDescription, parseContactInput } from "../core/contact-input";
import { findMentionedContacts } from "../core/contacts";
import { emailRecipient, parseEmailDraft } from "../core/email";
import { localDay, streak, wpm } from "../core/stats";
import { CATEGORY_LABELS, STYLES } from "../core/style";
import type { AppApi, AppSnapshot } from "../shared/api";
import type { Contact, Settings, StyleCategory, StyleId } from "../shared/types";
import { ghostSvg } from "./ghost";
import { Recorder } from "./recorder";

declare global {
  interface Window {
    wispr: AppApi;
  }
}

const api = window.wispr;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let state: AppSnapshot;
const isMac = navigator.platform.toLowerCase().includes("mac");
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const esc = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function toast(message: string, error = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast show${error ? " error" : ""}`;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(window.setTimeout(() => (t.className = "toast"), 2600));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");

async function save(patch: Partial<Settings>) {
  state = await api.saveSettings(patch);
  renderAll();
}

// ---------- ghosts ----------

function paintGhosts(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-ghost]:empty").forEach((el) => (el.innerHTML = ghostSvg()));
}

// The sidebar ghost blinks every few seconds.
const brandGhost = document.querySelector<HTMLElement>(".brand [data-ghost]")!;
setInterval(() => {
  brandGhost.dataset.eyes = "closed";
  setTimeout(() => (brandGhost.dataset.eyes = "center"), 150);
}, 4200);

// ---------- navigation ----------

function showTab(tab: string) {
  if (!$(`tab-${tab}`)) tab = "home";
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.id === `tab-${tab}`));
  document
    .querySelectorAll<HTMLButtonElement>(".sidebar button[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelector(".content")!.scrollTop = 0;
}

document.querySelector(".sidebar")!.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>("button[data-tab]")?.dataset.tab;
  if (tab) showTab(tab);
});
api.onNavigate(showTab);

document.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
  if (link) {
    e.preventDefault();
    void api.openExternal(link.dataset.href!);
  }
  const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
  if (go) showTab(go.dataset.go!);
});

// ---------- hotkeys ----------

function prettyAccelerator(accelerator: string) {
  return accelerator
    .replace("CommandOrControl", isMac ? "Cmd" : "Ctrl")
    .replace("Control", "Ctrl")
    .replace("Super", "Win")
    .replace("Alt", isMac ? "Option" : "Alt")
    .split("+")
    .join(" + ");
}

function keyCaps(accelerator: string) {
  return accelerator
    .split("+")
    .map((k) => {
      const label =
        k === "CommandOrControl" ? (isMac ? "⌘" : "Ctrl")
        : k === "Shift" ? (isMac ? "⇧" : "Shift")
        : k === "Alt" ? (isMac ? "⌥" : "Alt")
        : k === "Control" ? (isMac ? "⌃" : "Ctrl")
        : k === "Super" ? "Win"
        : k;
      return `<kbd>${esc(label)}</kbd>`;
    })
    .join("");
}

/** KeyboardEvent → Electron accelerator, or null while only modifiers are held. */
function toAccelerator(e: KeyboardEvent): string | null {
  let key = "";
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (["Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown"].includes(e.code)) key = e.code;
  else if (e.code.startsWith("Arrow")) key = e.code.slice(5);
  else if (["Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash"].includes(e.code)) key = e.key;
  if (!key) return null;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("CommandOrControl");
  if (isMac && e.ctrlKey) mods.push("Control");
  if (!isMac && e.metaKey) mods.push("Super");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!mods.length && !/^F\d/.test(key)) return null; // A bare letter would hijack typing.
  return [...mods, key].join("+");
}

// ---------- home ----------

function renderHome() {
  const { settings, status, contacts, stats } = state;
  const first = settings.profile.name.split(" ")[0];
  $("greeting").textContent = first ? `Welcome back, ${first}` : "Welcome back";

  const stat = (value: string, label: string) => `<span class="stat"><b>${esc(value)}</b>${esc(label)}</span>`;
  $("stats").innerHTML = stats.sessions
    ? stat(String(streak(stats.days)), "day streak") +
      stat(stats.words.toLocaleString(), "words") +
      stat(String(wpm(stats.words, stats.ms)), "wpm")
    : "";

  $("kbd-dictate").innerHTML = keyCaps(settings.dictateHotkey);
  $("kbd-max").innerHTML = keyCaps(settings.maxHotkey);

  const checks = [
    { ok: status.aiReady, title: "Anthropic API key", hint: "Powers Max and smart formatting.", action: `<button class="btn small" data-go="settings">Add key</button>` },
    { ok: status.sttReady, title: "Speech-to-text key", hint: "AssemblyAI, Groq or OpenAI.", action: `<button class="btn small" data-go="settings">Add key</button>` },
    ...(status.platform === "darwin"
      ? [{ ok: status.accessibilityTrusted, title: "Accessibility permission", hint: "Lets Wispr Max type into other apps.", action: `<button id="grant-ax" class="btn small">Grant</button>` }]
      : []),
    { ok: status.hotkeys.dictate && status.hotkeys.max, title: "Hotkeys", hint: "Another app may be using one of them.", action: `<button class="btn small" data-go="settings">Change</button>` },
    { ok: contacts.length > 0, title: "Contacts", hint: "The people Max writes to.", action: `<button class="btn small" data-go="contacts">Add</button>` },
    { ok: Boolean(settings.profile.name), title: "About you", hint: "Your name and sign-off.", action: `<button class="btn small" data-go="profile">Fill in</button>` },
  ];
  const done = checks.filter((c) => c.ok).length;
  $("setup").innerHTML =
    `<div class="card-title"><h2 class="serif">Get set up</h2><span class="muted">${done} of ${checks.length}</span></div>` +
    checks
      .map(
        (c, i) => `<div class="check ${c.ok ? "ok" : ""}">
          <span class="mark">${c.ok ? "✓" : i + 1}</span>
          <div class="what">${esc(c.title)}<span>${esc(c.hint)}</span></div>
          ${c.ok ? "" : c.action}
        </div>`,
      )
      .join("");
  $("setup").classList.toggle("hidden", done === checks.length);
  document.getElementById("grant-ax")?.addEventListener("click", async () => {
    state.status = await api.requestAccessibility();
    toast("Turn on Wispr Max in System Settings → Privacy & Security → Accessibility.");
    renderHome();
  });

  const line = (ok: boolean, text: string) =>
    `<div class="s"><span class="dot" style="background:var(--${ok ? "ok" : "warn"})"></span>${esc(text)}</div>`;
  $("sidebar-status").innerHTML =
    line(status.aiReady, status.aiReady ? "Claude connected" : "Claude key missing") +
    line(status.sttReady, status.sttReady ? "Voice ready" : "Voice key missing");
}

// ---------- activity feed ----------

function dayLabel(at: number) {
  const day = localDay(new Date(at));
  const today = new Date();
  if (day === localDay(today)) return "Today";
  today.setDate(today.getDate() - 1);
  if (day === localDay(today)) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function renderFeed() {
  const history = state.history;
  $("h-clear").classList.toggle("hidden", !history.length);
  if (!history.length) {
    $("feed").innerHTML = `<div class="empty"><span class="ghost-slot" data-eyes="happy" data-ghost></span>
      <div>Nothing here yet. Press <span class="keys">${keyCaps(state.settings.dictateHotkey)}</span> in any app and start talking.</div></div>`;
    paintGhosts($("feed"));
    return;
  }
  let lastDay = "";
  $("feed").innerHTML = history
    .map((h, i) => {
      const day = dayLabel(h.at);
      const header = day !== lastDay ? `<div class="day">${esc(day)}</div>` : "";
      lastDay = day;
      const meta = [
        h.mode === "max" ? `<span class="tag">MAX</span>` : "",
        h.autoDetected ? `<span>auto-detected ·</span>` : "",
        h.draftTo ? `<span>Email draft to ${esc(h.draftTo)}</span>` : h.app ? `<span>${esc(h.app)}</span>` : "",
        h.mode === "max" ? `<span>· “${esc(h.transcript)}”</span>` : "",
      ].join("");
      return `${header}<article class="entry">
        <time>${esc(new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</time>
        <div>${meta ? `<div class="meta">${meta}</div>` : ""}<div class="out">${esc(h.output)}</div></div>
        <button class="btn small copy" data-copy="${i}">Copy</button>
      </article>`;
    })
    .join("");
}

$("feed").addEventListener("click", async (e) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>("[data-copy]")?.dataset.copy;
  if (i === undefined) return;
  await api.copy(state.history[Number(i)].output);
  toast("Copied");
});
$("h-clear").addEventListener("click", async () => {
  state.history = await api.clearHistory();
  renderFeed();
});
api.onHistory(({ history, stats }) => {
  state.history = history;
  state.stats = stats;
  renderHome();
  renderFeed();
});

// ---------- talk to Max (Home) ----------
//
// Voice first, like the floating ghost: click the big ghost and talk, or type.
// It decides whether you're dictating or asking Max to write, exactly like the
// Dictate hotkey, and shows the result here instead of pasting it. When Max
// needs one detail first, the ghost asks and your next answer finishes it.

type Ask = { instruction: string; question: string; clarifications: { question: string; answer: string }[] };

const talkGhost = $("talk-ghost");
const talkArt = $("talk-ghost-art");
const talkOutput = $("talk-output");
const talkInput = $<HTMLInputElement>("talk-input");
const talkRecorder = new Recorder();
const TALK_HINT = $("talk-hint").textContent ?? "";
let talkBusy = false;
let talkDraft: { to: string; subject: string; body: string } | null = null;
let pendingAsk: Ask | null = null;
let lookAround: number | undefined;

function setTalk(state: "idle" | "listening" | "thinking" | "asking" | "done", title: string) {
  talkGhost.dataset.state = state;
  $("talk-title").textContent = title;
  $("talk-title").classList.toggle("bubble-q", state === "asking");
  $("talk-hint").textContent =
    state === "asking" ? "Max needs one thing first. Click the ghost and answer, or type it below." : TALK_HINT;
  talkInput.placeholder = state === "asking" ? "Type your answer and press Enter" : "…or type to Max and press Enter";
  clearInterval(lookAround);
  talkArt.dataset.eyes = state === "done" ? "happy" : state === "asking" ? "right" : "center";
  if (state === "thinking") {
    let left = false;
    lookAround = window.setInterval(() => (talkArt.dataset.eyes = (left = !left) ? "left" : "right"), 420);
  }
}

api.onComposeText((delta) => {
  if (!talkBusy) return;
  talkOutput.textContent = delta === null ? "" : talkOutput.textContent + delta;
});

async function runTalk(text: string) {
  text = text.trim();
  if (!text || talkBusy) return;
  talkBusy = true;
  talkDraft = null;
  const answering = pendingAsk;
  pendingAsk = null;
  const instruction = answering?.instruction ?? text;
  setTalk("thinking", "Max is on it…");
  $("talk-result").classList.remove("hidden");
  $("talk-email").classList.add("hidden");
  $("talk-draft").classList.add("hidden");
  $("talk-meta").textContent = answering ? `“${instruction}” · you said: “${text}”` : `“${text}”`;
  talkOutput.textContent = "";
  talkOutput.classList.add("streaming");
  // "Email Priya…" becomes a ready-to-send draft: recipient, subject and body.
  const about = answering ? `${instruction} ${text}` : text;
  const to = emailRecipient(about, findMentionedContacts(about, state.contacts));
  try {
    let res: { intent: "dictation" | "command"; text: string; question?: string; reason?: string; decidedBy?: string };
    let clarifications = answering?.clarifications ?? [];
    if (answering) {
      clarifications = [...clarifications, { question: answering.question, answer: text }];
      res = { intent: "command", ...(await api.compose({ instruction, app: "Wispr Max", emailDraft: Boolean(to), clarifications })) };
    } else {
      res = await api.smart({ instruction: text, app: "Wispr Max", emailDraft: Boolean(to) });
    }

    if (res.question) {
      // Max asks before guessing; the next thing you say or type is the answer.
      pendingAsk = { instruction, question: res.question, clarifications };
      $("talk-result").classList.add("hidden");
      setTalk("asking", res.question);
      talkInput.focus();
      return;
    }

    const asked = res.intent === "command";
    if (!answering) {
      $("talk-meta").innerHTML =
        `“${esc(text)}” · heard as <b>${asked ? "a request to Max" : "dictation"}</b>` +
        `<span class="by">${res.decidedBy === "rules" ? "decided instantly" : "decided by Claude"}</span>`;
    }
    if (asked && to) {
      talkDraft = { to, ...parseEmailDraft(res.text) };
      $("talk-to").textContent = to;
      $("talk-subject").textContent = talkDraft.subject || "(no subject)";
      $("talk-email").classList.remove("hidden");
      $("talk-draft").classList.remove("hidden");
      talkOutput.textContent = talkDraft.body;
    } else {
      talkOutput.textContent = res.text;
    }
    setTalk("done", asked ? "Here's what Max wrote." : "Here's your text, cleaned up.");
  } catch (err) {
    $("talk-result").classList.add("hidden");
    setTalk("idle", "Click the ghost and talk.");
    toast(errorText(err), true);
  } finally {
    talkOutput.classList.remove("streaming");
    talkBusy = false;
  }
}

talkGhost.addEventListener("click", async () => {
  try {
    if (!talkRecorder.active) {
      if (talkBusy) return;
      await talkRecorder.start();
      setTalk("listening", pendingAsk ? "Listening for your answer… click the ghost when you're done." : "Listening… click the ghost when you're done.");
      return;
    }
    setTalk("thinking", "Transcribing…");
    const text = await api.transcribe(await talkRecorder.stop());
    if (!text) {
      if (pendingAsk) setTalk("asking", pendingAsk.question);
      else setTalk("idle", "Didn't catch that. Click the ghost and try again.");
      return;
    }
    await runTalk(text);
  } catch (err) {
    await talkRecorder.cancel();
    if (pendingAsk) setTalk("asking", pendingAsk.question);
    else setTalk("idle", "Click the ghost and talk.");
    toast(errorText(err), true);
  }
});

talkInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  void runTalk(talkInput.value);
  talkInput.value = "";
});
$("talk-copy").addEventListener("click", async () => {
  await api.copy(talkOutput.textContent ?? "");
  toast("Copied");
});
$("talk-draft").addEventListener("click", async () => {
  if (talkDraft) await api.openDraft(talkDraft);
});

// ---------- dictionary ----------

function renderDictionary() {
  const { dictionary } = state.settings;
  const auto = state.contacts.slice(0, 20).map((c) => c.name);
  $("dict-list").innerHTML =
    dictionary
      .map(
        (d) => `<span class="chip"><b>${esc(d.word)}</b>${d.heardAs ? `<span class="from">← ${esc(d.heardAs)}</span>` : ""}
          <button class="x" data-del="${esc(d.id)}" title="Remove">×</button></span>`,
      )
      .join("") + auto.map((n) => `<span class="chip auto" title="From your contacts">${esc(n)}</span>`).join("");
  if (!dictionary.length && !auto.length) $("dict-list").innerHTML = `<p class="muted">No words yet.</p>`;
}

$<HTMLFormElement>("dict-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const word = data.word.trim();
  if (!word) return;
  await save({
    dictionary: [...state.settings.dictionary, { id: newId(), word, heardAs: data.heardAs.trim() || undefined }],
  });
  form.reset();
  (form.elements.namedItem("word") as HTMLInputElement).focus();
});

$("dict-list").addEventListener("click", async (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-del]")?.dataset.del;
  if (id) await save({ dictionary: state.settings.dictionary.filter((d) => d.id !== id) });
});

// ---------- snippets ----------

function renderSnippets() {
  const { snippets } = state.settings;
  $("snip-list").innerHTML = snippets.length
    ? snippets
        .map(
          (s) => `<div class="snip"><span class="trigger">${esc(s.trigger)}</span><span class="text">${esc(s.text)}</span>
            <button class="x" data-del="${esc(s.id)}" title="Remove">×</button></div>`,
        )
        .join("")
    : `<div class="empty"><span class="ghost-slot" data-eyes="right" data-ghost></span>No snippets yet. Try your calendar link, address or a standard intro.</div>`;
  paintGhosts($("snip-list"));
}

$<HTMLFormElement>("snip-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  if (!data.trigger.trim() || !data.text.trim()) return;
  await save({
    snippets: [...state.settings.snippets, { id: newId(), trigger: data.trigger.trim(), text: data.text.trim() }],
  });
  form.reset();
  toast("Snippet added");
});

$("snip-list").addEventListener("click", async (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-del]")?.dataset.del;
  if (id) await save({ snippets: state.settings.snippets.filter((s) => s.id !== id) });
});

// ---------- style ----------

let styleCat: StyleCategory = "personal";

function renderStyle() {
  $("style-cats").innerHTML = (Object.keys(CATEGORY_LABELS) as StyleCategory[])
    .map((c) => `<button data-cat="${c}" class="${c === styleCat ? "active" : ""}">${esc(CATEGORY_LABELS[c].title)}</button>`)
    .join("");
  $("style-apps").textContent = `Applies in ${CATEGORY_LABELS[styleCat].apps}.`;
  const current = state.settings.styles[styleCat];
  $("style-options").innerHTML = (Object.keys(STYLES) as StyleId[])
    .map(
      (id) => `<button class="style-card ${id === current ? "active" : ""}" data-style="${id}">
        <span class="name">${esc(STYLES[id].label)}${id === current ? `<span class="on">Selected</span>` : ""}</span>
        <span class="bubble">${esc(STYLES[id].example)}</span>
      </button>`,
    )
    .join("");
}

$("style-cats").addEventListener("click", (e) => {
  const cat = (e.target as HTMLElement).closest<HTMLElement>("[data-cat]")?.dataset.cat as StyleCategory | undefined;
  if (cat) {
    styleCat = cat;
    renderStyle();
  }
});

$("style-options").addEventListener("click", async (e) => {
  const style = (e.target as HTMLElement).closest<HTMLElement>("[data-style]")?.dataset.style as StyleId | undefined;
  if (style) await save({ styles: { ...state.settings.styles, [styleCat]: style } });
});

// ---------- contacts ----------

const AVATAR_COLORS = ["#4b6f6c", "#7f9ba5", "#8a6f5a", "#6d7fa8", "#5f8a6a", "#a0707c", "#6f6a8f"];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\d]/u.test(w) && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const colorFor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

function renderContacts() {
  const q = $<HTMLInputElement>("c-search").value.toLowerCase().trim();
  if (!state.contacts.length) {
    $("c-list").innerHTML = `<div class="empty" style="grid-column:1/-1">
      <span class="ghost-slot" data-eyes="center" data-ghost></span>
      <div><b>No contacts yet</b><br/>Import a CSV or vCard from Google, iPhone, Outlook or LinkedIn, or start with a few samples.</div>
      <button id="c-samples" class="btn">Add sample contacts</button>
    </div>`;
    paintGhosts($("c-list"));
    $("c-samples").addEventListener("click", async () => {
      state.contacts = await api.addSampleContacts();
      renderAll();
      toast("Added sample contacts");
    });
    return;
  }
  const list = state.contacts
    .filter((c) => !q || Object.values(c).some((v) => String(v).toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("c-list").innerHTML = list.length
    ? list
        .map(
          (c) => `<button class="contact" data-id="${esc(c.id)}">
            <span class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</span>
            <span class="info">
              <div class="name">${esc(c.name)}</div>
              <div class="sub">${esc([c.title, c.company].filter(Boolean).join(" · ") || c.email || "")}</div>
              ${c.relationship ? `<div class="rel">${esc(c.relationship)}</div>` : ""}
              ${c.links?.length ? `<div class="platforms">${c.links.map((l) => esc(l.platform)).join(" · ")}</div>` : ""}
            </span>
          </button>`,
        )
        .join("")
    : `<div class="empty" style="grid-column:1/-1">No contacts match “${esc(q)}”.</div>`;
}

$("c-search").addEventListener("input", renderContacts);

// ---------- one-paste contacts ----------

const qaInput = $<HTMLTextAreaElement>("qa-input");
const qaRecorder = new Recorder();
let qaBusy = false;

async function quickAdd(text: string) {
  text = text.trim();
  if (!text || qaBusy) return;
  qaBusy = true;
  $("qa-status").textContent = "Adding…";
  try {
    const { contacts, added } = await api.quickAddContacts(text);
    state.contacts = contacts;
    qaInput.value = "";
    renderAll();
    const names = added.map((c) => c.name).join(", ");
    const needsNote = added.length === 1 && !added[0].relationship && !added[0].notes;
    $("qa-status").innerHTML =
      `Added <b>${esc(names)}</b>.` +
      (needsNote ? ` <button class="link-btn" data-edit="${esc(added[0].id)}">Add how you know them</button>` : "");
  } catch (err) {
    $("qa-status").textContent = "";
    toast(errorText(err), true);
  } finally {
    qaBusy = false;
  }
}

qaInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void quickAdd(qaInput.value);
  }
});
// Paste a link or number and it's added straight away; a description waits for Enter.
qaInput.addEventListener("paste", () => {
  setTimeout(() => {
    const p = parseContactInput(qaInput.value);
    if ((p.links.length || p.email || p.phone) && !hasDescription(p)) void quickAdd(qaInput.value);
  });
});
$("qa-status").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-edit]")?.dataset.edit;
  const c = state.contacts.find((x) => x.id === id);
  if (c) openContact(c);
});
$("qa-mic").addEventListener("click", async () => {
  const mic = $("qa-mic");
  try {
    if (!qaRecorder.active) {
      await qaRecorder.start();
      mic.classList.add("recording");
      $("qa-status").textContent = "Listening… say who they are, then click the mic again.";
      return;
    }
    mic.classList.remove("recording");
    $("qa-status").textContent = "Transcribing…";
    const said = await api.transcribe(await qaRecorder.stop());
    if (!said) {
      $("qa-status").textContent = "Didn't catch that.";
      return;
    }
    await quickAdd([qaInput.value, said].filter(Boolean).join(" "));
  } catch (err) {
    mic.classList.remove("recording");
    $("qa-status").textContent = "";
    toast(errorText(err), true);
  }
});
$("c-list").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".contact")?.dataset.id;
  const c = state.contacts.find((x) => x.id === id);
  if (c) openContact(c);
});
$("c-new").addEventListener("click", () => openContact());
$("c-import").addEventListener("click", async () => {
  try {
    const res = await api.importContacts();
    if (!res) return;
    state.contacts = res.contacts;
    renderAll();
    toast(`Imported ${res.imported} contact${res.imported === 1 ? "" : "s"}`);
  } catch (err) {
    toast(errorText(err), true);
  }
});

const dialog = $<HTMLDialogElement>("contact-dialog");
const contactForm = $<HTMLFormElement>("contact-form");

function openContact(c?: Contact) {
  contactForm.reset();
  $("contact-dialog-title").textContent = c ? "Edit contact" : "New contact";
  $("contact-delete").classList.toggle("hidden", !c);
  for (const el of Array.from(contactForm.elements) as HTMLInputElement[]) {
    if (el.name === "links") el.value = c?.links?.map((l) => l.url).join("\n") ?? "";
    else if (el.name) el.value = (c as unknown as Record<string, string> | undefined)?.[el.name] ?? "";
  }
  dialog.showModal();
}

contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(contactForm)) as Record<string, string>;
  const { links, ...fields } = data;
  const contact = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
  ) as unknown as Contact;
  contact.id = data.id ?? "";
  const parsedLinks = parseContactInput(links ?? "").links;
  if (parsedLinks.length) contact.links = parsedLinks;
  state.contacts = await api.saveContact(contact);
  dialog.close();
  renderAll();
  toast("Contact saved");
});
$("contact-cancel").addEventListener("click", () => dialog.close());
$("contact-delete").addEventListener("click", async () => {
  const id = (contactForm.elements.namedItem("id") as HTMLInputElement).value;
  state.contacts = await api.deleteContact(id);
  dialog.close();
  renderAll();
  toast("Contact deleted");
});

// ---------- profile ----------

const profileForm = $<HTMLFormElement>("profile-form");

function renderProfile() {
  for (const [k, v] of Object.entries(state.settings.profile)) {
    const el = profileForm.elements.namedItem(k) as HTMLInputElement | null;
    if (el) el.value = v;
  }
}

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await save({ profile: Object.fromEntries(new FormData(profileForm)) as unknown as Settings["profile"] });
  toast("Saved. Max will write as you.");
});

// ---------- settings ----------

const settingsForm = $<HTMLFormElement>("settings-form");

function setHotkeyField(input: HTMLInputElement, accelerator: string) {
  input.dataset.acc = accelerator;
  input.value = prettyAccelerator(accelerator);
}

function renderSettings() {
  const s = state.settings as unknown as Record<string, unknown>;
  for (const el of Array.from(settingsForm.elements) as HTMLInputElement[]) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === "checkbox") el.checked = Boolean(s[el.name]);
    else if (el.classList.contains("hotkey")) setHotkeyField(el, String(s[el.name]));
    else el.value = String(s[el.name] ?? "");
  }
  syncProvider();
  const hk = (id: string, ok: boolean) => {
    $(id).textContent = ok ? "Active" : "Couldn't register: another app may be using it";
    $(id).className = `hk-status ${ok ? "ok" : "bad"}`;
  };
  hk("hk-dictate", state.status.hotkeys.dictate);
  hk("hk-max", state.status.hotkeys.max);
}

function syncProvider() {
  const provider = (settingsForm.elements.namedItem("sttProvider") as HTMLSelectElement).value;
  settingsForm
    .querySelectorAll<HTMLElement>("[data-provider]")
    .forEach((el) => el.classList.toggle("hidden", el.dataset.provider !== provider));
}

(settingsForm.elements.namedItem("sttProvider") as HTMLSelectElement).addEventListener("change", syncProvider);

settingsForm.querySelectorAll<HTMLInputElement>("input.hotkey").forEach((input) => {
  input.addEventListener("focus", () => {
    input.value = "Press a shortcut…";
    input.classList.add("recording");
  });
  input.addEventListener("blur", () => {
    setHotkeyField(input, input.dataset.acc ?? "");
    input.classList.remove("recording");
  });
  input.addEventListener("keydown", (e) => {
    e.preventDefault();
    if (e.key === "Escape") return input.blur();
    const acc = toAccelerator(e);
    if (acc) {
      input.dataset.acc = acc;
      input.blur();
    }
  });
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const patch: Record<string, unknown> = {};
  for (const el of Array.from(settingsForm.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    patch[el.name] =
      el.type === "checkbox" ? el.checked
      : el.classList.contains("hotkey") ? el.dataset.acc
      : el.value.trim();
  }
  await save(patch as Partial<Settings>);
  const { dictate, max } = state.status.hotkeys;
  toast(dictate && max ? "Settings saved" : "Saved, but a hotkey couldn't be registered", !(dictate && max));
});

// ---------- boot ----------

function renderAll() {
  renderHome();
  renderFeed();
  renderDictionary();
  renderSnippets();
  renderStyle();
  renderContacts();
  renderProfile();
  renderSettings();
}

paintGhosts();
void api.getState().then((s) => {
  state = s;
  renderAll();
  showTab(location.hash.slice(1) || "home");
});

window.addEventListener("focus", async () => {
  // Permissions can change while the window is in the background.
  if (state) {
    state.status = (await api.getState()).status;
    renderHome();
  }
});

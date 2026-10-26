import { hasDescription, parseContactInput } from "../core/contact-input";
import { findMentionedContacts } from "../core/contacts";
import { TYPING_WPM, formatDuration, lastDays, localDay, streak, timeSavedMs, topApps, wpm } from "../core/stats";
import { CATEGORY_LABELS, STYLES } from "../core/style";
import type { AppApi, AppSnapshot } from "../shared/api";
import type { Contact, Settings, StyleCategory, StyleId, UpdateState } from "../shared/types";
import { ghostSvg } from "./ghost";
import { watchFlowInput } from "./flow-input";
import { Recorder } from "./recorder";
import { Talk, type TalkView } from "./talk";
import { applyTheme } from "./theme";

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

export function toast(message: string, error = false) {
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
  if (tab === "usage" && state) renderUsage();
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

  const checks = isWeb
    ? [
        { ok: status.aiReady, title: "Wispr Max server", hint: "Writes with Claude. Nothing to set up; this turns green when it's reachable.", action: "" },
        { ok: Boolean(settings.profile.name), title: "About you", hint: "Your name and sign-off, so Max writes as you.", action: `<button class="btn small" data-go="profile">Fill in</button>` },
        { ok: contacts.length > 0, title: "Contacts", hint: "Paste a LinkedIn link or a number; Max knows who's who.", action: `<button class="btn small" data-go="contacts">Add</button>` },
      ]
    : [
        { ok: status.aiReady, title: "Claude", hint: "Uses the Wispr Max server, or your own key in Settings.", action: `<button class="btn small" data-go="settings">Settings</button>` },
        ...(settings.voiceInput === "flow"
          ? []
          : [{ ok: status.sttReady, title: "Speech-to-text key", hint: "AssemblyAI, Groq or OpenAI.", action: `<button class="btn small" data-go="settings">Add key</button>` }]),
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
  $("sidebar-status").innerHTML = isWeb
    ? line(status.aiReady, status.aiReady ? "Claude connected" : "Server unreachable") + line(true, "Voice: Wispr Flow or your mic")
    : line(status.aiReady, status.aiReady ? "Claude connected" : "Claude not connected") +
      line(status.sttReady || settings.voiceInput === "flow", settings.voiceInput === "flow" ? "Voice: Wispr Flow" : status.sttReady ? "Voice ready" : "Voice key missing");
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
      <div>${
        isWeb
          ? "Nothing here yet. Click the box above, hold your Wispr Flow key and tell Max what to write."
          : `Nothing here yet. Press <span class="keys">${keyCaps(state.settings.maxHotkey)}</span> in any app and start talking.`
      }</div></div>`;
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
  renderUsage();
});

// ---------- talk to Max (Home) ----------
//
// Voice first: talk with Wispr Flow into the box (Flow types, Max takes it from
// there), click the ghost to use the microphone where there's no Flow, or type.
// The conversation itself lives in Talk, shared with the web's floating ghost.

export const isWeb = document.body.classList.contains("web");
const talkGhost = $("talk-ghost");
const talkArt = $("talk-ghost-art");
const talkOutput = $("talk-output");
const talkInput = $<HTMLInputElement>("talk-input");
const TALK_HINT = $("talk-hint").textContent ?? "";
let lookAround: number | undefined;

export const talk = new Talk(api, () => state, {
  app: isWeb ? "Wispr Max on the web" : "Wispr Max",
  browserSpeech: isWeb,
  onError: (message) => toast(errorText(new Error(message)), true),
});

/** On the desktop with Wispr Flow, Flow does the listening; elsewhere the ghost's mic does. */
const flowTypes = () => !isWeb && state?.settings.voiceInput === "flow";

function renderTalk(v: TalkView) {
  talkGhost.dataset.state = v.status;
  $("talk-title").textContent = v.title;
  $("talk-title").classList.toggle("bubble-q", v.status === "asking");
  $("talk-hint").textContent =
    v.status === "listening" && v.live ? `“${v.live}”`
    : v.status === "asking" ? "Max needs one thing first. Answer with Wispr Flow in the box below, or type it."
    : TALK_HINT;
  talkInput.placeholder =
    v.status === "asking" ? "Hold your Flow key and answer, or type it" : "Hold your Flow key and talk here, or type, then Enter";

  clearInterval(lookAround);
  talkArt.dataset.eyes = v.status === "done" ? "happy" : v.status === "asking" ? "right" : "center";
  if (v.status === "thinking") {
    let left = false;
    lookAround = window.setInterval(() => (talkArt.dataset.eyes = (left = !left) ? "left" : "right"), 420);
  }

  $("talk-result").classList.toggle("hidden", !v.showResult);
  const heard = v.answer ? `“${esc(v.heard)}” · you said: “${esc(v.answer)}”` : `“${esc(v.heard)}”`;
  $("talk-meta").innerHTML =
    v.intent && !v.answer
      ? `${heard} · heard as <b>${v.intent === "command" ? "a request to Max" : "dictation"}</b>` +
        `<span class="by">${v.decidedBy === "rules" ? "decided instantly" : "decided by Claude"}</span>`
      : heard;
  $("talk-email").classList.toggle("hidden", !v.draft);
  $("talk-draft").classList.toggle("hidden", !v.draft);
  if (v.draft) {
    $("talk-to").textContent = v.draft.to;
    $("talk-subject").textContent = v.draft.subject || "(no subject)";
  }
  talkOutput.textContent = v.output;
  talkOutput.classList.toggle("streaming", v.streaming);
}
talk.onChange(renderTalk);

watchFlowInput(talkInput, (text) => void talk.submit(text));

talkGhost.addEventListener("click", () => {
  if (flowTypes()) {
    // Flow types into whatever has focus: give it the box.
    talkInput.focus();
    toast("Hold your Wispr Flow key and talk");
    return;
  }
  void talk.toggleVoice();
});
$("talk-copy").addEventListener("click", async () => {
  await talk.copy();
  toast("Copied");
});
$("talk-draft").addEventListener("click", () => void talk.openDraft());

// ---------- usage ----------

/** "2026-10-25" → a local date (new Date("2026-10-25") would be UTC midnight). */
const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** A round axis maximum: 120 → 150, 870 → 1000. */
function niceMax(n: number) {
  if (n <= 10) return 10;
  const step = 10 ** Math.floor(Math.log10(n));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * step).find((v) => v >= n)!;
}

function renderUsage() {
  const { stats, settings } = state;
  const empty = !stats.sessions;
  $("usage-empty").classList.toggle("hidden", !empty);
  $("usage-body").classList.toggle("hidden", empty);
  if (empty) {
    paintGhosts($("usage-empty"));
    return;
  }

  const saved = formatDuration(timeSavedMs(stats.words, stats.ms));
  const speed = wpm(stats.words, stats.ms);
  const days = streak(stats.days);
  const tile = (value: string, label: string, note = "") =>
    `<div class="tile"><div class="tile-value">${esc(value)}</div><div class="tile-label">${esc(label)}</div>${note ? `<div class="tile-note">${esc(note)}</div>` : ""}</div>`;
  $("usage-tiles").innerHTML =
    tile(stats.words.toLocaleString(), "words written") +
    tile(saved, "time saved", `vs typing at ${TYPING_WPM} wpm`) +
    tile(String(speed), "words per minute") +
    tile(String(days), days === 1 ? "day streak" : "day streak") +
    tile(stats.maxSessions.toLocaleString(), "things Max wrote");

  renderUsageChart();

  const hbars = (rows: { label: string; value: number }[], unit: string) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.length
      ? rows
          .map(
            (r) => `<div class="hbar"><span class="hbar-label">${esc(r.label)}</span>
              <span class="hbar-track"><span class="hbar-fill" style="width:${(r.value / max) * 100}%"></span></span>
              <span class="hbar-value">${r.value.toLocaleString()} ${esc(unit)}</span></div>`,
          )
          .join("")
      : `<p class="muted small">Nothing yet.</p>`;
  };
  $("usage-apps").innerHTML = hbars(
    topApps(stats.apps, 5).map((a) => ({ label: a.app, value: a.words })),
    "words",
  );
  $("usage-modes").innerHTML = hbars(
    [
      { label: "Dictation", value: stats.sessions - stats.maxSessions },
      { label: "Max wrote it", value: stats.maxSessions },
    ],
    "times",
  );

  // The shareable card has fixed colours: it's an image, not part of the theme.
  const name = settings.profile.name || "I";
  $("usage-card").innerHTML = `
    <span class="ghost-slot uc-ghost" data-eyes="happy" data-ghost></span>
    <div class="uc-body">
      <div class="uc-kicker">${esc(name === "I" ? "My" : `${name.split(" ")[0]}'s`)} Wispr Max</div>
      <div class="uc-big">${stats.words.toLocaleString()} <span>words, said not typed</span></div>
      <div class="uc-row">
        <span><b>${speed}</b> wpm</span>
        <span><b>${esc(saved)}</b> saved</span>
        <span><b>${days}</b>-day streak</span>
      </div>
      <div class="uc-foot">#NoHandsChallenge · built by voice</div>
    </div>`;
  paintGhosts($("usage-card"));
}

function renderUsageChart() {
  const data = lastDays(state.stats.daily ?? {}, 14);
  const el = $("usage-chart");
  const width = Math.max(320, el.clientWidth || 720);
  const height = 210;
  const m = { top: 12, right: 8, bottom: 26, left: 40 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.words)));
  const slot = innerW / data.length;
  const barW = Math.min(28, slot * 0.6);
  const y = (v: number) => m.top + innerH - (v / max) * innerH;
  const label = (day: string, i: number) =>
    i === data.length - 1 ? "Today" : parseDay(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const grid = [0, max / 2, max]
    .map(
      (v) => `<line class="grid" x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString()}</text>`,
    )
    .join("");
  const bars = data
    .map((d, i) => {
      const x = m.left + i * slot + (slot - barW) / 2;
      const h = (d.words / max) * innerH;
      const r = Math.min(4, h / 2, barW / 2);
      // Rounded at the data end, square on the baseline.
      const bar = h > 0
        ? `<path class="bar" d="M${x},${m.top + innerH} V${y(d.words) + r} Q${x},${y(d.words)} ${x + r},${y(d.words)} H${x + barW - r} Q${x + barW},${y(d.words)} ${x + barW},${y(d.words) + r} V${m.top + innerH} Z"/>`
        : "";
      const showLabel = (data.length - 1 - i) % 2 === 0;
      return `<g class="col" data-i="${i}">
        ${bar}
        <rect class="hit" x="${m.left + i * slot}" y="${m.top}" width="${slot}" height="${innerH}"/>
        ${showLabel ? `<text class="axis" x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${esc(label(d.day, i))}</text>` : ""}
      </g>`;
    })
    .join("");

  el.setAttribute("aria-label", `Words per day for the last ${data.length} days`);
  el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${bars}</svg><div class="chart-tip" hidden></div>`;

  const tip = el.querySelector<HTMLElement>(".chart-tip")!;
  el.querySelectorAll<SVGGElement>(".col").forEach((col) => {
    col.addEventListener("mouseenter", () => {
      const i = Number(col.dataset.i);
      const d = data[i];
      el.querySelectorAll(".col").forEach((c) => c.classList.toggle("active", c === col));
      tip.innerHTML = `<b>${d.words.toLocaleString()} words</b><span>${esc(parseDay(d.day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</span>`;
      tip.hidden = false;
      const cx = m.left + i * slot + slot / 2;
      tip.style.left = `${Math.min(Math.max(cx, 70), width - 70)}px`;
      tip.style.top = `${Math.max(0, y(d.words) - 52)}px`;
    });
    col.addEventListener("mouseleave", () => {
      col.classList.remove("active");
      tip.hidden = true;
    });
  });

  $("usage-table").innerHTML =
    `<thead><tr><th>Day</th><th>Words</th></tr></thead><tbody>` +
    data
      .map((d, i) => `<tr><td>${esc(label(d.day, i))}</td><td>${d.words.toLocaleString()}</td></tr>`)
      .join("") +
    `</tbody>`;
}

window.addEventListener("resize", () => {
  if (state?.stats.sessions && $("tab-usage").classList.contains("active")) renderUsageChart();
});

async function captureCard(action: "copy" | "save") {
  const r = $("usage-card").getBoundingClientRect();
  const done = await api.captureCard({ x: r.x, y: r.y, width: r.width, height: r.height }, action);
  if (done) toast(action === "copy" ? "Card copied. Paste it into your post." : "Card saved");
}
$("card-copy").addEventListener("click", () => void captureCard("copy"));
$("card-save").addEventListener("click", () => void captureCard("save"));

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
    else if (el.type === "radio") el.checked = el.value === s[el.name];
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
  if (state.settings.voiceInput === "flow") {
    $("hk-dictate").textContent = "Wispr Flow handles dictation";
    $("hk-dictate").className = "hk-status";
  }
  const watch = state.status.flowHistory;
  $("flow-watch").textContent = watch?.message ?? "";
  $("flow-watch").style.color = watch ? `var(--${watch.ok ? "ok" : "warn"})` : "";
}

function syncProvider() {
  const provider = (settingsForm.elements.namedItem("sttProvider") as HTMLSelectElement).value;
  settingsForm
    .querySelectorAll<HTMLElement>("[data-provider]")
    .forEach((el) => el.classList.toggle("hidden", el.dataset.provider !== provider));
}

(settingsForm.elements.namedItem("sttProvider") as HTMLSelectElement).addEventListener("change", syncProvider);

// The theme switches as soon as you pick one.
settingsForm.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((radio) =>
  radio.addEventListener("change", () => void save({ theme: radio.value as Settings["theme"] })),
);

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
    if (!el.name || (el.type === "radio" && !el.checked)) continue;
    patch[el.name] =
      el.type === "checkbox" ? el.checked
      : el.classList.contains("hotkey") ? el.dataset.acc
      : el.value.trim();
  }
  await save(patch as Partial<Settings>);
  const { dictate, max } = state.status.hotkeys;
  toast(dictate && max ? "Settings saved" : "Saved, but a hotkey couldn't be registered", !(dictate && max));
});

// ---------- updates ----------

function renderUpdate(update: UpdateState = state.update) {
  state.update = update;
  const working = ["checking", "downloading", "installing"].includes(update.status);
  $("upd-version").textContent = `Version ${update.current}`;
  $("upd-message").textContent =
    update.message ??
    (update.kind === "source"
      ? "You're running from a git clone; updates come straight from GitHub."
      : update.kind === "release"
        ? "Updates come from GitHub Releases."
        : update.kind === "web"
          ? "New versions download in the background; press Update to switch."
          : "");
  const button = $<HTMLButtonElement>("upd-button");
  button.disabled = working;
  button.classList.toggle("primary", update.status === "available");
  button.textContent =
    update.status === "available" ? "Update now"
    : update.status === "checking" ? "Checking…"
    : working ? "Updating…"
    : "Check for updates";
  $("upd-side").classList.toggle("hidden", update.status !== "available");
}

$("upd-button").addEventListener("click", async () => {
  renderUpdate(state.update.status === "available" ? await api.installUpdate() : await api.checkForUpdates());
});
api.onUpdate((update) => renderUpdate(update));

// ---------- boot ----------

function renderAll() {
  applyTheme(state.settings.theme);
  renderHome();
  renderFeed();
  renderUsage();
  renderDictionary();
  renderSnippets();
  renderStyle();
  renderContacts();
  renderProfile();
  renderSettings();
  renderUpdate();
  // The web's floating ghost follows the settings too.
  document.dispatchEvent(new CustomEvent("wispr:state", { detail: state }));
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

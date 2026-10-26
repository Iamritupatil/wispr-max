import { toBlob } from "html-to-image";
import { SAMPLE_CONTACTS, mergeContacts, newId, parseContactsFile } from "../src/core/contacts";
import { draftUrl } from "../src/core/email";
import { buildVocabulary } from "../src/core/prompts";
import { RemoteWriter, remoteTranscribe } from "../src/core/remote";
import * as service from "../src/core/service";
import { addUse, emptyStats } from "../src/core/stats";
import { countWords } from "../src/core/text";
import type { AppApi, AppSnapshot, ComposeRequest } from "../src/shared/api";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { AppStatus, Contact, HistoryEntry, Settings, Stats } from "../src/shared/types";
import { checkForUpdates, installUpdate, onUpdate, updateState } from "./pwa";
import { grabScreen } from "./screen";
import { applyTheme } from "../src/renderer/theme";

// The browser version of the app's bridge (window.wispr). Everything personal
// (contacts, profile, history, usage) stays in this browser; writing goes
// through the Wispr Max server, which holds the API key.

const KEYS = { settings: "wm.settings", contacts: "wm.contacts", history: "wm.history", stats: "wm.stats" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the app still works for this visit.
  }
}

const stored = load<Partial<Settings>>(KEYS.settings, {});
let settings: Settings = {
  ...DEFAULT_SETTINGS,
  ...stored,
  profile: { ...DEFAULT_SETTINGS.profile, ...stored.profile },
  styles: { ...DEFAULT_SETTINGS.styles, ...stored.styles },
};
let contacts = load<Contact[]>(KEYS.contacts, []);
let history = load<HistoryEntry[]>(KEYS.history, []);
let stats: Stats = { ...emptyStats(), ...load<Partial<Stats>>(KEYS.stats, {}) };

applyTheme(settings.theme);

const writer = new RemoteWriter(""); // same origin: /api/write
let health: Promise<{ ai: boolean }> | null = null;
const serverHealth = () =>
  (health ??= fetch("/api/health")
    .then((r) => r.json() as Promise<{ ai: boolean }>)
    .catch(() => ({ ai: false })));

const textListeners = new Set<(delta: string | null) => void>();
const historyListeners = new Set<(u: { history: HistoryEntry[]; stats: Stats }) => void>();
const stream = {
  onText: (d: string) => textListeners.forEach((l) => l(d)),
  onRestart: () => textListeners.forEach((l) => l(null)),
};

async function status(): Promise<AppStatus> {
  const { ai } = await serverHealth();
  return { platform: "web", accessibilityTrusted: true, hotkeys: { dictate: true, max: true }, aiReady: ai, sttReady: true };
}

async function snapshot(): Promise<AppSnapshot> {
  return { settings, contacts, history, stats, status: await status(), update: updateState() };
}

function writeRequest(req: ComposeRequest): service.WriteRequest {
  return {
    instruction: req.instruction,
    context: { app: req.app, windowTitle: req.windowTitle, selection: req.selection },
    profile: settings.profile,
    contacts,
    snippets: settings.snippets,
    dictionary: settings.dictionary,
    styles: settings.styles,
    emailDraft: req.emailDraft,
    clarifications: req.clarifications,
    // A shared tab or window lets Max read the conversation, like the desktop app does.
    screenshot: grabScreen(),
  };
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

const api: AppApi = {
  getState: snapshot,

  async saveSettings(patch) {
    settings = { ...settings, ...patch, profile: { ...settings.profile, ...patch.profile } };
    save(KEYS.settings, settings);
    return snapshot();
  },

  async saveContact(contact) {
    const c = { ...contact, id: contact.id || newId() };
    const i = contacts.findIndex((x) => x.id === c.id);
    contacts = i >= 0 ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c];
    save(KEYS.contacts, contacts);
    return contacts;
  },

  async deleteContact(id) {
    contacts = contacts.filter((c) => c.id !== id);
    save(KEYS.contacts, contacts);
    return contacts;
  },

  async importContacts() {
    const file = await pickFile(".csv,.vcf");
    if (!file) return null;
    const parsed = parseContactsFile(file.name, await file.text());
    contacts = mergeContacts(contacts, parsed);
    save(KEYS.contacts, contacts);
    return { contacts, imported: parsed.length };
  },

  async addSampleContacts() {
    contacts = mergeContacts(contacts, SAMPLE_CONTACTS.map((c) => ({ ...c, id: newId() })));
    save(KEYS.contacts, contacts);
    return contacts;
  },

  async quickAddContacts(text) {
    // Profile pages can't be read from a browser, so the server does it.
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = (await res.json()) as { contacts?: Contact[]; error?: string };
    if (!res.ok || !body.contacts) throw new Error(body.error ?? "Couldn't add that contact.");
    for (const c of body.contacts) contacts = mergeContacts(contacts, [c]);
    save(KEYS.contacts, contacts);
    const added = body.contacts.map(
      (c) => contacts.find((x) => x.id === c.id || (c.email && x.email === c.email) || x.name === c.name) ?? c,
    );
    return { contacts, added };
  },

  async clearHistory() {
    history = [];
    save(KEYS.history, history);
    return history;
  },

  async recordUse(use) {
    const { spokenMs, ...entry } = use;
    history = [{ id: newId(), at: Date.now(), ...entry }, ...history].slice(0, 100);
    stats = addUse(stats, countWords(use.output), spokenMs, { mode: use.mode, app: use.draftTo ? "Email draft" : use.app });
    save(KEYS.history, history);
    save(KEYS.stats, stats);
    historyListeners.forEach((l) => l({ history, stats }));
  },

  compose: (req) => service.compose(writer, writeRequest(req), stream),
  smart: (req) => service.smart(writer, writeRequest(req), stream),
  onComposeText: (cb) => void textListeners.add(cb),

  // Browsers without built-in speech recognition (Firefox) send the recording to the server.
  transcribe: (audio) =>
    remoteTranscribe("", audio.data, audio.mime, {
      language: settings.language || undefined,
      vocabulary: buildVocabulary(contacts, settings.dictionary, settings.profile),
    }),

  requestAccessibility: status,
  copy: (text) => navigator.clipboard.writeText(text),

  async openExternal(url) {
    window.open(url, "_blank", "noopener");
  },

  async openDraft(draft) {
    const url = draftUrl(settings.emailDrafts === "off" ? "gmail" : settings.emailDrafts, draft);
    if (!url) return;
    if (url.startsWith("mailto:")) location.href = url;
    else window.open(url, "_blank", "noopener");
  },

  onHistory: (cb) => void historyListeners.add(cb),
  onNavigate: () => undefined,
  checkForUpdates,
  installUpdate,
  onUpdate,

  async captureCard(_rect, action) {
    const blob = await toBlob(document.getElementById("usage-card")!, { pixelRatio: 2 });
    if (!blob) return false;
    if (action === "copy") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wispr-max-usage.png";
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  },
};

window.wispr = api;

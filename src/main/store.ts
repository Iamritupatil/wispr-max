import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { localDay } from "../core/stats";
import type { Contact, HistoryEntry, Mode, Settings, Stats } from "../shared/types";

export const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
  sttProvider: "assemblyai",
  assemblyaiApiKey: "",
  groqApiKey: "",
  openaiApiKey: "",
  language: "",
  dictateHotkey: "CommandOrControl+Shift+Space",
  maxHotkey: "CommandOrControl+Shift+M",
  polishDictation: true,
  useSelection: true,
  keepResultOnClipboard: true,
  smartIntent: true,
  sounds: true,
  showIdleGhost: true,
  emailDrafts: "gmail",
  styles: { personal: "casual", work: "casual", email: "formal", other: "formal" },
  dictionary: [],
  snippets: [],
  profile: { name: "", role: "", email: "", signature: "", style: "" },
};

const SECRET_KEYS = ["anthropicApiKey", "assemblyaiApiKey", "groqApiKey", "openaiApiKey"] as const;
const HISTORY_LIMIT = 100;

function file(name: string) {
  return path.join(app.getPath("userData"), name);
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const target = file(name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

// API keys are encrypted with the OS keychain when it's available.
function seal(v: string) {
  if (!v || !safeStorage.isEncryptionAvailable()) return v;
  return `enc:${safeStorage.encryptString(v).toString("base64")}`;
}

function unseal(v: string) {
  if (!v?.startsWith("enc:")) return v ?? "";
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
  } catch {
    return "";
  }
}

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>("settings.json", {});
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    profile: { ...DEFAULT_SETTINGS.profile, ...raw.profile },
    styles: { ...DEFAULT_SETTINGS.styles, ...raw.styles },
  };
  if (!Array.isArray(s.dictionary)) s.dictionary = [];
  if (!Array.isArray(s.snippets)) s.snippets = [];
  for (const k of SECRET_KEYS) s[k] = unseal(s[k]);
  return s;
}

/** Keys set in the app win; environment variables fill the gaps (handy for dev). */
export function anthropicKey(s: Settings) {
  return s.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
}

export function sttKey(s: Settings) {
  switch (s.sttProvider) {
    case "assemblyai":
      return s.assemblyaiApiKey || process.env.ASSEMBLYAI_API_KEY || "";
    case "groq":
      return s.groqApiKey || process.env.GROQ_API_KEY || "";
    default:
      return s.openaiApiKey || process.env.OPENAI_API_KEY || "";
  }
}

export function saveSettings(s: Settings) {
  const out = { ...s };
  for (const k of SECRET_KEYS) out[k] = seal(out[k]);
  writeJson("settings.json", out);
}

export function loadContacts(): Contact[] {
  return readJson<Contact[]>("contacts.json", []);
}

export function saveContacts(contacts: Contact[]) {
  writeJson("contacts.json", contacts);
}

export function loadHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>("history.json", []);
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const history = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  writeJson("history.json", history);
  return history;
}

export function clearHistory() {
  writeJson("history.json", []);
}

export function loadStats(): Stats {
  return {
    words: 0,
    ms: 0,
    sessions: 0,
    days: [],
    daily: {},
    apps: {},
    maxSessions: 0,
    ...readJson<Partial<Stats>>("stats.json", {}),
  };
}

export function recordStats(words: number, ms: number, session: { mode: Mode; app?: string }): Stats {
  const stats = loadStats();
  const today = localDay(new Date());
  const isMax = session.mode === "max";
  stats.words += words;
  stats.ms += ms;
  stats.sessions += 1;
  if (isMax) stats.maxSessions += 1;
  if (!stats.days.includes(today)) stats.days = [...stats.days, today].slice(-400);

  const day = (stats.daily[today] ??= { words: 0, ms: 0, sessions: 0, max: 0 });
  day.words += words;
  day.ms += ms;
  day.sessions += 1;
  if (isMax) day.max += 1;
  // Keep a year of daily totals.
  for (const key of Object.keys(stats.daily).sort().slice(0, -400)) delete stats.daily[key];

  const app = session.app?.trim() || "Other";
  stats.apps[app] = (stats.apps[app] ?? 0) + words;

  writeJson("stats.json", stats);
  return stats;
}

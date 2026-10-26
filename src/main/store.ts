import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { addUse, emptyStats } from "../core/stats";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import type { Contact, HistoryEntry, Mode, Settings, Stats } from "../shared/types";

export { DEFAULT_SETTINGS };

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
  return { ...emptyStats(), ...readJson<Partial<Stats>>("stats.json", {}) };
}

export function recordStats(words: number, ms: number, session: { mode: Mode; app?: string }): Stats {
  const stats = addUse(loadStats(), words, ms, session);
  writeJson("stats.json", stats);
  return stats;
}

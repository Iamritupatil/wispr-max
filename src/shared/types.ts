export type Mode = "dictate" | "max";

export type Effort = "low" | "medium" | "high";

export type SttProvider = "assemblyai" | "groq" | "openai";

/** Where the user is writing, for picking a tone (as in Wispr Flow's Styles). */
export type StyleCategory = "personal" | "work" | "email" | "other";

export type StyleId = "formal" | "casual" | "very-casual" | "excited";

/** Where Max opens an email draft when you aren't already in an email app. */
export type EmailDrafts = "gmail" | "outlook" | "mailto" | "off";

export interface DictionaryEntry {
  id: string;
  /** How the word should be spelled, e.g. "Wispr". */
  word: string;
  /** Optional: what the speech model tends to hear instead, e.g. "whisper". */
  heardAs?: string;
}

export interface Snippet {
  id: string;
  /** Spoken cue, e.g. "my calendar link". */
  trigger: string;
  /** Text inserted in its place. */
  text: string;
}

export interface ContactLink {
  /** "LinkedIn", "X", "Instagram", "GitHub", "WhatsApp"… or a site's hostname. */
  platform: string;
  url: string;
  handle?: string;
}

export interface Contact {
  id: string;
  name: string;
  /** Profiles on LinkedIn, X, Instagram, GitHub and so on. */
  links?: ContactLink[];
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  /** How the user knows this person, e.g. "recruiter for my PM interview". */
  relationship?: string;
  notes?: string;
}

export interface Profile {
  name: string;
  role: string;
  email: string;
  signature: string;
  /** Free-form writing preferences, e.g. "concise, warm, no emojis". */
  style: string;
}

export interface Settings {
  anthropicApiKey: string;
  model: string;
  effort: Effort;
  sttProvider: SttProvider;
  assemblyaiApiKey: string;
  groqApiKey: string;
  openaiApiKey: string;
  /** ISO-639-1 code, or "" for auto-detect. */
  language: string;
  dictateHotkey: string;
  maxHotkey: string;
  /** Run dictation through Claude to strip fillers and fix punctuation. */
  polishDictation: boolean;
  /** Copy the current selection and give it to Max as context. */
  useSelection: boolean;
  /** Leave Max output on the clipboard so it can be pasted again. */
  keepResultOnClipboard: boolean;
  /**
   * The Dictate hotkey notices when you're asking Max to write something
   * ("Hey Max…", "can you write an email to…") and hands it over.
   */
  smartIntent: boolean;
  /** Play soft chimes when recording starts and stops. */
  sounds: boolean;
  /** Keep the little ghost floating on screen between sessions. */
  showIdleGhost: boolean;
  emailDrafts: EmailDrafts;
  styles: Record<StyleCategory, StyleId>;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  profile: Profile;
  /** Where the user dragged the ghost (centre of its bar, screen coordinates). */
  ghostAnchor?: { x: number; y: number };
}

export interface DayStats {
  words: number;
  ms: number;
  sessions: number;
  /** Sessions where Max wrote something (not plain dictation). */
  max: number;
}

export interface Stats {
  words: number;
  /** Total speaking time. */
  ms: number;
  sessions: number;
  /** Days with at least one session, as YYYY-MM-DD. */
  days: string[];
  /** Per-day totals, keyed YYYY-MM-DD. */
  daily: Record<string, DayStats>;
  /** Words written per app. */
  apps: Record<string, number>;
  /** Sessions where Max wrote something. */
  maxSessions: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  mode: Mode;
  transcript: string;
  output: string;
  app?: string;
  /** Set when Max opened an email draft instead of typing. */
  draftTo?: string;
  /** Dictate-hotkey sessions that smart intent routed to Max. */
  autoDetected?: boolean;
}

export type Phase =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "writing"
  | "done"
  | "error";

export interface OverlayState {
  phase: Phase;
  mode: Mode;
  /** Streaming or final output text. */
  text?: string;
  transcript?: string;
  /** Contacts Max matched in the instruction, for the "To:" chip. */
  contacts?: string[];
  /** Max's question while it waits for an answer. */
  question?: string;
  app?: string;
  message?: string;
}

export type OverlayCommand =
  | { type: "start"; mode: Mode; sounds: boolean }
  | { type: "stop"; sounds: boolean }
  | { type: "cancel" };

export interface AudioPayload {
  data: Uint8Array;
  mime: string;
  durationMs: number;
}

export interface AppStatus {
  platform: NodeJS.Platform;
  accessibilityTrusted: boolean;
  hotkeys: { dictate: boolean; max: boolean };
  aiReady: boolean;
  sttReady: boolean;
}

export interface FocusContext {
  app?: string;
  windowTitle?: string;
  selection?: string;
}

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
  /** Light, dark, or whatever the system uses. */
  theme: "system" | "light" | "dark";
  emailDrafts: EmailDrafts;
  styles: Record<StyleCategory, StyleId>;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  profile: Profile;
  /** Where the user dragged the ghost (centre of its bar, screen coordinates). */
  ghostAnchor?: { x: number; y: number };
  /** What closing the main window does, once the user has chosen. */
  closeBehavior?: "background" | "quit";
  /**
   * Where your words come from. "flow": Wispr Flow types them into Max's bubble
   * (no speech key needed). "built-in": Max records and transcribes itself.
   */
  voiceInput: "flow" | "built-in";
  /** Send a screenshot with each request so Max can read the conversation you're in. */
  screenContext: boolean;
  /**
   * Max listens along while you use Wispr Flow as usual: "Hey Max, …" hands the
   * dictation to Max; other requests get a quick offer. Reads Flow's local history.
   */
  listenToFlow: boolean;
  /** Where "Hey Max, tell Claude to…" runs (empty: the home folder). */
  agentFolder: string;
  /** The ghost speaks its answers out loud. */
  talkBack: boolean;
  /** Formal Max, or Gen Z Max: memes, GIFs and attitude. */
  vibe: "formal" | "genz";
  /** Gen Z mode: how often Max peeks at the screen and says something first. */
  chaos: "off" | "chill" | "normal" | "unhinged";
  /** Where Gen Z Max finds the user's meme clips (empty: Documents/Wispr Max memes). */
  memeFolder: string;
  /** Hold to talk, double-tap for hands-free. */
  talkKey: "alt" | "right-alt" | "shift" | "ctrl" | "off";
  /** Unused: Max no longer presses Flow keys (Ctrl+Win+Alt is Flow's Command Mode). */
  flowKey: "ctrl-win" | "caps" | "self";
  /** Set once Gen Z mode was switched on by default (so a later choice of Formal sticks). */
  vibeSet?: boolean;
  /** A request heard in a Flow dictation (without "Hey Max"): write it at once, or offer first. */
  flowRequests: "auto" | "ask";
  /** The hosted Wispr Max server, used when there's no Anthropic key on this computer. */
  cloudUrl: string;
}

export interface DayStats {
  words: number;
  ms: number;
  sessions: number;
  /** Sessions where Max wrote something (not plain dictation). */
  max: number;
}

export interface UpdateState {
  status: "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";
  /** This version (from package.json). */
  current: string;
  /** The newer version, or the latest change's title when running from source. */
  latest?: string;
  /** Installer from GitHub Releases, a git clone, a downloaded zip, or the web app. */
  kind: "release" | "source" | "none" | "web";
  message?: string;
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
  /** Max noticed a request in a Wispr Flow dictation and offers to write it. */
  | "offer"
  | "done"
  | "error";

export interface OverlayState {
  phase: Phase;
  mode: Mode;
  /** Just the ghost (and its question bubble): no card, no bar. Used with Wispr Flow. */
  minimal?: boolean;
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
  | { type: "cancel" }
  /** Appear in a puff of smoke. */
  | { type: "appear" }
  /** Say it out loud. */
  | { type: "say"; text: string; desi?: boolean }
  /** Show a reaction GIF over the ghost for a while (null hides it). */
  | { type: "gif"; url: string | null }
  /** Play one of the user's meme clips (audio out loud; images and videos over the ghost). */
  | { type: "clip"; url: string; kind: "audio" | "image" | "video" };

export interface AudioPayload {
  data: Uint8Array;
  mime: string;
  durationMs: number;
}

export interface AppStatus {
  platform: NodeJS.Platform | "web";
  accessibilityTrusted: boolean;
  hotkeys: { dictate: boolean; max: boolean };
  aiReady: boolean;
  sttReady: boolean;
  /** Listening along with Wispr Flow: whether it's running, and why not. */
  flowListen?: { ok: boolean; message: string };
}

/** What was on screen when the user asked: the conversation they're replying in, usually. */
export interface Screenshot {
  /** Base64, without a data: prefix. */
  data: string;
  mediaType: "image/jpeg" | "image/png";
  /** Pixel size, so Claude can point at exact spots. */
  width?: number;
  height?: number;
}

export interface FocusContext {
  app?: string;
  windowTitle?: string;
  selection?: string;
  screenshot?: Screenshot;
}

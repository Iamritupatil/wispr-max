import type {
  AppStatus,
  AudioPayload,
  Contact,
  HistoryEntry,
  OverlayCommand,
  OverlayState,
  Settings,
  Stats,
  UpdateState,
} from "./types";

/** Exposed to the overlay window as `window.overlay`. */
export interface OverlayApi {
  onCommand(cb: (cmd: OverlayCommand) => void): void;
  onState(cb: (state: OverlayState) => void): void;
  sendAudio(payload: AudioPayload): void;
  sendError(message: string): void;
  onLayout(cb: (layout: OverlayLayout) => void): void;
  /** Turn mouse events on while the pointer is over the ghost. */
  setInteractive(on: boolean): void;
  dragStart(): void;
  /** Pointer movement since the drag started, in screen pixels. */
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  click(): void;
  /** Right-click menu on the ghost: open, hide, reset position, quit. */
  menu(): void;
}

export interface OverlayLayout {
  /** The card opens below the ghost because it's near the top of the screen. */
  flip: boolean;
  /** Horizontal offset of the ghost from the window's centre. */
  offsetX: number;
}

export interface AppSnapshot {
  settings: Settings;
  contacts: Contact[];
  history: HistoryEntry[];
  stats: Stats;
  status: AppStatus;
  update: UpdateState;
}

export interface ComposeRequest {
  instruction: string;
  app?: string;
  windowTitle?: string;
  selection?: string;
  /** Ask for a subject line too, to open the result as an email draft. */
  emailDraft?: boolean;
  /** Max's earlier questions and the user's answers. */
  clarifications?: { question: string; answer: string }[];
}

/** What Max wrote, or the one question it needs answered first. */
export interface Written {
  text: string;
  question?: string;
}

export interface SmartResult {
  intent: "dictation" | "command";
  /** Whether the instant rules or Claude made the call. */
  decidedBy: "rules" | "claude";
  reason: string;
  text: string;
  /** Max needs one detail before writing; `text` is empty. */
  question?: string;
}

/** Exposed to the main window as `window.wispr`. */
export interface AppApi {
  getState(): Promise<AppSnapshot>;
  saveSettings(patch: Partial<Settings>): Promise<AppSnapshot>;
  saveContact(contact: Contact): Promise<Contact[]>;
  deleteContact(id: string): Promise<Contact[]>;
  importContacts(): Promise<{ contacts: Contact[]; imported: number } | null>;
  addSampleContacts(): Promise<Contact[]>;
  /** One-paste contacts: links, numbers, emails or a sentence, one contact per line. */
  quickAddContacts(text: string): Promise<{ contacts: Contact[]; added: Contact[] }>;
  clearHistory(): Promise<HistoryEntry[]>;
  compose(req: ComposeRequest): Promise<Written>;
  /** Dictation or request? Decides like the Dictate hotkey, then writes. */
  smart(req: ComposeRequest): Promise<SmartResult>;
  /** Streams Max output; `null` means discard what was shown and start over. */
  onComposeText(cb: (delta: string | null) => void): void;
  transcribe(audio: AudioPayload): Promise<string>;
  requestAccessibility(): Promise<AppStatus>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openDraft(draft: { to: string; subject: string; body: string }): Promise<void>;
  onHistory(cb: (update: { history: HistoryEntry[]; stats: Stats }) => void): void;
  onNavigate(cb: (tab: string) => void): void;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdate(cb: (state: UpdateState) => void): void;
  /** Captures part of the window (the usage card) to the clipboard or a PNG file. */
  captureCard(rect: { x: number; y: number; width: number; height: number }, action: "copy" | "save"): Promise<boolean>;
}

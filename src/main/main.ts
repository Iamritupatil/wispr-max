import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { Writer, isAbort } from "../core/ai";
import {
  SAMPLE_CONTACTS,
  findMentionedContacts,
  mergeContacts,
  newId,
  parseContactsFile,
} from "../core/contacts";
import { draftUrl, emailRecipient, parseEmailDraft } from "../core/email";
import { guessIntent } from "../core/intent";
import { buildVocabulary } from "../core/prompts";
import { transcribe } from "../core/stt";
import { toneFor } from "../core/style";
import { applyDictionary, countWords, expandSnippets } from "../core/text";
import type { AppSnapshot, ComposeRequest, SmartResult } from "../shared/api";
import type {
  AppStatus,
  AudioPayload,
  Contact,
  FocusContext,
  Mode,
  OverlayCommand,
  OverlayState,
  Settings,
} from "../shared/types";
import * as store from "./store";
import { activeApp, insertText, isTerminal, readSelection } from "./system";

const isMac = process.platform === "darwin";
const OVERLAY_SIZE = { width: 560, height: 320 };
// Where the ghost's bar sits inside the overlay window (see overlay.css): its centre is
// this far from the window's bottom edge, or from the top edge when the card opens below.
const BAR_FROM_BOTTOM = 38;
const BAR_FROM_TOP = 30;
const EDGE_MARGIN = 24;
const MAX_RECORDING_MS = 3 * 60_000;
const MIN_RECORDING_MS = 350;
const ASSETS = path.join(__dirname, "..", "assets");

let settings: Settings;
let contacts: Contact[];
let overlay: BrowserWindow;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let hideTimer: NodeJS.Timeout | undefined;
const hotkeys = { dictate: false, max: false };

// ---------- one hotkey press → one session ----------

interface Session {
  mode: Mode;
  phase: "recording" | "processing";
  abort: AbortController;
  context: Promise<FocusContext>;
  timer?: NodeJS.Timeout;
}

let current: Session | null = null;

function onHotkey(mode: Mode) {
  if (!current) startSession(mode);
  else if (current.phase === "recording") stopRecording(current);
  // While a result is being written, hotkeys are ignored; Esc cancels.
}

function startSession(mode: Mode) {
  const s: Session = {
    mode,
    phase: "recording",
    abort: new AbortController(),
    context: gatherContext(mode),
  };
  current = s;
  s.timer = setTimeout(() => current === s && s.phase === "recording" && stopRecording(s), MAX_RECORDING_MS);
  try {
    globalShortcut.register("Escape", cancelSession);
  } catch {
    // Esc is a convenience; the session still works without it.
  }
  showOverlay();
  setOverlay({ phase: "listening", mode });
  sendOverlay({ type: "start", mode, sounds: settings.sounds });
}

/** Learns where the text is going while the user is still talking. */
async function gatherContext(mode: Mode): Promise<FocusContext> {
  const [appInfo] = await Promise.all([
    activeApp(),
    // Wait for the hotkey's modifiers to be released, or Cmd+C becomes Cmd+Shift+C.
    sleep(350),
  ]);
  let selection = "";
  // Ctrl+C in a terminal interrupts the running program, so never "copy" there.
  if (mode === "max" && settings.useSelection && !isTerminal(appInfo)) {
    selection = await readSelection();
  }
  return { ...appInfo, selection: selection || undefined };
}

function stopRecording(s: Session) {
  s.phase = "processing";
  clearTimeout(s.timer);
  setOverlay({ phase: "transcribing", mode: s.mode });
  sendOverlay({ type: "stop", sounds: settings.sounds });
}

function cancelSession() {
  if (!current) return;
  current.abort.abort();
  sendOverlay({ type: "cancel" });
  endSession(current, 0);
}

function endSession(s: Session, settleMs: number) {
  if (current !== s) return;
  clearTimeout(s.timer);
  current = null;
  globalShortcut.unregister("Escape");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (current) return;
    // Between sessions the ghost either floats quietly or disappears.
    setOverlay({ phase: "idle", mode: "dictate" });
    if (!settings.showIdleGhost) overlay.hide();
  }, settleMs);
}

function failSession(s: Session, message: string) {
  if (current !== s) return;
  setOverlay({ phase: "error", mode: s.mode, message });
  endSession(s, 3500);
}

interface Result {
  output: string;
  /** Recipient when Max opened an email draft instead of typing. */
  draftTo?: string;
}

async function handleAudio(s: Session, audio: AudioPayload) {
  try {
    if (audio.durationMs < MIN_RECORDING_MS) {
      endSession(s, 0); // A double tap, not a recording.
      return;
    }
    const vocabulary = buildVocabulary(contacts, settings.dictionary, settings.profile);
    const raw = await transcribe(
      audio.data,
      audio.mime,
      {
        provider: settings.sttProvider,
        apiKey: store.sttKey(settings),
        language: settings.language || undefined,
        vocabulary,
      },
      s.abort.signal,
    );
    if (current !== s) return;
    const transcript = applyDictionary(raw, settings.dictionary);
    if (!transcript) return failSession(s, "Didn't catch that. Try again?");

    const context = await s.context;
    if (current !== s) return;

    // Max hotkey: always a request. Dictate hotkey: dictation, unless smart intent
    // hears a request to Max. Clear cases are decided instantly by rules; ambiguous
    // ones go to Claude, which decides and writes in a single call.
    let mode = s.mode;
    let instruction = transcript;
    let result: Result;
    if (mode === "max") {
      result = await writeWithMax(s, instruction, context);
    } else {
      const guess = settings.smartIntent ? guessIntent(transcript, contacts) : null;
      if (guess?.intent === "command") {
        mode = "max";
        instruction = guess.instruction;
        result = await writeWithMax(s, instruction, context);
      } else if (guess?.intent === "unsure" && store.anthropicKey(settings)) {
        ({ mode, result } = await smartDictation(s, transcript, context, vocabulary));
      } else {
        result = { output: await polishDictation(s, transcript, context, vocabulary) };
      }
    }
    if (current !== s) return;
    if (!result.output) return failSession(s, "Nothing to insert.");

    let message: string | undefined;
    let settleMs = mode === "max" ? 2600 : 1200;
    if (result.draftTo) {
      message = `Opened an email draft to ${result.draftTo}`;
    } else {
      const pasted = await insertText(result.output, mode === "max" && settings.keepResultOnClipboard);
      if (!pasted) {
        message = `Copied to clipboard. Press ${isMac ? "Cmd" : "Ctrl"}+V to paste${isMac ? " (allow Accessibility to auto-paste)" : ""}.`;
        settleMs = 5000;
      }
    }

    const history = store.addHistory({
      id: newId(),
      at: Date.now(),
      mode,
      transcript: instruction,
      output: result.output,
      app: context.app,
      draftTo: result.draftTo,
      autoDetected: s.mode === "dictate" && mode === "max",
    });
    const stats = store.recordStats(countWords(result.output), audio.durationMs);
    mainWindow?.webContents.send("app:history", { history, stats });
    setOverlay({ phase: "done", mode, text: result.output, transcript: instruction, app: context.app, message });
    endSession(s, settleMs);
  } catch (err) {
    if (isAbort(err) || current !== s) return;
    failSession(s, err instanceof Error ? err.message : String(err));
  }
}

/** Dictation: polish (if enabled), then swap snippet cues for their text. */
async function polishDictation(s: Session, transcript: string, context: FocusContext, vocabulary: string[]) {
  let text = transcript;
  if (settings.polishDictation && store.anthropicKey(settings)) {
    setOverlay({ phase: "thinking", mode: "dictate", transcript });
    const { guide } = toneFor(settings.styles, context);
    text = await writer()
      .polish(transcript, context, vocabulary, guide, s.abort.signal)
      .catch((err) => {
        if (isAbort(err)) throw err;
        return transcript; // Raw dictation beats no dictation.
      });
  }
  return expandSnippets(text, settings.snippets);
}

/** "Email Priya…" from outside an email app opens a ready-to-send draft instead of typing. */
function draftRecipient(instruction: string, mentioned: Contact[], context: FocusContext) {
  return settings.emailDrafts !== "off" && toneFor(settings.styles, context).category !== "email" && !context.selection
    ? emailRecipient(instruction, mentioned)
    : null;
}

/** Style guide for this request: an email draft is written in the email style. */
function toneGuide(context: FocusContext, draftTo: string | null) {
  return toneFor(settings.styles, draftTo ? { app: "Mail" } : context).guide;
}

async function openDraftIfAny(s: Session, output: string, draftTo: string | null): Promise<Result> {
  if (!draftTo || current !== s) return { output };
  const url = draftUrl(settings.emailDrafts, { to: draftTo, ...parseEmailDraft(output) });
  if (url) await shell.openExternal(url);
  return { output, draftTo };
}

async function writeWithMax(s: Session, instruction: string, context: FocusContext): Promise<Result> {
  const mentioned = findMentionedContacts(instruction, contacts);
  const draftTo = draftRecipient(instruction, mentioned, context);
  const base: OverlayState = {
    phase: "thinking",
    mode: "max",
    transcript: instruction,
    contacts: mentioned.slice(0, 3).map((c) => c.name),
    app: draftTo ? "New email draft" : context.app,
  };
  setOverlay(base);
  let text = "";
  const output = await writer().compose(
    {
      instruction,
      context,
      profile: settings.profile,
      contacts,
      snippets: settings.snippets,
      options: { tone: toneGuide(context, draftTo), emailDraft: Boolean(draftTo) },
    },
    {
      onText: (delta) => {
        text += delta;
        setOverlay({ ...base, phase: "writing", text });
      },
      onRestart: () => {
        text = "";
      },
    },
    s.abort.signal,
  );
  return openDraftIfAny(s, output, draftTo);
}

/** Ambiguous speech on the Dictate hotkey: Claude decides and writes in one pass. */
async function smartDictation(
  s: Session,
  transcript: string,
  context: FocusContext,
  vocabulary: string[],
): Promise<{ mode: Mode; result: Result }> {
  const mentioned = findMentionedContacts(transcript, contacts);
  const draftTo = draftRecipient(transcript, mentioned, context);
  setOverlay({ phase: "thinking", mode: "dictate", transcript });
  let mode: Mode = "dictate";
  let text = "";
  const res = await writer().auto(
    {
      instruction: transcript,
      context,
      profile: settings.profile,
      contacts,
      snippets: settings.snippets,
      vocabulary,
      options: { tone: toneGuide(context, draftTo), emailDraft: Boolean(draftTo) },
    },
    {
      onDecision: (intent) => {
        mode = intent === "command" ? "max" : "dictate";
      },
      onText: (delta) => {
        text += delta;
        // Max's card only appears once Claude has decided this is a request.
        if (mode === "max") {
          setOverlay({
            phase: "writing",
            mode,
            text,
            transcript,
            contacts: mentioned.slice(0, 3).map((c) => c.name),
            app: draftTo ? "New email draft" : context.app,
          });
        }
      },
      onRestart: () => {
        text = "";
      },
    },
    s.abort.signal,
  );
  if (res.intent === "dictation") {
    return { mode: "dictate", result: { output: expandSnippets(res.text, settings.snippets) } };
  }
  return { mode: "max", result: await openDraftIfAny(s, res.text, draftTo) };
}

function writer() {
  return new Writer({
    apiKey: store.anthropicKey(settings),
    model: settings.model,
    effort: settings.effort,
  });
}

// ---------- overlay window ----------

function createOverlay() {
  overlay = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through everywhere except the ghost: the renderer turns mouse events on
  // while the pointer is over it (forwarded moves tell it when that happens).
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, "renderer", "overlay.html"));
  overlay.webContents.once("did-finish-load", syncIdleGhost);
  screen.on("display-metrics-changed", () => !current && syncIdleGhost());
}

/** Shows or hides the little ghost that floats on screen between sessions. */
function syncIdleGhost() {
  if (current) return;
  setOverlay({ phase: "idle", mode: "dictate" });
  if (settings.showIdleGhost) showOverlay();
  else overlay.hide();
}

// ---------- where the ghost lives ----------
//
// The ghost's position is its "anchor": the centre of its bar, in screen
// coordinates. The overlay window is laid out around it so Max's card always
// fits on screen: above the ghost normally, below it near the top of a
// screen, and shifted sideways near the left or right edge.

type Point = { x: number; y: number };

function defaultAnchor(): Point {
  const { workArea: wa } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return { x: wa.x + wa.width / 2, y: wa.y + wa.height - 16 - BAR_FROM_BOTTOM };
}

/** Keeps the ghost fully on whichever screen it's on. */
function clampAnchor(p: Point): Point {
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) });
  return {
    x: Math.min(Math.max(p.x, wa.x + EDGE_MARGIN), wa.x + wa.width - EDGE_MARGIN),
    y: Math.min(Math.max(p.y, wa.y + EDGE_MARGIN), wa.y + wa.height - EDGE_MARGIN),
  };
}

function currentAnchor(): Point {
  const saved = settings.ghostAnchor;
  const onScreen =
    saved &&
    screen.getAllDisplays().some(({ workArea: wa }) =>
      saved.x >= wa.x && saved.x <= wa.x + wa.width && saved.y >= wa.y && saved.y <= wa.y + wa.height,
    );
  return onScreen ? saved : defaultAnchor();
}

function placeOverlay(anchor: Point) {
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  const { width, height } = OVERLAY_SIZE;
  const flip = anchor.y - wa.y < height - BAR_FROM_BOTTOM; // no room for the card above
  const x = Math.round(Math.min(Math.max(anchor.x - width / 2, wa.x), wa.x + wa.width - width));
  const y = Math.round(flip ? anchor.y - BAR_FROM_TOP : anchor.y - (height - BAR_FROM_BOTTOM));
  overlay.setBounds({ x, y, width, height });
  overlay.webContents.send("overlay:layout", {
    flip,
    // How far the ghost sits from the window's centre when the window is pushed in from an edge.
    offsetX: Math.round(anchor.x - (x + width / 2)),
  });
}

function showOverlay() {
  clearTimeout(hideTimer);
  placeOverlay(currentAnchor());
  overlay.showInactive(); // Never steal focus from the app being typed into.
}

function setOverlay(state: OverlayState) {
  overlay.webContents.send("overlay:state", state);
}

function sendOverlay(cmd: OverlayCommand) {
  overlay.webContents.send("overlay:command", cmd);
}

// ---------- main window & tray ----------

function openMainWindow(tab?: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (tab) mainWindow.webContents.send("app:navigate", tab);
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: "Wispr Max",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e0c15" : "#f7f6fb",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    icon: path.join(ASSETS, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-app.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "app.html"), tab ? { hash: tab } : undefined);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, isMac ? "trayTemplate.png" : "tray.png"));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Wispr Max");
  refreshTrayMenu();
  tray.on("click", () => !isMac && openMainWindow());
}

function refreshTrayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Dictate — ${pretty(settings.dictateHotkey)}`, click: () => onHotkey("dictate") },
      { label: `Max — ${pretty(settings.maxHotkey)}`, click: () => onHotkey("max") },
      { type: "separator" },
      { label: "Open Wispr Max", click: () => openMainWindow() },
      { label: "Contacts", click: () => openMainWindow("contacts") },
      { label: "Settings", click: () => openMainWindow("settings") },
      {
        label: "Reset ghost position",
        click: () => {
          settings.ghostAnchor = undefined;
          store.saveSettings(settings);
          if (overlay.isVisible()) placeOverlay(currentAnchor());
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function pretty(accelerator: string) {
  return accelerator.replace("CommandOrControl", isMac ? "Cmd" : "Ctrl");
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const register = (accelerator: string, mode: Mode) => {
    try {
      return globalShortcut.register(accelerator, () => onHotkey(mode));
    } catch {
      return false; // Malformed accelerator.
    }
  };
  hotkeys.dictate = register(settings.dictateHotkey, "dictate");
  hotkeys.max = settings.maxHotkey !== settings.dictateHotkey && register(settings.maxHotkey, "max");
  if (current) globalShortcut.register("Escape", cancelSession);
  refreshTrayMenu();
}

function status(): AppStatus {
  return {
    platform: process.platform,
    accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    hotkeys: { ...hotkeys },
    aiReady: Boolean(store.anthropicKey(settings)),
    sttReady: Boolean(store.sttKey(settings)),
  };
}

function snapshot(): AppSnapshot {
  return { settings, contacts, history: store.loadHistory(), stats: store.loadStats(), status: status() };
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.on("overlay:audio", (_e, audio: AudioPayload) => {
    if (current?.phase === "processing") void handleAudio(current, audio);
  });
  // Dragging and clicking the ghost.
  let dragFrom: Point | null = null;
  ipcMain.on("overlay:interactive", (_e, on: boolean) => {
    overlay.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on("overlay:drag-start", () => {
    dragFrom = currentAnchor();
  });
  ipcMain.on("overlay:drag", (_e, dx: number, dy: number) => {
    if (!dragFrom) return;
    settings.ghostAnchor = clampAnchor({ x: dragFrom.x + dx, y: dragFrom.y + dy });
    placeOverlay(settings.ghostAnchor);
  });
  ipcMain.on("overlay:drag-end", () => {
    if (dragFrom && settings.ghostAnchor) store.saveSettings(settings);
    dragFrom = null;
  });
  // A click on the ghost starts or stops dictation, like pressing the hotkey.
  ipcMain.on("overlay:click", () => onHotkey("dictate"));

  ipcMain.on("overlay:error", (_e, message: string) => {
    if (current) failSession(current, message);
  });

  ipcMain.handle("app:get-state", () => snapshot());

  ipcMain.handle("app:save-settings", (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch, profile: { ...settings.profile, ...patch.profile } };
    store.saveSettings(settings);
    registerHotkeys();
    syncIdleGhost();
    return snapshot();
  });

  ipcMain.handle("app:save-contact", (_e, contact: Contact) => {
    const c = { ...contact, id: contact.id || newId() };
    const i = contacts.findIndex((x) => x.id === c.id);
    contacts = i >= 0 ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c];
    store.saveContacts(contacts);
    return contacts;
  });

  ipcMain.handle("app:delete-contact", (_e, id: string) => {
    contacts = contacts.filter((c) => c.id !== id);
    store.saveContacts(contacts);
    return contacts;
  });

  ipcMain.handle("app:import-contacts", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Import contacts",
      properties: ["openFile"],
      filters: [{ name: "Contacts", extensions: ["csv", "vcf"] }],
    };
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const parsed = parseContactsFile(file, await fs.readFile(file, "utf8"));
    contacts = mergeContacts(contacts, parsed);
    store.saveContacts(contacts);
    return { contacts, imported: parsed.length };
  });

  ipcMain.handle("app:add-samples", () => {
    contacts = mergeContacts(
      contacts,
      SAMPLE_CONTACTS.map((c) => ({ ...c, id: newId() })),
    );
    store.saveContacts(contacts);
    return contacts;
  });

  ipcMain.handle("app:clear-history", () => {
    store.clearHistory();
    return [];
  });

  ipcMain.handle("app:compose", (e, req: ComposeRequest) => {
    const context = { app: req.app, windowTitle: req.windowTitle, selection: req.selection };
    return writer().compose(
      {
        instruction: req.instruction,
        context,
        profile: settings.profile,
        contacts,
        snippets: settings.snippets,
        options: { tone: toneFor(settings.styles, context).guide, emailDraft: req.emailDraft },
      },
      {
        onText: (delta) => e.sender.send("app:compose-text", delta),
        onRestart: () => e.sender.send("app:compose-text", null),
      },
    );
  });

  // Try Max in "auto-detect" mode: the same routing as the Dictate hotkey.
  ipcMain.handle("app:smart", async (e, req: ComposeRequest): Promise<SmartResult> => {
    const context = { app: req.app, windowTitle: req.windowTitle, selection: req.selection };
    const vocabulary = buildVocabulary(contacts, settings.dictionary, settings.profile);
    const guess = guessIntent(req.instruction, contacts);
    const stream = {
      onText: (delta: string) => e.sender.send("app:compose-text", delta),
      onRestart: () => e.sender.send("app:compose-text", null),
    };
    const input = {
      context,
      profile: settings.profile,
      contacts,
      snippets: settings.snippets,
      options: { tone: toneFor(settings.styles, context).guide, emailDraft: req.emailDraft },
    };
    if (guess.intent === "dictation") {
      const text = await writer().polish(req.instruction, context, vocabulary, input.options.tone);
      return { intent: "dictation", decidedBy: "rules", reason: guess.reason, text: expandSnippets(text, settings.snippets) };
    }
    if (guess.intent === "command") {
      const text = await writer().compose({ ...input, instruction: guess.instruction }, stream);
      return { intent: "command", decidedBy: "rules", reason: guess.reason, text };
    }
    const res = await writer().auto({ ...input, instruction: req.instruction, vocabulary }, stream);
    return {
      intent: res.intent,
      decidedBy: "claude",
      reason: res.intent === "command" ? "Claude heard a request to write" : "Claude heard dictation",
      text: res.intent === "dictation" ? expandSnippets(res.text, settings.snippets) : res.text,
    };
  });

  ipcMain.handle("app:open-draft", (_e, draft: { to: string; subject: string; body: string }) => {
    const url = draftUrl(settings.emailDrafts === "off" ? "gmail" : settings.emailDrafts, draft);
    if (url) return shell.openExternal(url);
  });

  ipcMain.handle("app:transcribe", (_e, audio: AudioPayload) =>
    transcribe(audio.data, audio.mime, {
      provider: settings.sttProvider,
      apiKey: store.sttKey(settings),
      language: settings.language || undefined,
      vocabulary: buildVocabulary(contacts, settings.dictionary, settings.profile),
    }),
  );

  ipcMain.handle("app:request-accessibility", () => {
    if (isMac) systemPreferences.isTrustedAccessibilityClient(true);
    return status();
  });

  ipcMain.handle("app:copy", (_e, text: string) => clipboard.writeText(text));

  ipcMain.handle("app:open-external", (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
}

// ---------- lifecycle ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openMainWindow());

  app.whenReady().then(async () => {
    settings = store.loadSettings();
    contacts = store.loadContacts();

    // The overlay and the playground record from the default mic.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === "media" || permission === "clipboard-sanitized-write"),
    );
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
    if (isMac) await systemPreferences.askForMediaAccess("microphone").catch(() => false);

    registerIpc();
    createOverlay();
    createTray();
    registerHotkeys();
    if (!process.argv.includes("--hidden")) openMainWindow();

    app.on("activate", () => openMainWindow());
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Keep running in the tray when every window is closed.
  app.on("window-all-closed", () => undefined);
}

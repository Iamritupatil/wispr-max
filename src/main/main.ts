import {
  BrowserWindow,
  ClipboardItem,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { Writer, type WriterLike, isAbort } from "../core/ai";
import { RemoteWriter } from "../core/remote";
import { CLOUD_URL } from "../shared/defaults";
import {
  SAMPLE_CONTACTS,
  findMentionedContacts,
  mergeContacts,
  newId,
  parseContactsFile,
} from "../core/contacts";
import { draftUrl, emailRecipient, parseEmailDraft } from "../core/email";
import { calledMax, guessIntent } from "../core/intent";
import { buildVocabulary, type Clarification, MAX_QUESTIONS } from "../core/prompts";
import { transcribe } from "../core/stt";
import { toneFor } from "../core/style";
import { applyDictionary, countWords, expandSnippets } from "../core/text";
import * as service from "../core/service";
import type { WriteRequest } from "../core/service";
import type { AppSnapshot, ComposeRequest, UseRecord } from "../shared/api";
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
import { type FlowDictation, FlowHistoryWatcher } from "./flow-history";
import { activeApp, captureScreen, insertText, isTerminal, readSelection, undoLastEdit } from "./system";
import { checkForUpdates, installUpdate, onUpdateState, updateState } from "./updater";

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
/** The Wispr Flow bubble: a small focused box Flow types into. */
let listenWin: BrowserWindow;
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
  /** Set while Max waits for the answer to a question it asked. */
  asking?: { mode: Mode; instruction: string; question: string; clarifications: Clarification[] };
  /** Speaking time across the request and any answers, for stats. */
  spokenMs: number;
  context: Promise<FocusContext>;
  timer?: NodeJS.Timeout;
}

let current: Session | null = null;

const flowMode = () => settings.voiceInput === "flow";

function onHotkey(mode: Mode) {
  if (!current && offer) return void acceptOffer();
  if (!current) startSession(flowMode() ? "max" : mode);
  else if (current.phase === "recording") stopRecording(current);
  // While a result is being written, hotkeys are ignored; Esc cancels.
}

function startSession(mode: Mode) {
  const s: Session = {
    mode,
    phase: "recording",
    abort: new AbortController(),
    context: gatherContext(mode),
    spokenMs: 0,
  };
  current = s;
  s.timer = setTimeout(() => current === s && s.phase === "recording" && stopRecording(s), MAX_RECORDING_MS);
  try {
    globalShortcut.register("Escape", cancelSession);
  } catch {
    // Esc is a convenience; the session still works without it.
  }
  showOverlay();
  if (flowMode()) {
    // Wispr Flow does the listening: open the bubble once the screen has been
    // read (so the bubble isn't in the screenshot), and Flow types into it.
    setOverlay({ phase: "listening", mode, message: "Talk with Wispr Flow" });
    void s.context.then(() => current === s && s.phase === "recording" && openListen());
    return;
  }
  setOverlay({ phase: "listening", mode });
  sendOverlay({ type: "start", mode, sounds: settings.sounds });
}

// ---------- listening along with Wispr Flow ----------
//
// Use Flow exactly as usual, with your own Flow key. Max reads each dictation
// from Flow's history the moment it lands: "Hey Max, …" (or "Max, …") is
// handed straight to Max, which takes back what Flow typed, reads the screen
// and types the finished message instead. Other requests get a quick offer.

const flowWatcher = new FlowHistoryWatcher();
let flowWatch = { ok: false, message: "" };
let offer: { text: string; timer: NodeJS.Timeout } | null = null;

function syncFlowWatcher() {
  if (settings.listenToFlow) flowWatch = flowWatcher.start(onFlowDictation);
  else {
    flowWatcher.stop();
    flowWatch = { ok: false, message: "" };
  }
}

/** A new Flow dictation: called Max? Take over. A request? Offer to write it. */
function onFlowDictation(d: FlowDictation) {
  // Flow typing into Max's own bubble is already a Max session.
  if (current) return;
  const called = calledMax(d.text);
  if (called) {
    clearOffer();
    return void takeOverFromFlow(called);
  }
  const guess = guessIntent(d.text, contacts);
  if (guess.intent !== "command") return;
  if (offer) clearTimeout(offer.timer);
  offer = { text: guess.instruction, timer: setTimeout(clearOffer, 9000) };
  showOverlay();
  setOverlay({
    phase: "offer",
    mode: "max",
    transcript: guess.instruction,
    message: `Want me to write that? Click me or press ${pretty(settings.maxHotkey)}`,
  });
}

function clearOffer() {
  if (!offer) return;
  clearTimeout(offer.timer);
  offer = null;
  if (current) return;
  setOverlay({ phase: "idle", mode: "dictate" });
  if (!settings.showIdleGhost) overlay.hide();
}

async function acceptOffer() {
  if (!offer) return;
  const text = offer.text;
  clearOffer();
  await takeOverFromFlow(text);
}

/** Flow may still be inserting the text when its history updates. */
const FLOW_SETTLE_MS = 350;

/** Takes back what Flow typed (it was an instruction, not the message) and writes the real thing. */
async function takeOverFromFlow(instruction: string) {
  const s: Session = { mode: "max", phase: "processing", abort: new AbortController(), context: Promise.resolve({}), spokenMs: 0 };
  current = s;
  showOverlay();
  setOverlay({ phase: "thinking", mode: "max", transcript: instruction });
  await sleep(FLOW_SETTLE_MS);
  if (current !== s) return;
  // If this fails, Flow's words stay and Max's text lands after them: untidy, not lost.
  await undoLastEdit().catch(() => undefined);
  // Read the screen once Flow's text is gone, so Max sees the conversation as it was.
  s.context = gatherContext("max");
  try {
    globalShortcut.register("Escape", cancelSession);
  } catch {
    // optional
  }
  void handleTranscript(s, instruction);
}

/** Learns where the text is going while the user is still talking. */
async function gatherContext(mode: Mode): Promise<FocusContext> {
  const [appInfo, screenshot] = await Promise.all([
    activeApp(),
    mode === "max" && settings.screenContext ? captureScreen() : undefined,
    // Wait for the hotkey's modifiers to be released, or Cmd+C becomes Cmd+Shift+C.
    sleep(250),
  ]);
  let selection = "";
  // Ctrl+C in a terminal interrupts the running program, so never "copy" there.
  if (mode === "max" && settings.useSelection && !isTerminal(appInfo)) {
    selection = await readSelection();
  }
  return { ...appInfo, selection: selection || undefined, screenshot };
}

function stopRecording(s: Session) {
  if (flowMode()) {
    // Pressed again while the bubble is open: send what Flow has typed so far.
    listenWin.webContents.send("listen:submit-now");
    return;
  }
  s.phase = "processing";
  clearTimeout(s.timer);
  setOverlay({ phase: "transcribing", mode: s.mode });
  sendOverlay({ type: "stop", sounds: settings.sounds });
}

function cancelSession() {
  closeListen();
  if (!current) return;
  current.abort.abort();
  sendOverlay({ type: "cancel" });
  endSession(current, 0);
}

function endSession(s: Session, settleMs: number) {
  if (current !== s) return;
  clearTimeout(s.timer);
  closeListen();
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
  /** Max needs one detail before it can write. */
  question?: string;
}

/** The ghost asks its question and listens for the answer; the next stop writes. */
function askUser(s: Session, mode: Mode, instruction: string, question: string, clarifications: Clarification[]) {
  if (clarifications.length >= MAX_QUESTIONS) {
    return failSession(s, `Max still needs to know: ${question}`);
  }
  s.asking = { mode, instruction, question, clarifications };
  s.phase = "recording";
  clearTimeout(s.timer);
  s.timer = setTimeout(() => current === s && s.phase === "recording" && stopRecording(s), MAX_RECORDING_MS);
  // With Flow, the question shows in the bubble Flow types into; otherwise on the ghost.
  setOverlay({
    phase: "listening",
    mode: "max",
    question: flowMode() ? undefined : question,
    transcript: instruction,
    message: flowMode() ? "Answer with Wispr Flow" : undefined,
  });
  if (flowMode()) openListen(question);
  else sendOverlay({ type: "start", mode: "max", sounds: settings.sounds });
}

async function handleAudio(s: Session, audio: AudioPayload) {
  try {
    if (audio.durationMs < MIN_RECORDING_MS) {
      endSession(s, 0); // A double tap, not a recording.
      return;
    }
    s.spokenMs += audio.durationMs;
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
    await handleTranscript(s, applyDictionary(raw, settings.dictionary));
  } catch (err) {
    if (isAbort(err) || current !== s) return;
    failSession(s, err instanceof Error ? err.message : String(err));
  }
}

/** Everything after the words are known, whether from Wispr Flow or the built-in mic. */
async function handleTranscript(s: Session, transcript: string) {
  try {
    if (!transcript) return failSession(s, "Didn't catch that. Try again?");
    setOverlay({ phase: "thinking", mode: s.mode, transcript });
    const vocabulary = buildVocabulary(contacts, settings.dictionary, settings.profile);
    const context = await s.context;
    if (current !== s) return;

    // Max hotkey: always a request. Dictate hotkey: dictation, unless smart intent
    // hears a request to Max. Clear cases are decided instantly by rules; ambiguous
    // ones go to Claude, which decides and writes in a single call.
    let mode = s.mode;
    let instruction = transcript;
    let clarifications: Clarification[] = [];
    let result: Result;
    if (s.asking) {
      // This recording was the answer to Max's question.
      ({ mode, instruction } = s.asking);
      clarifications = [...s.asking.clarifications, { question: s.asking.question, answer: transcript }];
      s.asking = undefined;
      result = await writeWithMax(s, instruction, context, clarifications);
    } else if (mode === "max") {
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
    if (result.question) return askUser(s, mode, instruction, result.question, clarifications);
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

    recordUse({
      mode,
      transcript: instruction,
      output: result.output,
      app: context.app,
      draftTo: result.draftTo,
      autoDetected: s.mode === "dictate" && mode === "max",
      spokenMs: s.spokenMs,
    });
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

async function writeWithMax(
  s: Session,
  instruction: string,
  context: FocusContext,
  clarifications: Clarification[] = [],
): Promise<Result> {
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
  const { screenshot, ...textContext } = context;
  const written = await writer().compose(
    {
      instruction,
      context: textContext,
      screenshot,
      profile: settings.profile,
      contacts,
      snippets: settings.snippets,
      options: { tone: toneGuide(context, draftTo), emailDraft: Boolean(draftTo), clarifications },
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
  if (written.question) return { output: "", question: written.question };
  return openDraftIfAny(s, written.text, draftTo);
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
  const { screenshot, ...textContext } = context;
  const res = await writer().auto(
    {
      instruction: transcript,
      context: textContext,
      screenshot,
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
  if (res.question) return { mode: "max", result: { output: "", question: res.question } };
  if (res.intent === "dictation") {
    return { mode: "dictate", result: { output: expandSnippets(res.text, settings.snippets) } };
  }
  return { mode: "max", result: await openDraftIfAny(s, res.text, draftTo) };
}

/** Adds a finished session to History and Usage, and tells the main window. */
function recordUse(use: UseRecord) {
  const { spokenMs, ...entry } = use;
  const history = store.addHistory({ id: newId(), at: Date.now(), ...entry });
  const stats = store.recordStats(countWords(use.output), spokenMs, {
    mode: use.mode,
    app: use.draftTo ? "Email draft" : use.app,
  });
  mainWindow?.webContents.send("app:history", { history, stats });
}

/** Claude directly with your own key, or the hosted Wispr Max server (no key needed). */
function writer(): WriterLike {
  const apiKey = store.anthropicKey(settings);
  if (!apiKey) return new RemoteWriter(settings.cloudUrl || CLOUD_URL, (url, init) => net.fetch(url, init));
  return new Writer({ apiKey, model: settings.model, effort: settings.effort });
}

// ---------- the Wispr Flow bubble ----------

const LISTEN_SIZE = { width: 460, height: 170 };

function createListenWindow() {
  listenWin = new BrowserWindow({
    ...LISTEN_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-listen.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  listenWin.setAlwaysOnTop(true, "screen-saver");
  listenWin.loadFile(path.join(__dirname, "renderer", "listen.html"));
}

/** Opens the bubble just above the ghost (below it near the top of a screen) and focuses it for Flow. */
function openListen(question?: string) {
  const anchor = currentAnchor();
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  const below = anchor.y - wa.y < LISTEN_SIZE.height + 60;
  const x = Math.round(Math.min(Math.max(anchor.x - LISTEN_SIZE.width / 2, wa.x), wa.x + wa.width - LISTEN_SIZE.width));
  const y = Math.round(below ? anchor.y + 30 : anchor.y - 34 - LISTEN_SIZE.height);
  listenWin.setBounds({ x, y, ...LISTEN_SIZE });
  listenWin.show();
  listenWin.focus();
  listenWin.webContents.send("listen:open", { question, below });
}

/** Hides the bubble and hands focus back to the app the user was typing in. */
function closeListen() {
  if (!listenWin?.isVisible()) return;
  listenWin.hide();
  if (isMac) {
    // On macOS hiding a window doesn't reactivate the previous app; hiding ours does.
    app.hide();
    setTimeout(() => overlay.showInactive(), 80);
  }
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
  mainWindow.on("close", (e) => void onMainWindowClose(e));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, isMac ? "trayTemplate.png" : "tray.png"));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Wispr Max");
  refreshTrayMenu();
  tray.on("click", () => !isMac && openMainWindow());
}

function resetGhostPosition() {
  settings.ghostAnchor = undefined;
  store.saveSettings(settings);
  if (overlay.isVisible()) placeOverlay(currentAnchor());
}

/** Closing the window: keep running for the ghost and hotkeys, or quit. Asks once. */
async function onMainWindowClose(e: Electron.Event) {
  if (quitting || !mainWindow) return;
  e.preventDefault();
  let choice = settings.closeBehavior;
  if (!choice) {
    const res = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Keep running", "Quit Wispr Max"],
      defaultId: 0,
      cancelId: 0,
      message: "Keep Wispr Max running in the background?",
      detail:
        "The ghost and your hotkeys keep working in other apps. Quit any time by right-clicking the ghost or the tray icon.",
      checkboxLabel: "Don't ask again",
    });
    choice = res.response === 1 ? "quit" : "background";
    if (res.checkboxChecked) {
      settings.closeBehavior = choice;
      store.saveSettings(settings);
    }
  }
  if (choice === "quit") app.quit();
  else mainWindow.hide();
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
        label: settings.showIdleGhost ? "Hide the ghost" : "Show the ghost",
        click: () => {
          settings.showIdleGhost = !settings.showIdleGhost;
          store.saveSettings(settings);
          syncIdleGhost();
          refreshTrayMenu();
        },
      },
      { label: "Reset ghost position", click: resetGhostPosition },
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
  // With Wispr Flow, Flow owns dictation: only Max's hotkey is needed.
  hotkeys.dictate = flowMode() ? true : register(settings.dictateHotkey, "dictate");
  hotkeys.max = settings.maxHotkey !== settings.dictateHotkey && register(settings.maxHotkey, "max");
  if (current) globalShortcut.register("Escape", cancelSession);
  refreshTrayMenu();
}

function status(): AppStatus {
  return {
    platform: process.platform,
    accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    hotkeys: { ...hotkeys },
    // Without a key, Max uses the hosted server; with Wispr Flow, Flow does the listening.
    aiReady: true,
    sttReady: flowMode() || Boolean(store.sttKey(settings)),
    flowListen: settings.listenToFlow ? flowWatch : undefined,
  };
}

function snapshot(): AppSnapshot {
  return {
    settings,
    contacts,
    history: store.loadHistory(),
    stats: store.loadStats(),
    status: status(),
    update: updateState(),
  };
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.on("overlay:audio", (_e, audio: AudioPayload) => {
    if (current?.phase === "processing") void handleAudio(current, audio);
  });
  // What Wispr Flow typed into the bubble.
  ipcMain.on("listen:submit", (_e, text: string) => {
    const s = current;
    if (!s || s.phase !== "recording") return;
    closeListen();
    if (!text.trim()) return cancelSession();
    s.phase = "processing";
    clearTimeout(s.timer);
    void handleTranscript(s, applyDictionary(text.trim(), settings.dictionary));
  });
  ipcMain.on("listen:cancel", () => cancelSession());

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
  ipcMain.on("overlay:click", () => onHotkey(flowMode() ? "max" : "dictate"));
  ipcMain.on("overlay:menu", () => {
    Menu.buildFromTemplate([
      { label: "Open Wispr Max", click: () => openMainWindow() },
      {
        label: "Hide the ghost",
        click: () => {
          settings.showIdleGhost = false;
          store.saveSettings(settings);
          syncIdleGhost();
        },
      },
      { label: "Reset position", click: resetGhostPosition },
      { type: "separator" },
      { label: "Quit Wispr Max", click: () => app.quit() },
    ]).popup({ window: overlay });
  });

  ipcMain.on("overlay:error", (_e, message: string) => {
    if (current) failSession(current, message);
  });

  ipcMain.handle("app:get-state", () => snapshot());

  ipcMain.handle("app:save-settings", (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch, profile: { ...settings.profile, ...patch.profile } };
    if (!settings.closeBehavior) delete settings.closeBehavior; // "Ask me"
    store.saveSettings(settings);
    nativeTheme.themeSource = settings.theme;
    registerHotkeys();
    syncIdleGhost();
    syncFlowWatcher();
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

  // One-paste contacts: links, numbers, emails or a sentence; one contact per line.
  ipcMain.handle("app:quick-add", async (_e, text: string) => {
    const added = await service.quickContacts(text, {
      writer: writer(),
      fetch: net.fetch,
    });
    for (const c of added) contacts = mergeContacts(contacts, [c]);
    store.saveContacts(contacts);
    // Return the stored versions (a pasted link may have merged into an existing contact).
    const saved = added.map(
      (c) => contacts.find((x) => x.id === c.id || (c.email && x.email === c.email) || x.name === c.name) ?? c,
    );
    return { contacts, added: saved };
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

  const writeRequest = (req: ComposeRequest): WriteRequest => ({
    instruction: req.instruction,
    context: { app: req.app, windowTitle: req.windowTitle, selection: req.selection },
    profile: settings.profile,
    contacts,
    snippets: settings.snippets,
    dictionary: settings.dictionary,
    styles: settings.styles,
    emailDraft: req.emailDraft,
    clarifications: req.clarifications,
  });
  const streamTo = (sender: Electron.WebContents) => ({
    onText: (delta: string) => sender.send("app:compose-text", delta),
    onRestart: () => sender.send("app:compose-text", null),
  });
  ipcMain.handle("app:compose", (e, req: ComposeRequest) => service.compose(writer(), writeRequest(req), streamTo(e.sender)));
  // Talking on the Home screen: the same routing as the Dictate hotkey.
  ipcMain.handle("app:smart", (e, req: ComposeRequest) => service.smart(writer(), writeRequest(req), streamTo(e.sender)));
  ipcMain.handle("app:record-use", (_e, use: UseRecord) => recordUse(use));

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

  ipcMain.handle("app:check-updates", () => checkForUpdates());
  ipcMain.handle("app:install-update", () => installUpdate());
  onUpdateState((s) => mainWindow?.webContents.send("app:update", s));

  ipcMain.handle("app:capture-card", async (e, rect: Electron.Rectangle, action: "copy" | "save") => {
    const image = await e.sender.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const png = image.toPNG();
    if (action === "copy") {
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
      return true;
    }
    const options: Electron.SaveDialogOptions = {
      defaultPath: "wispr-max-usage.png",
      filters: [{ name: "PNG image", extensions: ["png"] }],
    };
    const res = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return false;
    await fs.writeFile(res.filePath, png);
    return true;
  });

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
    nativeTheme.themeSource = settings.theme;
    contacts = store.loadContacts();

    // The overlay and the playground record from the default mic.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === "media" || permission === "clipboard-sanitized-write"),
    );
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
    if (isMac) await systemPreferences.askForMediaAccess("microphone").catch(() => false);

    registerIpc();
    createOverlay();
    createListenWindow();
    createTray();
    registerHotkeys();
    syncFlowWatcher();
    if (!process.argv.includes("--hidden")) openMainWindow();

    // Look for a new version quietly after start-up, then every six hours.
    setTimeout(() => void checkForUpdates(), 15_000);
    setInterval(() => void checkForUpdates(), 6 * 60 * 60_000);

    app.on("activate", () => openMainWindow());
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Keep running in the tray when every window is closed.
  app.on("window-all-closed", () => undefined);
}

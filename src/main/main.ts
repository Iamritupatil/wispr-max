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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Writer, type WriterLike, isAbort } from "../core/ai";
import { RemoteWriter, remoteTranscribe } from "../core/remote";
import { CLOUD_URL } from "../shared/defaults";
import {
  SAMPLE_CONTACTS,
  findMentionedContacts,
  mergeContacts,
  newId,
  parseContactsFile,
} from "../core/contacts";
import { draftUrl, emailRecipient, parseEmailDraft } from "../core/email";
import { abuseKind, calledMax, guessIntent, memoryCommand, routeCall } from "../core/intent";
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
import { hookError, hookRunning, nextClick, onEscape, onFlowKey, setTalkKey, stopTalkKey } from "./talk-key";
import { AGENT_LABEL, type AgentName, runAgent, spokenSummary } from "./agent";
import { type Clip, defaultMemeFolder, findClip, listClips } from "./memes";
import type { ReactEvent } from "../core/ai";
import { activeApp, captureScreen, insertText, isTerminal, readSelection, undoLastEdit } from "./system";
import { checkForUpdates, installUpdate, onUpdateState, updateState, updateQuietly } from "./updater";

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
  /** Started from a Wispr Flow dictation: no windows, answers come through Flow too. */
  fromFlow?: boolean;
  /** Listening through Flow while Max's key (Alt) is held: Flow types into Max's own hidden box. */
  heldKey?: boolean;
  /** Hold Alt: Max listens with its own microphone (no Flow involved). */
  ownMic?: boolean;
  /** A walkthrough or a comeback: a new request simply replaces it. */
  interruptible?: boolean;
}

let current: Session | null = null;

const TALK_KEY_LABEL: Record<Settings["talkKey"], string> = { alt: "Alt", "right-alt": "Right Alt", shift: "Shift", ctrl: "Ctrl", off: "Alt" };

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
    armEscape();
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

/** Flow can save one dictation twice (a draft, then the polished text): answer it once. */
let lastHeard = { text: "", at: 0 };
const sameWords = (a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function heardBefore(text: string) {
  const now = sameWords(text);
  const before = lastHeard.text;
  const repeat = Date.now() - lastHeard.at < 30_000 && Boolean(before) && (now === before || now.includes(before) || before.includes(now));
  lastHeard = { text: now, at: Date.now() };
  return repeat;
}

/**
 * A new Flow dictation. Plain Flow (Caps Lock, "Hey Max" or not) is just dictation:
 * Max never touches it. Only after you tap Alt twice does the next dictation go to Max.
 */
function onFlowDictation(d: FlowDictation) {
  if (heardBefore(d.text)) return;
  if (!current?.heldKey) return;
  // Armed, but Flow typed somewhere else (Max's box lost focus): take it back and answer.
  const s = current;
  setTimeout(() => {
    if (current !== s) return;
    closeListen();
    current = null;
    answerMax(calledMax(d.text) ?? d.text, true);
  }, 900);
}

/** You talking with Max: everything said stays as context until Esc. */
const conversation = { open: false, turns: [] as string[] };

function withHistory(text: string) {
  const h = conversation.turns.slice(-10).join("\n");
  return h ? `${text}\n\n(Our conversation so far, oldest first. Stay on this topic:\n${h})` : text;
}

/**
 * Something said to Max: run an agent, a comeback, a walkthrough, or writing.
 * `typed`: Flow typed it into the user's box, so take that back first.
 */
function answerMax(text: string, typed: boolean) {
  const mem = memoryCommand(text);
  if (mem) return rememberOrForget(mem, typed);
  // "Max, roast me": always a meme sound, a GIF and a roast of whatever's on your screen.
  if (/\broast (?:me|this|my)\b/i.test(text)) return void roastMe(text, typed);
  const route = routeCall(text, contacts);
  const said = withHistory(text);
  conversation.open = true;
  conversation.turns.push(`You: ${text}`);
  if (route.kind === "agent") return void agentFromFlow(route.agent, route.task, typed);
  if (route.kind === "vent" || (route.kind === "chat" && genz())) {
    // The right gaali clip, every time: not left to the model's mood.
    const kind = abuseKind(text);
    const clip = kind && { english: "ye-angrezi-gaali-apne-paas-rakh", hindi: "gaali-mat-do-bhai", yell: "chilla-mat-chudail" }[kind];
    return void ventFromFlow(clip ? `${text}\n\n(Play the clip "${clip}" for this, and caption it with a short comeback.)` : said, typed);
  }
  if (route.kind === "write" && guessIntent(text, contacts).intent === "command") {
    void react("command", text);
    return void takeOverFromFlow(route.instruction, typed);
  }
  void guideFromFlow(said, typed);
}

/** "Remember I prefer aisle seats" / "forget my seat thing": kept on this computer, used in every answer. */
async function rememberOrForget(mem: NonNullable<ReturnType<typeof memoryCommand>>, typed: boolean) {
  const s = flowSession();
  if (typed) await takeBack();
  const facts = settings.memory ?? [];
  if (mem.kind === "remember") {
    settings.memory = [...facts.filter((f) => f.toLowerCase() !== mem.fact.toLowerCase()), mem.fact].slice(-50);
  } else {
    const words = mem.about.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    settings.memory = facts.filter((f) => !words.some((w) => f.toLowerCase().includes(w)));
  }
  store.saveSettings(settings);
  ghostSays(s, mem.kind === "remember" ? "Got it, I'll remember that." : facts.length === settings.memory.length ? "I didn't have anything about that." : "Done, forgotten.");
}

async function roastMe(text: string, typed: boolean) {
  const s = flowSession();
  if (typed) await takeBack();
  if (current !== s) return;
  setOverlay({ phase: "thinking", mode: "max" });
  endSession(s, 0);
  await react("command", `${text}\n\n(They asked you to roast them. Look at their screen and roast what you see, savage but affectionate. Never skip; pick a meme sound and a GIF.)`, true, true, true);
}

/** What Max knows about you, for the model. */
function aboutUser() {
  const facts = settings.memory ?? [];
  return facts.length ? `\n<about_user>\n${facts.join("\n")}\n</about_user>` : "";
}

/** A new request while Max is mid-walkthrough: drop the old one quietly. */
function dropCurrent() {
  const s = current;
  if (!s) return;
  s.abort.abort();
  clearTimeout(s.timer);
  sendOverlay({ type: "cancel" });
  closeListen();
  current = null;
}

/** Takes back what Flow just typed. Not on the desktop or a file window, where nothing was typed and Ctrl+Z undoes a file move. */
async function takeBack() {
  await sleep(FLOW_SETTLE_MS);
  const { app: name = "" } = await activeApp().catch(() => ({ app: "" }));
  if (/^(explorer|finder|program manager|wispr)/i.test(name)) return;
  await undoLastEdit().catch(() => undefined);
}

// ---------- Tap Alt twice: Max listens, through Wispr Flow ----------

/** Hold Alt: Max listens with its own mic while you hold it. Nothing goes through Flow or into your app. */
function listenWithOwnMic() {
  if (current && current.fromFlow && current.interruptible === false && !current.asking) return;
  dropCurrent();
  clearOffer();
  const s = flowSession();
  s.phase = "recording";
  s.ownMic = true;
  setOverlay({ phase: "listening", mode: "max", question: "Listening…" });
  sendOverlay({ type: "start", mode: "max", sounds: false }); // also stops Max talking, or the mic hears Max
  s.timer = setTimeout(() => current === s && s.phase === "recording" && ownMicReleased(), MAX_RECORDING_MS);
}

/** Alt up: stop recording; the words come back through overlay:audio. */
function ownMicReleased() {
  const s = current;
  if (!s?.ownMic || s.phase !== "recording") return;
  s.phase = "processing";
  clearTimeout(s.timer);
  setOverlay({ phase: "thinking", mode: "max" });
  sendOverlay({ type: "stop", sounds: false });
}

/**
 * Alt, Alt: the ghost listens and Max's invisible box takes focus. Hold your
 * Flow key as usual: Flow types into Max's box, never into your app. Max never
 * presses Flow's keys itself (Ctrl+Win+Alt is Flow's Command Mode).
 */
function listenThroughFlow() {
  // Tapping Alt twice again while listening: never mind.
  if (current?.heldKey) return cancelSession();
  // Max makes way for you, except an agent that's still working.
  if (current && current.fromFlow && current.interruptible === false && !current.asking) return;
  const asking = current?.asking;
  dropCurrent();
  clearOffer();
  const s = flowSession();
  s.phase = "recording";
  s.heldKey = true;
  s.asking = asking;
  sendOverlay({ type: "cancel" }); // Max stops talking, or Flow would type Max's voice
  setOverlay({ phase: "listening", mode: "max", question: "Listening…" });
  openListen(undefined, true);
  s.timer = setTimeout(() => current === s && s.phase === "recording" && cancelSession(), 30_000);
}

function clearOffer() {
  if (!offer) return;
  clearTimeout(offer.timer);
  offer = null;
  if (current) return;
  setOverlay({ phase: "idle", mode: "dictate" });
  if (!ghostStaysOut()) overlay.hide();
}

async function acceptOffer() {
  if (!offer) return;
  const text = offer.text;
  clearOffer();
  await takeOverFromFlow(text);
}

/** Flow may still be inserting the text when its history updates. */
const FLOW_SETTLE_MS = 200;

/** Takes back what Flow typed (it was an instruction, not the message) and writes the real thing. */
async function takeOverFromFlow(instruction: string, typed = true) {
  const s: Session = { mode: "max", phase: "processing", abort: new AbortController(), context: Promise.resolve({}), spokenMs: 0, fromFlow: true };
  current = s;
  showOverlay();
  setOverlay({ phase: "thinking", mode: "max", transcript: instruction });
  // If this fails, Flow's words stay and Max's text lands after them: untidy, not lost.
  if (typed) await takeBack();
  else await sleep(FLOW_SETTLE_MS); // focus going back to your app
  if (current !== s) return;
  // Read the screen once Flow's text is gone, so Max sees the conversation as it was.
  s.context = gatherContext("max", true);
  try {
    armEscape();
  } catch {
    // optional
  }
  void handleTranscript(s, instruction);
}

/** A Max session started by a Flow dictation, with the ghost up and Esc to cancel. */
function flowSession(): Session {
  const s: Session = { mode: "max", phase: "processing", abort: new AbortController(), context: Promise.resolve({}), spokenMs: 0, fromFlow: true, interruptible: true };
  current = s;
  showOverlay();
  try {
    armEscape();
  } catch {
    // optional
  }
  return s;
}

/** The ghost says something: in its bubble, out loud, and (optionally) right next to the thing it means. */
function ghostSays(s: Session, text: string, point?: Point, voice = true) {
  if (current !== s) return;
  showStep(text, point, voice);
  // Long enough to read (or hear) it, then back home.
  endSession(s, Math.min(15_000, Math.max(5000, text.split(/\s+/).length * 420)));
}

/** Swearing at Max: take back what Flow typed and react (a meme in Gen Z mode). Never types anything. */
async function ventFromFlow(text: string, typed = true) {
  const s = flowSession();
  s.interruptible = true;
  if (typed) await takeBack();
  if (current !== s) return;
  if (genz()) {
    endSession(s, 0);
    // The reaction owns the ghost here: meme sound, GIF and a comeback.
    await react("command", text, false, true);
    return;
  }
  ghostSays(s, "Fair, that one's on me. Tell me what you need and I'll fix it.");
}

/** One step of a walkthrough: the ghost flies next to the thing to click, says it, and waits. */
function showStep(text: string, point?: Point, voice = true) {
  text = short(text);
  conversation.open = true;
  conversation.turns.push(`Max: ${text}`);
  // The ghost lands right beside the button, its bubble pointing at it.
  if (point) flyTo({ x: point.x + 26, y: point.y + 6 });
  setOverlay({ phase: "done", mode: "max", question: text });
  if (settings.talkBack && voice) void speak(text.replace(/^\d+\/\d+ · /, ""));
}

const GUIDE_STEPS = 6;

/**
 * "Hey Max, how do I…?": a walkthrough. Max looks at the screen, points at the
 * next thing to click and says it; when you click, it looks again and shows
 * the next step, until the goal is reached. Esc stops it.
 */
async function guideFromFlow(question: string, typed = false) {
  const s = flowSession();
  s.interruptible = true;
  if (typed) await takeBack();
  const steps: string[] = [];
  let plan: string[] = [];
  try {
    for (let i = 0; i < GUIDE_STEPS; i++) {
      setOverlay({ phase: "thinking", mode: "max", transcript: question });
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      // The screen, plus which app and window it is: Max reads both.
      const [shot, where] = await Promise.all([captureScreen(), activeApp().catch(() => ({ app: "", windowTitle: "" }))]);
      if (current !== s) return;
      const now = new Date().toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
      const context = where.app ? `\n<context>${where.app}${where.windowTitle ? `: ${where.windowTitle}` : ""}</context>` : "";
      const res = await writer().guide(`${question}\n(It's ${now} on the user's computer.)${context}${aboutUser()}`, shot, s.abort.signal, steps, genz());
      if (current !== s) return;
      if (genz()) {
        // Every Gen Z answer: a GIF and a meme sound, from the server if the answer didn't bring them.
        const [g, snd] = await Promise.all([res.gifUrl ?? serverMeme("gif", res.gif || res.say), res.soundUrl ?? serverMeme("sound", res.sound || anySound())]);
        res.gifUrl = g;
        res.soundUrl = snd;
        if (current !== s) return;
      }
      // Gen Z mode and an obvious question: the roast comes with a meme (sound first, then Max).
      if (res.soundUrl) sendOverlay({ type: "clip", url: res.soundUrl, kind: "audio" });
      if (res.gifUrl) {
        sendOverlay({ type: "gif", url: res.gifUrl });
        setTimeout(() => sendOverlay({ type: "gif", url: null }), 7000);
      }
      const b = display.bounds;
      const point = res.point && { x: b.x + res.point.x * b.width, y: b.y + res.point.y * b.height };
      // One voice at a time: when a meme sound plays, Max's line is in the bubble only.
      const voice = !res.soundUrl;
      if (res.plan && !plan.length) plan = res.plan;
      // "Step 2 of 4" in the bubble; Max only says the step itself.
      const label = (say: string) => (plan.length > 1 ? `${Math.min(i + 1, plan.length)}/${plan.length} · ${say}` : say);
      if (res.openUrl) {
        // Faster than explaining where to type: Max opens it, then looks again.
        void shell.openExternal(res.openUrl);
        showStep(label(res.say), undefined, voice);
        steps.push(`${res.say} (Max opened ${res.openUrl})`);
        await sleep(3500);
        if (current !== s) return;
        continue;
      }
      if (res.done || !point || i === GUIDE_STEPS - 1) return ghostSays(s, label(res.say), point, voice);
      showStep(label(res.say), point, voice);
      steps.push(res.say);
      // Wait for the click (or Enter), then give the page a moment to change.
      const clicked = await nextClick(90_000);
      if (current !== s) return;
      if (!clicked) return endSession(s, 0);
      await sleep(1200);
    }
    endSession(s, 8000);
  } catch (err) {
    if (isAbort(err) || current !== s) return;
    failSession(s, err instanceof Error ? err.message : String(err));
  }
}

/** "Hey Max, tell Claude to…": runs it on the agent signed in on this computer. */
async function agentFromFlow(agent: AgentName, task: string, typed = false) {
  const s = flowSession();
  s.interruptible = false; // agents take minutes; talking to Max doesn't kill them
  if (typed) void takeBack();
  const name = AGENT_LABEL[agent];
  setOverlay({ phase: "listening", mode: "max", question: `${name} is on it…` });
  if (settings.talkBack) void speak(`On it. I'll tell you when ${name} is done.`);
  const run = runAgent(agent, task, settings.agentFolder);
  s.abort.signal.addEventListener("abort", () => run.cancel());
  clearTimeout(s.timer); // agents take as long as they take
  try {
    const out = await run.done;
    // The whole answer, on screen: Max only says the gist.
    const file = saveAgentResult(name, task, out);
    if (file) void shell.openPath(file);
    ghostSays(s, `${name} is done${file ? ", I opened the full answer for you" : ""}. ${spokenSummary(out)}`.trim());
    recordUse({ mode: "max", transcript: task, output: out, app: name, spokenMs: 0 });
  } catch (err) {
    if (current !== s) return;
    ghostSays(s, err instanceof Error ? err.message : String(err));
  }
}

// ---------- Gen Z Max: memes, GIFs, attitude, and talking first ----------

const genz = () => settings.vibe === "genz";
const PEEK_MINUTES = { off: 0, chill: 20, normal: 7, unhinged: 2.5 } as const;
let peekTimer: NodeJS.Timeout | undefined;
let reactionTimer: NodeJS.Timeout | undefined;

/** Gen Z Max reacts: a GIF over its head, a filmy line out loud, maybe a meme song. */
async function react(event: ReactEvent, text = "", withScreen = false, ownsGhost = event !== "command", force = false) {
  if (!genz() && !force) return;
  try {
    const shot = withScreen ? await captureScreen() : undefined;
    const clips = listClips(memeFolder());
    const r = await writer().react(event, text + aboutUser(), shot, clips.map((c) => c.name), undefined, recentReactions);
    if (r.skip && !force) return;
    remember(r.clip || r.sound, r.gif);
    const clip = findClip(clips, r.clip);
    // The GIF and the meme sound always come from the Wispr Max server (it has the GIPHY key
    // and Myinstants lookup), even when your own API key wrote the line.
    const [gif, soundUrl] = await Promise.all([
      clip ? undefined : (r.gifUrl ?? serverMeme("gif", r.gif || r.say)),
      clip ? undefined : (r.soundUrl ?? serverMeme("sound", r.sound || anySound())),
    ]);
    const sound: Clip | undefined = soundUrl ? { name: r.sound, url: soundUrl, kind: "audio" } : undefined;
    if (!clip && !sound && !gif && !r.say.trim()) return;
    showReaction(r.say, clip ?? sound, gif, r.song, ownsGhost);
  } catch {
    // A missed joke is fine.
  }
}

/** Max's last few reactions, so it doesn't play the same meme twice in a row. */
const recentReactions: string[] = [];
function remember(...names: string[]) {
  for (const n of names) if (n.trim()) recentReactions.unshift(n.trim());
  recentReactions.splice(8);
}

const memeFolder = () => settings.memeFolder || defaultMemeFolder();

const MEME_SOUNDS = ["bruh", "vine boom", "emotional damage", "oh no no no", "faaah", "wow anime"];
const anySound = () => MEME_SOUNDS[Math.floor(Math.random() * MEME_SOUNDS.length)];

/** A GIF or meme sound for this phrase, looked up by the Wispr Max server. */
async function serverMeme(kind: "gif" | "sound", query: string): Promise<string | undefined> {
  if (!query.trim()) return undefined;
  try {
    const res = await net.fetch(`${settings.cloudUrl || CLOUD_URL}/api/${kind}?q=${encodeURIComponent(query.slice(0, 80))}`);
    return res.ok ? ((await res.json()) as { url?: string }).url : undefined;
  } catch {
    return undefined;
  }
}

/** `ownsGhost`: Max spoke up by itself (hello, a peek), so the bubble is the reaction's; for a command, it belongs to the task. */
function showReaction(say: string, clip: Clip | undefined, gifUrl: string | undefined, song: string, ownsGhost: boolean) {
  armEscape();
  const idle = ownsGhost && !current;
  showOverlay();
  if (clip) sendOverlay({ type: "clip", url: clip.url, kind: clip.kind });
  // A sound plays with a GIF; your own GIF or video already is the picture.
  if (gifUrl && (!clip || clip.kind === "audio")) sendOverlay({ type: "gif", url: gifUrl });
  // While Max is busy with a task, the bubble is the task's; the reaction is the clip.
  if (idle && say.trim()) setOverlay({ phase: "done", mode: "max", question: say });
  if (say.trim()) conversation.turns.push(`Max: ${say}`);
  // Your clip does the talking; Max only speaks for itself when there's no clip.
  // One voice per request: for a command, the answer does the talking and the
  // reaction is just the meme. Max only voices a reaction when it spoke up by itself.
  if (ownsGhost && !clip && settings.talkBack && say.trim()) void speak(say);
  if (song.trim()) void shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(song)}`);
  clearTimeout(reactionTimer);
  reactionTimer = setTimeout(() => {
    sendOverlay({ type: "gif", url: null });
    if (!idle || current) return;
    placeOverlay(currentAnchor());
    setOverlay({ phase: "idle", mode: "dictate" });
    if (!ghostStaysOut()) overlay.hide();
  }, Math.max(6000, say.split(/\s+/).length * 450));
}

/** Every so often (a little randomly, so it feels alive), Max peeks at the screen and may say something. */
function syncPeeks() {
  clearTimeout(peekTimer);
  const minutes = genz() ? PEEK_MINUTES[settings.chaos] : 0;
  if (!minutes) return;
  peekTimer = setTimeout(() => {
    if (!current) void react("peek", "", true);
    syncPeeks();
  }, minutes * 60_000 * (0.6 + Math.random() * 0.8));
}

// ---------- Esc stops everything ----------

let escapeTimer: NodeJS.Timeout | undefined;

/** While Max is doing anything, Esc stops it all; released after a quiet spell so Esc works normally elsewhere. */
function armEscape(ms = 30_000) {
  if (hookRunning()) return; // Esc is watched by the keyboard hook, and still works in every app
  try {
    if (!globalShortcut.isRegistered("Escape")) armEscape();
  } catch {
    // Another app owns Esc: Max can still be stopped from the tray.
  }
  clearTimeout(escapeTimer);
  escapeTimer = setTimeout(() => {
    if (!current) globalShortcut.unregister("Escape");
  }, ms);
}

/** Voice, meme, GIF, walkthrough, agent: all of it stops, and the ghost goes home. */
function stopEverything() {
  if (current) cancelSession();
  sendOverlay({ type: "cancel" });
  sendOverlay({ type: "gif", url: null });
  clearTimeout(reactionTimer);
  conversation.open = false;
  conversation.turns = [];
  placeOverlay(currentAnchor());
  setOverlay({ phase: "idle", mode: "dictate" });
  if (!ghostStaysOut()) overlay.hide();
  clearTimeout(escapeTimer);
  globalShortcut.unregister("Escape");
}

/** A sentence or two (about 24 words): what fits in the bubble and is worth saying out loud. */
function short(text: string) {
  const sentences = text.trim().match(/[^.!?]+[.!?]*(?=\s|$)/g) ?? [text.trim()];
  let out = "";
  for (const sentence of sentences) {
    const next = `${out} ${sentence.trim()}`.trim();
    if (out && next.split(/\s+/).length > 24) break;
    out = next;
  }
  const words = out.split(/\s+/);
  return words.length > 24 ? `${words.slice(0, 24).join(" ")}…` : out;
}

/** Max talks: a natural voice from the server (ElevenLabs) when it has one, otherwise the system voice. */
async function speak(text: string) {
  armEscape();
  try {
    const res = await net.fetch(`${settings.cloudUrl || CLOUD_URL}/api/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: short(text).slice(0, 160) }), // short lines: fewer voice credits
    });
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer()).toString("base64");
      return sendOverlay({ type: "clip", url: `data:audio/mpeg;base64,${audio}`, kind: "audio" });
    }
  } catch {
    // offline or no voice set up: the system voice below
  }
  sendOverlay({ type: "say", text });
}

/** Saves an agent's full answer as a note in Documents/Wispr Max, so it can be opened and kept. */
function saveAgentResult(name: string, task: string, out: string): string | undefined {
  try {
    const dir = path.join(app.getPath("documents"), "Wispr Max", "Agent results");
    mkdirSync(dir, { recursive: true });
    const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50).replace(/^-|-$/g, "") || "task";
    const file = path.join(dir, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")} ${slug}.md`);
    writeFileSync(file, `# ${task}\n\n_${name}, ${new Date().toLocaleString()}_\n\n${out}\n`);
    return file;
  } catch {
    return undefined;
  }
}

/** A quick ping now and then, so the server never starts cold in the middle of a request. */
function keepServerWarm() {
  const ping = () => {
    if (store.anthropicKey(settings)) return; // writing locally: no server involved
    void net.fetch(`${settings.cloudUrl || CLOUD_URL}/api/health`).catch(() => undefined);
  };
  ping();
  setInterval(ping, 4 * 60_000);
}

let liveAnchor: Point | null = null;

/** Glides the ghost window to a point on screen. */
function flyTo(target: Point) {
  const from = liveAnchor ?? currentAnchor();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    setTimeout(() => {
      const t = i / steps;
      const ease = 1 - (1 - t) ** 3;
      placeOverlay({ x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease });
    }, i * 25);
  }
}

/** Learns where the text is going while the user is still talking. */
async function gatherContext(mode: Mode, fromFlow = false): Promise<FocusContext> {
  const [appInfo, screenshot] = await Promise.all([
    activeApp(),
    mode === "max" && settings.screenContext ? captureScreen() : undefined,
    // Wait for the hotkey's modifiers to be released, or Cmd+C becomes Cmd+Shift+C.
    // (No hotkey with Wispr Flow, so no wait.)
    fromFlow ? undefined : sleep(250),
  ]);
  let selection = "";
  // Ctrl+C in a terminal interrupts the running program, so never "copy" there.
  // With Flow the screen says it all; skipping the copy saves up to half a second.
  if (!fromFlow && mode === "max" && settings.useSelection && !isTerminal(appInfo)) {
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
  // Max may still be talking: Esc keeps working for a little while.
  armEscape(15_000);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (current) return;
    // Between sessions the ghost goes home, then floats quietly or disappears.
    placeOverlay(currentAnchor());
    setOverlay({ phase: "idle", mode: "dictate" });
    if (!ghostStaysOut()) overlay.hide();
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
  if (s.fromFlow) {
    // A little speech bubble over the ghost; the answer comes through Flow like anything else.
    s.phase = "processing";
    clearTimeout(s.timer);
    s.timer = setTimeout(() => current === s && endSession(s, 0), 90_000);
    setOverlay({ phase: "listening", mode: "max", question, transcript: instruction, message: "Tap Alt twice and answer" });
    return;
  }
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
    const raw = await speechToText(audio, vocabulary, s.abort.signal);
    if (current !== s) return;
    if (s.ownMic) {
      // Held Alt and talked: it's for Max, no "Max" needed.
      clearTimeout(s.timer);
      current = null;
      const said = applyDictionary(raw.trim(), settings.dictionary);
      if (!said) return failSession(flowSession(), "Didn't catch that. Hold Alt and try again.");
      return answerMax(calledMax(said) ?? said, false);
    }
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
      } else if (guess?.intent === "unsure") {
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
    setOverlay(
      s.fromFlow && !message
        ? { phase: "done", mode } // Typed where you are: nothing else to show.
        : { phase: "done", mode, text: result.output, transcript: instruction, app: context.app, message },
    );
    endSession(s, settleMs);
  } catch (err) {
    if (isAbort(err) || current !== s) return;
    failSession(s, err instanceof Error ? err.message : String(err));
  }
}

/** Dictation: polish (if enabled), then swap snippet cues for their text. */
async function polishDictation(s: Session, transcript: string, context: FocusContext, vocabulary: string[]) {
  let text = transcript;
  if (settings.polishDictation) {
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
  // With Wispr Flow, Max always types where you are (the LinkedIn box, the email you're in).
  return settings.emailDrafts !== "off" && !current?.fromFlow && toneFor(settings.styles, context).category !== "email" && !context.selection
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
/** Your own speech key if you added one; otherwise the Wispr Max server transcribes. */
function speechToText(audio: AudioPayload, vocabulary: string[], signal?: AbortSignal) {
  const apiKey = store.sttKey(settings);
  const language = settings.language || undefined;
  if (!apiKey) {
    return remoteTranscribe(settings.cloudUrl || CLOUD_URL, audio.data, audio.mime, { language, vocabulary }, (url, init) => net.fetch(url, init), signal);
  }
  return transcribe(audio.data, audio.mime, { provider: settings.sttProvider, apiKey, language, vocabulary }, signal);
}

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
function openListen(question?: string, hidden = false) {
  const anchor = currentAnchor();
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  const below = anchor.y - wa.y < LISTEN_SIZE.height + 60;
  const x = Math.round(Math.min(Math.max(anchor.x - LISTEN_SIZE.width / 2, wa.x), wa.x + wa.width - LISTEN_SIZE.width));
  const y = Math.round(below ? anchor.y + 30 : anchor.y - 34 - LISTEN_SIZE.height);
  listenWin.setBounds({ x, y, ...LISTEN_SIZE });
  // Holding Alt: the box is invisible (the ghost shows "Listening…"); it only catches Flow's text.
  listenWin.setOpacity(hidden ? 0 : 1);
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
  if (ghostStaysOut()) showOverlay();
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
  liveAnchor = anchor;
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
  const wasHidden = !overlay.isVisible();
  placeOverlay(currentAnchor());
  overlay.showInactive(); // Never steal focus from the app being typed into.
  // A ghost doesn't just show up: it appears in a puff of smoke.
  if (wasHidden) sendOverlay({ type: "appear" });
}

/** The ghost floats where you leave it (drag it anywhere); Settings can hide it between uses. */
const ghostStaysOut = () => settings.showIdleGhost;

function setOverlay(state: OverlayState) {
  // With Wispr Flow the ghost stays quiet: only its question bubble ever shows.
  if (flowMode() && (!current || current.fromFlow)) {
    state = { ...state, minimal: true };
    if (state.phase === "error" && state.message) state = { ...state, question: state.message };
  }
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
      { label: "Talk to Max: hold your Wispr Flow key", enabled: false },
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

let hookWarned = false;
function registerHotkeys() {
  globalShortcut.unregisterAll();
  // Hold the talk key to talk (release to send), or double-tap it.
  let held: Session | null = null;
  onEscape(stopEverything);
  // Your own Flow key going down: Max goes quiet so Flow doesn't type Max's voice.
  onFlowKey(() => {
    if (!current?.heldKey) sendOverlay({ type: "cancel" });
  });
  setTalkKey(settings.talkKey === "off" ? "alt" : settings.talkKey, {
    holdStart: () => {
      if (flowMode()) return listenWithOwnMic();
      if (current) return;
      // One key for everything: Max works out whether you're dictating or asking.
      startSession("dictate");
      held = current;
    },
    holdEnd: () => {
      if (flowMode()) return ownMicReleased();
      if (current && current === held && current.phase === "recording") stopRecording(current);
      held = null;
    },
    doubleTap: () => {
      if (flowMode()) listenThroughFlow();
      else onHotkey("dictate");
    },
  });
  if (!hookRunning() && !hookWarned) {
    // Without the keyboard hook Alt can't work: say so instead of silently doing nothing.
    hookWarned = true;
    showOverlay();
    setOverlay({
      phase: "error",
      mode: "max",
      message: isMac
        ? "Max can't see the Alt key. Allow Wispr Max in System Settings → Privacy & Security → Accessibility and Input Monitoring, then restart it."
        : `Max can't see the Alt key (${hookError || "keyboard hook didn't start"}). Restart Wispr Max; if it keeps happening, run it once as administrator.`,
    });
  }
  const register = (accelerator: string, mode: Mode) => {
    try {
      return globalShortcut.register(accelerator, () => onHotkey(mode));
    } catch {
      return false; // Malformed accelerator.
    }
  };
  // The talk key is the only key; the old shortcuts are no longer registered.
  void register;
  hotkeys.dictate = hotkeys.max = true;
  if (current) armEscape();
  refreshTrayMenu();
}

function status(): AppStatus {
  return {
    platform: process.platform,
    accessibilityTrusted: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    hotkeys: { ...hotkeys },
    // Without a key, Max uses the hosted server; with Wispr Flow, Flow does the listening.
    aiReady: true,
    // Without a speech key, the Wispr Max server transcribes.
    sttReady: true,
    flowListen: settings.listenToFlow
      ? {
          ...flowWatch,
          // Proof Max can hear Flow: the last thing it read.
          message: flowWatcher.last ? `${flowWatch.message} Last heard: “${flowWatcher.last.text.slice(0, 80)}”` : flowWatch.message,
        }
      : undefined,
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
    if (s.heldKey) {
      // Said after Alt, Alt: always to Max, no "Max" needed, nothing typed anywhere.
      clearTimeout(s.timer);
      current = null;
      heardBefore(text); // Flow's history gets the same words: answer once
      const said = applyDictionary(text.trim(), settings.dictionary);
      if (s.asking) {
        const next = flowSession();
        next.asking = s.asking;
        next.context = gatherContext("max", true);
        return void handleTranscript(next, said);
      }
      return answerMax(calledMax(said) ?? said, false);
    }
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
  // With Flow, the ghost is just company: Flow's key does everything.
  ipcMain.on("overlay:click", () => {
    if (!flowMode()) onHotkey("dictate");
  });
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
    syncPeeks();
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
    speechToText(audio, buildVocabulary(contacts, settings.dictionary, settings.profile)),
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
    syncPeeks();
    keepServerWarm();
    if (genz()) setTimeout(() => void react("hello"), 2500);
    if (flowMode() && !genz()) {
      showOverlay();
      setOverlay(
        flowWatch.ok
          ? { phase: "done", mode: "max", message: "Listening to Wispr Flow. Say “write me…” and I'll take it from there." }
          : { phase: "error", mode: "max", message: flowWatch.message || "Couldn't find Wispr Flow." },
      );
      setTimeout(() => {
        if (current) return;
        setOverlay({ phase: "idle", mode: "dictate" });
        if (!ghostStaysOut()) overlay.hide();
      }, 6000);
    }
    // With Flow connected there's nothing to open: just the ghost, listening.
    if (!process.argv.includes("--hidden") && !(flowMode() && flowWatch.ok)) openMainWindow();

    // Look for a new version quietly after start-up, then every six hours.
    setTimeout(() => void updateQuietly(), 15_000);
    setInterval(() => void updateQuietly(), 3 * 60 * 60_000);

    app.on("activate", () => openMainWindow());
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopTalkKey();
  });
  // Keep running in the tray when every window is closed.
  app.on("window-all-closed", () => undefined);
}

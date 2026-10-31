import { UiohookKey, uIOhook } from "uiohook-napi";

// The talk key: hold it to talk (release to send), or double-tap it for
// hands-free (tap again to send). A press only counts when no other key is
// used with it, so typing capitals with Shift or Alt shortcuts never trigger it.

export type TalkKeyName = "alt" | "right-alt" | "shift" | "ctrl" | "off";

const CODES: Record<Exclude<TalkKeyName, "off">, number[]> = {
  alt: [UiohookKey.Alt, UiohookKey.AltRight],
  "right-alt": [UiohookKey.AltRight],
  shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
};
const HOLD_MS = 350;
const DOUBLE_TAP_MS = 400;

export interface TalkKeyHandlers {
  holdStart(): void;
  holdEnd(): void;
  doubleTap(): void;
}

let codes: number[] = [];
let handlers: TalkKeyHandlers | null = null;
let started = false;
let down = 0;
let other = false;
let holding = false;
let holdTimer: NodeJS.Timeout | undefined;
let lastTap = 0;
let onEsc: (() => void) | null = null;
/** Our own synthetic Alt releases (see holdFlowKey): not the user letting go. */
let skipUps = 0;
let skipUntil = 0;

/** Esc anywhere stops Max. Only watched, never taken: Esc still works in every app. */
export function onEscape(cb: () => void) {
  onEsc = cb;
}

let onFlow: (() => void) | null = null;
const FLOW_DOWN: number[] = [UiohookKey.CapsLock, UiohookKey.Meta, UiohookKey.MetaRight];
/** Called when the user presses a likely Wispr Flow key (Caps Lock, Win/Cmd). */
export function onFlowKey(cb: () => void) {
  onFlow = cb;
}

/** Why the keyboard hook couldn't start (empty when it runs). */
export let hookError = "";

/** True once the keyboard hook runs (then Esc is watched without a global shortcut). */
export const hookRunning = () => started || hooked;

export type FlowKeyName = "ctrl-win" | "caps" | "self";
const FLOW_KEYS: Record<Exclude<FlowKeyName, "self">, number[]> = {
  "ctrl-win": [UiohookKey.Ctrl, UiohookKey.Meta],
  caps: [UiohookKey.CapsLock],
};

/**
 * Holds (or lets go of) the user's Wispr Flow key for them, so Flow listens
 * while Max's key is held. Alt is released first: Flow wants its own keys alone.
 */
export function holdFlowKey(name: FlowKeyName, down: boolean) {
  if (name === "self" || !hookRunning()) return;
  const keys = FLOW_KEYS[name];
  try {
    if (down) {
      skipUps = 2;
      skipUntil = Date.now() + 400;
      uIOhook.keyToggle(UiohookKey.Alt, "up");
      uIOhook.keyToggle(UiohookKey.AltRight, "up");
    }
    for (const k of down ? keys : [...keys].reverse()) uIOhook.keyToggle(k, down ? "down" : "up");
  } catch {
    // No permission to send keys: the user can still hold their Flow key themselves.
  }
}

export function setTalkKey(name: TalkKeyName, h: TalkKeyHandlers) {
  codes = name === "off" ? [] : CODES[name];
  handlers = h;
  if (started) return;
  started = true;
  if (hooked) {
    uIOhook.stop();
    hooked = false;
  }
  uIOhook.on("keydown", (e) => {
    if (e.keycode === UiohookKey.Escape) onEsc?.();
    // A Flow key going down: the mic is about to open, so Max must stop talking or Flow types Max's voice.
    if (FLOW_DOWN.includes(e.keycode) && Date.now() > skipUntil) onFlow?.();
    if (!codes.includes(e.keycode)) {
      other = true;
      clearTimeout(holdTimer);
      return;
    }
    if (down) return; // key repeat
    down = Date.now();
    other = false;
    holdTimer = setTimeout(() => {
      if (other) return;
      holding = true;
      handlers?.holdStart();
    }, HOLD_MS);
  });
  uIOhook.on("keyup", (e) => {
    if (!codes.includes(e.keycode) || !down) return;
    if (skipUps > 0 && Date.now() < skipUntil) return void skipUps--;
    clearTimeout(holdTimer);
    const wasHolding = holding;
    holding = false;
    down = 0;
    if (wasHolding) return handlers?.holdEnd();
    if (other) return;
    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      handlers?.doubleTap();
    } else lastTap = now;
  });
  try {
    uIOhook.start();
    hookError = "";
  } catch (err) {
    started = false; // No permission (macOS Accessibility)
    hookError = err instanceof Error ? err.message : String(err);
  }
}

let hooked = false;
function ensureHook() {
  if (started || hooked) return true;
  try {
    uIOhook.start();
    hooked = true;
  } catch {
    return false;
  }
  return true;
}

/** Resolves true on the user's next mouse click (false after the timeout, or without permission). */
export function nextClick(timeoutMs: number): Promise<boolean> {
  if (!ensureHook()) return new Promise((r) => setTimeout(() => r(false), Math.min(timeoutMs, 8000)));
  return new Promise((resolve) => {
    const onClick = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(clicked: boolean) {
      clearTimeout(timer);
      uIOhook.off("mousedown", onClick);
      resolve(clicked);
    }
    uIOhook.on("mousedown", onClick);
  });
}

export function stopTalkKey() {
  if (hooked) uIOhook.stop();
  hooked = false;
  if (started) uIOhook.stop();
  started = false;
}

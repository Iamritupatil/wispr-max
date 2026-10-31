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

export function setTalkKey(name: TalkKeyName, h: TalkKeyHandlers) {
  codes = name === "off" ? [] : CODES[name];
  handlers = h;
  if (started || !codes.length) return;
  started = true;
  if (hooked) {
    uIOhook.stop();
    hooked = false;
  }
  uIOhook.on("keydown", (e) => {
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
  } catch {
    started = false; // No permission (macOS Accessibility): the regular hotkeys still work.
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

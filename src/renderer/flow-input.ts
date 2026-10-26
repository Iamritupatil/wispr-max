// Wispr Flow inserts a whole dictation at once (a paste), or types it faster
// than any person can. When that happens, send it shortly after, with no Enter
// needed; Enter always sends.

const FLOW_SETTLE_MS = 700;
/** Characters arriving within this window… */
const BURST_WINDOW_MS = 400;
/** …that no one types by hand (fast typists manage about 4 in that time). */
const BURST_CHARS = 10;

export function watchFlowInput(el: HTMLInputElement | HTMLTextAreaElement, onText: (text: string) => void) {
  let settle: number | undefined;
  let lastLength = el.value.length;
  let recent: { at: number; chars: number }[] = [];
  let machine = false;
  const reset = () => {
    clearTimeout(settle);
    el.value = "";
    lastLength = 0;
    recent = [];
    machine = false;
  };
  const send = () => {
    const text = el.value.trim();
    reset();
    if (text) onText(text);
  };
  el.addEventListener("input", (e) => {
    const now = performance.now();
    const grew = el.value.length - lastLength;
    lastLength = el.value.length;
    clearTimeout(settle);
    if (!el.value.trim()) return reset();
    if (grew > 0) recent.push({ at: now, chars: grew });
    recent = recent.filter((r) => now - r.at < BURST_WINDOW_MS);
    const fast = recent.reduce((n, r) => n + r.chars, 0) >= BURST_CHARS;
    // Once Flow has been seen typing, wait for it to finish, then send.
    machine ||= (e as InputEvent).inputType === "insertFromPaste" || grew > 3 || fast;
    if (machine) settle = window.setTimeout(send, FLOW_SETTLE_MS);
  });
  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
      e.preventDefault();
      send();
    }
  });
  return { send, clear: reset };
}

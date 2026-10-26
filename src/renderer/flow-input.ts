// Wispr Flow inserts a whole dictation at once (a paste, or a burst of text),
// while a person types a character at a time. When a burst lands, send it
// shortly after, with no Enter needed; Enter always sends.

const FLOW_SETTLE_MS = 700;

export function watchFlowInput(el: HTMLInputElement | HTMLTextAreaElement, onText: (text: string) => void) {
  let settle: number | undefined;
  let lastLength = el.value.length;
  const send = () => {
    clearTimeout(settle);
    const text = el.value.trim();
    el.value = "";
    lastLength = 0;
    if (text) onText(text);
  };
  el.addEventListener("input", (e) => {
    const grew = el.value.length - lastLength;
    lastLength = el.value.length;
    clearTimeout(settle);
    const burst = (e as InputEvent).inputType === "insertFromPaste" || grew > 3;
    if (burst && el.value.trim()) settle = window.setTimeout(send, FLOW_SETTLE_MS);
  });
  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
      e.preventDefault();
      send();
    }
  });
  return { send, clear: () => { clearTimeout(settle); el.value = ""; lastLength = 0; } };
}

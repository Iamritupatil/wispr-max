import type { ListenApi } from "../shared/api";

declare global {
  interface Window {
    listen: ListenApi;
  }
}

// The Wispr Flow bubble: Flow types what the user said into this box, and
// Max takes it from there. Flow inserts its text in one go, so a big jump in
// length means Flow just finished: send it shortly after, no Enter needed.

const FLOW_SETTLE_MS = 700;
const input = document.getElementById("input") as HTMLTextAreaElement;
const card = document.getElementById("card")!;
const prompt = document.getElementById("prompt")!;
let settle: number | undefined;
let lastLength = 0;

function send() {
  clearTimeout(settle);
  const text = input.value.trim();
  input.value = "";
  lastLength = 0;
  window.listen.submit(text);
}

window.listen.onOpen(({ question, below }) => {
  clearTimeout(settle);
  document.body.classList.toggle("below", below);
  card.classList.toggle("asking", Boolean(question));
  prompt.textContent = question ?? "Talk with Wispr Flow";
  input.placeholder = question
    ? "Hold your Flow key and answer…"
    : "Hold your Flow key and say what Max should write…";
  input.value = "";
  lastLength = 0;
  input.focus();
});

window.listen.onSubmitNow(send);

input.addEventListener("input", (e) => {
  const grew = input.value.length - lastLength;
  lastLength = input.value.length;
  clearTimeout(settle);
  const pasted = (e as InputEvent).inputType === "insertFromPaste" || grew > 3;
  if (pasted && input.value.trim()) settle = window.setTimeout(send, FLOW_SETTLE_MS);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape") {
    window.listen.cancel();
  }
});

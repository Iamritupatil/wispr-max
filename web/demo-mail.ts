import { parseEmailDraft } from "../src/core/email";
import { toast } from "../src/renderer/app";
import type { AppApi } from "../src/shared/api";

// The web demo: an email window. Talk with Wispr Flow into the body; if it's a
// request, Max takes Flow's words back and writes the email in their place,
// asking in a little ghost bubble when it needs a detail. Plain dictation stays.

const api = (window as unknown as { wispr: AppApi }).wispr;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const body = $<HTMLTextAreaElement>("demo-body");
const subject = $<HTMLInputElement>("demo-subject");
const status = $("demo-status");
const ask = $("demo-ask");

const SETTLE_MS = 700;
let before = body.value; // the body before Flow started typing
let settle: number | undefined;
let busy = false;
let streaming = "";
let pending: { instruction: string; question: string; clarifications: { question: string; answer: string }[] } | null = null;

const HINT = body.placeholder;
function showAsk(question?: string) {
  ask.classList.toggle("hidden", !question);
  body.placeholder = question ? "" : HINT;
  $("demo-q").textContent = question ?? "";
}

function place(text: string) {
  const draft = parseEmailDraft(text);
  if (draft.subject && !subject.value.trim()) subject.value = draft.subject;
  body.value = (before ? `${before.trimEnd()}\n\n` : "") + draft.body;
  before = body.value;
}

async function handle(said: string) {
  busy = true;
  body.value = before; // take Flow's words back
  status.textContent = "Max is writing…";
  const app = "Gmail";
  try {
    const res = pending
      ? {
          intent: "command" as const,
          ...(await api.compose({
            instruction: pending.instruction,
            app,
            emailDraft: true,
            clarifications: [...pending.clarifications, { question: pending.question, answer: said }],
          })),
        }
      : await api.smart({ instruction: said, app, emailDraft: true });
    if (res.question) {
      const prev = pending;
      pending = {
        instruction: prev?.instruction ?? said,
        question: res.question,
        clarifications: prev ? [...prev.clarifications, { question: prev.question, answer: said }] : [],
      };
      showAsk(res.question);
      status.textContent = "Answer with Wispr Flow, right in the email.";
      return;
    }
    pending = null;
    showAsk();
    place(res.text);
    status.textContent = res.intent === "command" ? "Written by Max. Edit anything, then send." : "Typed as you said it.";
    void api.recordUse({ mode: res.intent === "command" ? "max" : "dictate", transcript: said, output: res.text, app, spokenMs: 0 });
  } catch (err) {
    body.value = before + said;
    before = body.value;
    status.textContent = "";
    toast(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
    streaming = "";
  }
}

// Show Max's words appearing as they're written.
api.onComposeText((delta) => {
  if (!busy) return;
  streaming = delta === null ? "" : streaming + delta;
  body.value = (before ? `${before.trimEnd()}\n\n` : "") + parseEmailDraft(streaming).body;
});

let burst = false;
body.addEventListener("input", (e) => {
  if (busy) return;
  const inputType = (e as InputEvent).inputType;
  const grew = body.value.length - before.length;
  // Wispr Flow pastes, or types far faster than a person; a person typing just edits.
  if (inputType === "insertFromPaste" || grew > 3 || burst) {
    burst = true;
    clearTimeout(settle);
    settle = window.setTimeout(() => {
      burst = false;
      const said = body.value.startsWith(before) ? body.value.slice(before.length).trim() : body.value.trim();
      if (said) void handle(said);
    }, SETTLE_MS);
  } else {
    before = body.value;
  }
});

$("demo-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText([subject.value && `Subject: ${subject.value}`, body.value].filter(Boolean).join("\n\n"));
  toast("Copied");
});
$("demo-clear").addEventListener("click", () => {
  body.value = subject.value = before = "";
  pending = null;
  showAsk();
  status.textContent = "";
});

import { findMentionedContacts } from "../core/contacts";
import { emailRecipient, parseEmailDraft } from "../core/email";
import { applyDictionary } from "../core/text";
import type { AppApi, AppSnapshot } from "../shared/api";
import { Recorder } from "./recorder";

// One conversation with Max, shared by every ghost on screen (the Home panel
// and, on the web, the floating ghost). Say or type something; Max decides
// whether you're dictating or asking, may ask one question back, and writes.

export type TalkStatus = "idle" | "listening" | "thinking" | "asking" | "done";

export interface TalkView {
  status: TalkStatus;
  /** What the ghost says right now. */
  title: string;
  /** Words recognised so far while listening (browser speech recognition). */
  live: string;
  /** Max's question while it waits for an answer. */
  question?: string;
  /** The last thing said or typed, and how Max heard it. */
  heard: string;
  answer?: string;
  intent?: "dictation" | "command";
  decidedBy?: "rules" | "claude";
  /** Streaming or finished text. */
  output: string;
  streaming: boolean;
  showResult: boolean;
  draft: { to: string; subject: string; body: string } | null;
}

const IDLE: TalkView = {
  status: "idle",
  title: "Click the ghost and talk.",
  live: "",
  heard: "",
  output: "",
  streaming: false,
  showResult: false,
  draft: null,
};

type Ask = { instruction: string; question: string; clarifications: { question: string; answer: string }[] };

interface SpeechSession {
  stop(): Promise<string>;
  /** Resolves when the browser stops listening by itself. */
  ended: Promise<void>;
}

/** Live speech recognition built into Chrome, Edge and Safari: no key, words appear as you speak. */
function browserSpeech(lang: string, onLive: (text: string) => void): SpeechSession | null {
  const w = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;
  let finals = "";
  let interim = "";
  let error = "";
  rec.onresult = (e: any) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finals += r[0].transcript;
      else interim += r[0].transcript;
    }
    onLive(`${finals}${interim}`.trim());
  };
  rec.onerror = (e: any) => (error = e.error);
  const ended = new Promise<void>((resolve) => (rec.onend = () => resolve()));
  rec.start();
  return {
    ended,
    async stop() {
      rec.stop();
      await ended;
      if (error === "not-allowed" || error === "service-not-allowed") {
        throw new Error("Microphone access is blocked. Allow it in your browser's site settings.");
      }
      return `${finals}${interim}`.trim();
    },
  };
}

export class Talk {
  view: TalkView = { ...IDLE };
  private listeners = new Set<(v: TalkView) => void>();
  private recorder = new Recorder();
  private speech: SpeechSession | null = null;
  private pendingAsk: Ask | null = null;
  private busy = false;
  private startedAt = 0;

  constructor(
    private api: AppApi,
    private state: () => AppSnapshot,
    private opts: { app: string; browserSpeech: boolean; onError: (message: string) => void },
  ) {
    api.onComposeText((delta) => {
      if (!this.busy) return;
      this.set({ output: delta === null ? "" : this.view.output + delta });
    });
  }

  onChange(cb: (v: TalkView) => void) {
    this.listeners.add(cb);
    cb(this.view);
  }

  get recording() {
    return this.recorder.active || Boolean(this.speech);
  }

  private set(patch: Partial<TalkView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l(this.view);
  }

  private settle(title?: string) {
    if (this.pendingAsk) this.set({ status: "asking", title: this.pendingAsk.question, question: this.pendingAsk.question, live: "" });
    else this.set({ status: "idle", title: title ?? IDLE.title, live: "", question: undefined });
  }

  /** Click on a ghost: start listening, or stop and send what was said. */
  async toggleVoice() {
    if (this.recording) return this.stopVoice();
    if (this.busy) return;
    try {
      const lang = this.state().settings.language || navigator.language;
      const speech = this.opts.browserSpeech ? browserSpeech(lang, (live) => this.set({ live })) : null;
      if (speech) {
        this.speech = speech;
        // Browsers stop by themselves after a long silence: treat that as "done".
        void speech.ended.then(() => {
          if (this.speech === speech) void this.stopVoice();
        });
      } else {
        await this.recorder.start();
      }
      this.startedAt = performance.now();
      this.set({
        status: "listening",
        title: this.pendingAsk ? "Listening for your answer… click the ghost when you're done." : "Listening… click the ghost when you're done.",
        live: "",
      });
    } catch (err) {
      this.speech = null;
      this.opts.onError(err instanceof Error ? err.message : String(err));
      this.settle();
    }
  }

  private async stopVoice() {
    const spokenMs = performance.now() - this.startedAt;
    let text = "";
    try {
      if (this.speech) {
        const speech = this.speech;
        this.speech = null;
        text = await speech.stop();
      } else {
        this.set({ status: "thinking", title: "Transcribing…" });
        text = await this.api.transcribe(await this.recorder.stop());
      }
    } catch (err) {
      await this.recorder.cancel();
      this.opts.onError(err instanceof Error ? err.message : String(err));
      return this.settle();
    }
    text = applyDictionary(text, this.state().settings.dictionary);
    if (!text.trim()) return this.settle("Didn't catch that. Click the ghost and try again.");
    await this.submit(text, spokenMs);
  }

  /** Typed or spoken input. While Max is waiting on a question, this is the answer. */
  async submit(text: string, spokenMs = 0) {
    text = text.trim();
    if (!text || this.busy) return;
    this.busy = true;
    const answering = this.pendingAsk;
    this.pendingAsk = null;
    const instruction = answering?.instruction ?? text;
    const { contacts } = this.state();
    // "Email Priya…" becomes a ready-to-send draft: recipient, subject and body.
    const about = answering ? `${instruction} ${text}` : text;
    const to = emailRecipient(about, findMentionedContacts(about, contacts));
    this.set({
      status: "thinking",
      title: "Max is on it…",
      live: "",
      question: undefined,
      heard: instruction,
      answer: answering ? text : undefined,
      intent: undefined,
      decidedBy: undefined,
      output: "",
      streaming: true,
      showResult: true,
      draft: null,
    });
    try {
      let res: { intent: "dictation" | "command"; text: string; question?: string; decidedBy?: "rules" | "claude" };
      let clarifications = answering?.clarifications ?? [];
      if (answering) {
        clarifications = [...clarifications, { question: answering.question, answer: text }];
        const written = await this.api.compose({ instruction, app: this.opts.app, emailDraft: Boolean(to), clarifications });
        res = { intent: "command", ...written };
      } else {
        res = await this.api.smart({ instruction: text, app: this.opts.app, emailDraft: Boolean(to) });
      }

      if (res.question) {
        // Max asks before guessing; the next thing you say or type is the answer.
        this.pendingAsk = { instruction, question: res.question, clarifications };
        this.set({ status: "asking", title: res.question, question: res.question, showResult: false, streaming: false });
        return;
      }

      const asked = res.intent === "command";
      const draft = asked && to ? { to, ...parseEmailDraft(res.text) } : null;
      this.set({
        status: "done",
        title: asked ? "Here's what Max wrote." : "Here's your text, cleaned up.",
        intent: res.intent,
        decidedBy: res.decidedBy,
        output: draft ? draft.body : res.text,
        streaming: false,
        draft,
      });
      void this.api
        .recordUse({
          mode: asked ? "max" : "dictate",
          transcript: instruction,
          output: res.text,
          app: this.opts.app,
          draftTo: draft?.to,
          autoDetected: asked,
          spokenMs,
        })
        .catch(() => undefined);
    } catch (err) {
      this.set({ showResult: false, streaming: false });
      this.settle();
      this.opts.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }

  copy() {
    return this.api.copy(this.view.output);
  }

  openDraft() {
    if (this.view.draft) return this.api.openDraft(this.view.draft);
  }
}

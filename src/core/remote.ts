import type { Written } from "../shared/api";
import type { Contact, FocusContext, Screenshot } from "../shared/types";
import type { AutoHandlers, ComposeInput, Guidance, StreamHandlers, WriterLike } from "./ai";
import type { Intent } from "./intent";

// The hosted backend, behind the same interface as calling Claude directly.
// Used when there's no API key on this machine (and always on the web).
// The server streams newline-delimited JSON events back.

type ServerEvent =
  | { t: "text"; d: string }
  | { t: "reset" }
  | { t: "decision"; intent: Intent }
  | { t: "done"; result: unknown }
  | { t: "error"; message: string };

/** A message to show the user, like AiError (kept separate so the web app doesn't bundle the Anthropic SDK). */
export class ServerError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class RemoteWriter implements WriterLike {
  constructor(
    private baseUrl: string,
    private fetchFn: FetchLike = (url, init) => fetch(url, init),
  ) {}

  compose(input: ComposeInput, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<Written> {
    return this.call("compose", { input }, handlers, signal) as Promise<Written>;
  }

  auto(
    input: ComposeInput & { vocabulary?: string[] },
    handlers: AutoHandlers = {},
    signal?: AbortSignal,
  ): Promise<{ intent: Intent; text: string; question?: string }> {
    return this.call("auto", { input }, handlers, signal) as Promise<{ intent: Intent; text: string; question?: string }>;
  }

  polish(transcript: string, context: FocusContext, vocabulary: string[], tone?: string, signal?: AbortSignal) {
    return this.call("polish", { transcript, context, vocabulary, tone }, {}, signal) as Promise<string>;
  }

  guide(question: string, screenshot: Screenshot | undefined, signal?: AbortSignal): Promise<Guidance> {
    return this.call("guide", { question, screenshot }, {}, signal) as Promise<Guidance>;
  }

  extractContact(text: string, signal?: AbortSignal): Promise<Partial<Contact>> {
    return this.call("extract", { text }, {}, signal) as Promise<Partial<Contact>>;
  }

  private async call(op: string, args: object, handlers: AutoHandlers, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/write`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, ...args }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new ServerError("Couldn't reach the Wispr Max server. Check your connection.");
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ServerError(body.error ?? `The Wispr Max server had a problem (${res.status}).`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ServerEvent;
        if (event.t === "text") handlers.onText?.(event.d);
        else if (event.t === "reset") handlers.onRestart?.();
        else if (event.t === "decision") handlers.onDecision?.(event.intent);
        else if (event.t === "done") return event.result;
        else if (event.t === "error") throw new ServerError(event.message);
      }
      if (done) throw new ServerError("The Wispr Max server stopped before finishing.");
    }
  }
}

/** Speech to text on the Wispr Max server, for "Max on its own" without a speech key. */
export async function remoteTranscribe(
  baseUrl: string,
  audio: Uint8Array,
  mime: string,
  opts: { language?: string; vocabulary?: string[] },
  fetchFn: FetchLike = (url, init) => fetch(url, init),
  signal?: AbortSignal,
): Promise<string> {
  let binary = "";
  for (let i = 0; i < audio.length; i += 0x8000) binary += String.fromCharCode(...audio.subarray(i, i + 0x8000));
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio: btoa(binary), mime, ...opts }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new ServerError("Couldn't reach the Wispr Max server. Check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof body.text !== "string") throw new ServerError(body.error ?? `Transcription failed (${res.status}).`);
  return body.text;
}

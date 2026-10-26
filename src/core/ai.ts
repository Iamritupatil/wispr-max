import Anthropic from "@anthropic-ai/sdk";
import type { Contact, Effort, FocusContext, Profile, Screenshot, Snippet } from "../shared/types";
import { type Intent, parseAutoOutput } from "./intent";
import {
  AUTO_SYSTEM,
  COMPOSE_SYSTEM,
  POLISH_SYSTEM,
  buildAutoUser,
  buildComposeUser,
  buildPolishUser,
  buildProfileAndContacts,
  cleanOutput,
  parseAsk,
  type ComposeOptions,
} from "./prompts";

export interface AiOptions {
  apiKey?: string;
  model: string;
  effort: Effort;
}

export interface ComposeInput {
  instruction: string;
  context: FocusContext;
  profile: Profile;
  contacts: Contact[];
  snippets: Snippet[];
  options?: ComposeOptions;
  /** The user's screen when they asked, so Max can read the conversation. */
  screenshot?: Screenshot;
}

/** The user turn: the screenshot first (if any), then the text. */
function userContent(text: string, screenshot?: Screenshot): string | Anthropic.Beta.BetaContentBlockParam[] {
  if (!screenshot) return text;
  return [
    { type: "image", source: { type: "base64", media_type: screenshot.mediaType, data: screenshot.data } },
    { type: "text", text: `${text}\n\nThe attached image is the user's screen at the moment they asked.` },
  ];
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  /** The serving model declined and a fallback model is restarting the text. */
  onRestart?: () => void;
}

export interface AutoHandlers extends StreamHandlers {
  /** Fires once Claude has decided, before any text streams. */
  onDecision?: (intent: Intent) => void;
}

export class AiError extends Error {}

/** The model behind the hosted backend: fast enough for one-to-two-second results. */
export const FAST_MODEL = "claude-haiku-5-5";

// Models that support server-side refusal fallbacks: on a safety decline the API
// re-runs the request on Anthropic's recommended fallback model. Claude Haiku 5.5
// has none, so its refusals surface as an error instead.
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

function fallbackFor(model: string) {
  return FALLBACK_MODELS.test(model)
    ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const }
    : {};
}

/** What the writing pipeline needs from a writer: Claude directly, or the hosted backend. */
export type WriterLike = Pick<Writer, "compose" | "auto" | "polish" | "extractContact">;

/** What Max wrote, or the one question it needs answered first. */
export interface Written {
  text: string;
  question?: string;
}

const CONTACT_FIELDS = ["name", "email", "phone", "company", "title", "relationship", "notes"] as const;

const CONTACT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(CONTACT_FIELDS.map((f) => [f, { type: "string" }])),
  required: [...CONTACT_FIELDS],
  additionalProperties: false,
};

const CONTACT_SYSTEM = `The user is adding someone to their contacts by pasting or saying whatever they have: links, an email, a number, a few words about the person. Fill in the fields from what they gave you.

- name: the person's full name as stated. If only a profile link is given, a name readable from it is fine.
- title and company: their job, if mentioned.
- relationship: how the user knows them, from the user's point of view ("recruiter for my PM application", "college friend").
- notes: anything else that would help write to them (what's going on, preferences, dates), in the user's words.
- Leave a field as an empty string when it isn't given. Never invent details.`;

export class Writer {
  private client: Anthropic;

  constructor(private opts: AiOptions) {
    // An empty key falls back to ANTHROPIC_API_KEY / `ant auth login`.
    this.client = new Anthropic({ apiKey: opts.apiKey || undefined, maxRetries: 1 });
  }

  /** Max mode: turn a spoken instruction into finished text. */
  /**
   * Max: turn an instruction into finished text. When something essential is
   * missing, Claude asks instead: the result has a `question` and no text.
   */
  async compose(input: ComposeInput, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<Written> {
    // Hold the first few characters back: "ASK: …" is a question for the ghost,
    // never text to stream into the user's document.
    let held = "";
    let streaming = false;
    const raw = await this.run(
      [
        { type: "text", text: COMPOSE_SYSTEM },
        {
          type: "text",
          text: buildProfileAndContacts(input.profile, input.contacts, input.instruction, input.snippets),
          cache_control: { type: "ephemeral" },
        },
      ],
      userContent(buildComposeUser(input.instruction, input.context, input.options), input.screenshot),
      {
        onText: (delta) => {
          if (streaming) return handlers.onText?.(delta);
          held += delta;
          if (held.trimStart().length < 4) return;
          if (/^\s*ASK:/i.test(held)) return; // a question: keep it out of the stream
          streaming = true;
          handlers.onText?.(held);
        },
        onRestart: () => {
          held = "";
          streaming = false;
          handlers.onRestart?.();
        },
      },
      signal,
    );
    const question = parseAsk(raw);
    return question ? { text: "", question } : { text: raw };
  }

  /**
   * Smart dictation: Claude decides whether the speech is dictation or a request
   * to write something, and produces the text to insert in the same response.
   */
  async auto(
    input: ComposeInput & { vocabulary?: string[] },
    handlers: AutoHandlers = {},
    signal?: AbortSignal,
  ): Promise<{ intent: Intent; text: string; question?: string }> {
    // Hold text back until the "MODE: …" header line has been read.
    let buffer = "";
    let decided = false;
    let asking = false;
    const raw = await this.run(
      [
        { type: "text", text: AUTO_SYSTEM },
        {
          type: "text",
          text: buildProfileAndContacts(input.profile, input.contacts, input.instruction, input.snippets),
          cache_control: { type: "ephemeral" },
        },
      ],
      userContent(
        buildAutoUser(input.instruction, input.context, { ...input.options, vocabulary: input.vocabulary }),
        input.screenshot,
      ),
      {
        onText: (delta) => {
          if (asking) return;
          if (decided) return handlers.onText?.(delta);
          buffer += delta;
          const parsed = parseAutoOutput(buffer);
          if (parsed) {
            decided = true;
            asking = parsed.question !== undefined;
            handlers.onDecision?.(parsed.intent);
            if (parsed.text && !asking) handlers.onText?.(parsed.text);
          } else if (buffer.length > 40 && !/^\s*MODE:?/i.test(buffer)) {
            // No header after all: treat it as dictation and show what we have.
            decided = true;
            handlers.onDecision?.("dictation");
            handlers.onText?.(buffer);
          }
        },
        onRestart: () => {
          buffer = "";
          decided = false;
          asking = false;
          handlers.onRestart?.();
        },
      },
      signal,
    );
    const parsed = parseAutoOutput(raw);
    if (parsed?.question) return { intent: "command", text: "", question: parsed.question };
    return parsed ? { intent: parsed.intent, text: cleanOutput(parsed.text) } : { intent: "dictation", text: raw };
  }

  /** Turns whatever the user pasted or said about someone into contact fields. */
  async extractContact(text: string, signal?: AbortSignal): Promise<Partial<Contact>> {
    try {
      const res = await this.client.beta.messages.create(
        {
          model: this.opts.model,
          max_tokens: 8000,
          output_config: { effort: "low", format: { type: "json_schema", schema: CONTACT_SCHEMA } },
          ...fallbackFor(this.opts.model),
          system: CONTACT_SYSTEM,
          messages: [{ role: "user", content: text }],
        },
        { signal },
      );
      if (res.stop_reason === "refusal") return {};
      const json = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const fields = JSON.parse(json) as Record<string, string>;
      return Object.fromEntries(Object.entries(fields).filter(([, v]) => v?.trim())) as Partial<Contact>;
    } catch (err) {
      throw toAiError(err);
    }
  }

  /** Dictation mode: clean up a raw transcript without changing its meaning. */
  async polish(
    transcript: string,
    context: FocusContext,
    vocabulary: string[],
    tone?: string,
    signal?: AbortSignal,
  ) {
    return this.run(
      [{ type: "text", text: POLISH_SYSTEM }],
      buildPolishUser(transcript, context, vocabulary, tone),
      {},
      signal,
      "low",
    );
  }

  private async run(
    system: Anthropic.Beta.BetaTextBlockParam[],
    user: string | Anthropic.Beta.BetaContentBlockParam[],
    handlers: StreamHandlers,
    signal?: AbortSignal,
    effort: Effort = this.opts.effort,
  ): Promise<string> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.opts.model,
          max_tokens: 16000,
          output_config: { effort },
          ...fallbackFor(this.opts.model),
          system,
          messages: [{ role: "user", content: user }],
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "fallback") {
          handlers.onRestart?.();
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          handlers.onText?.(event.delta.text);
        }
      }

      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new AiError("Claude declined this request.");
      }
      // Only text after the last fallback hand-off belongs to the final answer.
      const lastFallback = message.content.map((b) => b.type).lastIndexOf("fallback");
      const text = message.content
        .slice(lastFallback + 1)
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      return cleanOutput(text);
    } catch (err) {
      throw toAiError(err);
    }
  }
}

function toAiError(err: unknown): Error {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError("Anthropic API key is missing or invalid. Add it in Settings.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("This API key can't use the selected model.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError("Model not found. Check the model name in Settings.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Rate limited by the Anthropic API. Try again in a moment.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach the Anthropic API. Check your connection.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
  }
  if (err instanceof Error && /api key|apiKey|authentication/i.test(err.message)) {
    return new AiError("Anthropic API key is missing. Add it in Settings.");
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function isAbort(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIUserAbortError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

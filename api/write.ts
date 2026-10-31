import type { ComposeInput, ReactEvent } from "../src/core/ai";
import { findGif } from "../src/core/gif";
import { findSound } from "../src/core/sound";
import type { FocusContext, Screenshot } from "../src/shared/types";
import { hasKey, json, ndjson, rateLimited, readBody, serverWriter } from "./_lib";

type Body =
  | { op: "compose" | "auto"; input: ComposeInput & { vocabulary?: string[] } }
  | { op: "polish"; transcript: string; context: FocusContext; vocabulary: string[]; tone?: string }
  | { op: "extract"; text: string }
  | { op: "guide"; question: string; screenshot?: Screenshot }
  | { op: "react"; event: ReactEvent; text: string; screenshot?: Screenshot; clips?: string[] };

/** Everything Max writes goes through here: compose, dictate-or-ask, polish, read a contact. */
export async function POST(request: Request) {
  if (!hasKey()) return json({ error: "The Wispr Max server isn't set up yet (no API key)." }, 503);
  const limited = rateLimited(request, "write", 120);
  if (limited) return limited;
  const body = await readBody<Body>(request, 4_000_000); // room for a screenshot
  if (body instanceof Response) return body;

  const writer = serverWriter();
  return ndjson((send) => {
    const handlers = {
      onText: (d: string) => send({ t: "text", d }),
      onRestart: () => send({ t: "reset" }),
      onDecision: (intent: string) => send({ t: "decision", intent }),
    };
    switch (body.op) {
      case "compose":
        return writer.compose(body.input, handlers, request.signal);
      case "auto":
        return writer.auto(body.input, handlers, request.signal);
      case "polish":
        return writer.polish(body.transcript, body.context, body.vocabulary, body.tone, request.signal);
      case "react":
        return writer.react(body.event, body.text, body.screenshot, (body.clips ?? []).slice(0, 200), request.signal).then(async (r) => ({
          ...r,
          // The user's own clip comes first; then a meme sound and a GIPHY GIF.
          gifUrl: r.skip || r.clip ? undefined : await findGif(r.gif, process.env.GIPHY_API_KEY),
          soundUrl: r.skip || r.clip ? undefined : await findSound(r.sound),
        }));
      case "guide":
        return writer.guide(body.question, body.screenshot, request.signal);
      case "extract":
        return writer.extractContact(body.text, request.signal);
      default:
        throw new Error("Unknown request.");
    }
  });
}

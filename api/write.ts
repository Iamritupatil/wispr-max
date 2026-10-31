import type { ComposeInput, ReactEvent } from "../src/core/ai";
import { findGif } from "../src/core/gif";
import { BUILTIN_SOUNDS, builtinSound, findSound } from "../src/core/sound";

// When the model names no meme sound, one of these: every Gen Z answer makes a noise.
const FALLBACK_SOUNDS = ["bruh", "vine boom", "emotional damage", "oh no no no", "faaah", "wow anime"];
const anySound = () => FALLBACK_SOUNDS[Math.floor(Math.random() * FALLBACK_SOUNDS.length)];
import type { FocusContext, Screenshot } from "../src/shared/types";
import { hasKey, json, ndjson, rateLimited, readBody, serverWriter } from "./_lib";

type Body =
  | { op: "compose" | "auto"; input: ComposeInput & { vocabulary?: string[] } }
  | { op: "polish"; transcript: string; context: FocusContext; vocabulary: string[]; tone?: string }
  | { op: "extract"; text: string }
  | { op: "guide"; question: string; screenshot?: Screenshot; steps?: string[]; genz?: boolean }
  | { op: "react"; event: ReactEvent; text: string; screenshot?: Screenshot; clips?: string[]; recent?: string[] };

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
        // The user's own clips, plus Max's built-in reactions ("chilla mat chudail"…).
        return writer
          .react(body.event, body.text, body.screenshot, [...(body.clips ?? []).slice(0, 200), ...BUILTIN_SOUNDS.map((b) => `${b.name} (${b.when})`)], request.signal, (body.recent ?? []).slice(0, 8))
          .then(async (r) => {
            if (r.skip) return r;
            const builtin = BUILTIN_SOUNDS.find((b) => r.clip.trim().toLowerCase().startsWith(b.name));
            // Every reaction gets a GIF, and a sound unless the user's own clip plays; looked up side by side.
            const [soundUrl, gifUrl] = await Promise.all([
              builtin ? builtinSound(builtin) : r.clip ? undefined : findSound(r.sound?.trim() || anySound()),
              // No GIF named? Max's own line finds one: every reaction gets a GIF.
              findGif(r.gif?.trim() || r.say || "reaction", process.env.GIPHY_API_KEY),
            ]);
            return { ...r, clip: builtin ? "" : r.clip, soundUrl, gifUrl };
          });
      case "guide":
        return writer.guide(body.question, body.screenshot, request.signal, (body.steps ?? []).slice(0, 10), Boolean(body.genz)).then(async (g) => {
          if (!body.genz) return g;
          // Gen Z Max: every answer gets a GIF (from Max's own line if none was named), a meme sound for roasts.
          const [gifUrl, soundUrl] = await Promise.all([findGif(g.gif?.trim() || g.say, process.env.GIPHY_API_KEY), findSound(g.sound?.trim() || anySound())]);
          return { ...g, gifUrl, soundUrl };
        });
      case "extract":
        return writer.extractContact(body.text, request.signal);
      default:
        throw new Error("Unknown request.");
    }
  });
}

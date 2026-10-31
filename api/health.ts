import { FAST_MODEL } from "../src/core/ai";
import { assemblyKey, hasKey, json } from "./_lib";

export function GET() {
  return json({
    ok: true,
    ai: hasKey(),
    voice: Boolean(assemblyKey()),
    speech: Boolean(process.env.ELEVENLABS_API_KEY),
    gifs: Boolean(process.env.GIPHY_API_KEY),
    model: process.env.WISPR_MAX_MODEL || FAST_MODEL,
  });
}

import { FAST_MODEL } from "../src/core/ai";
import { assemblyKey, hasKey, json } from "./_lib";

export function GET() {
  return json({ ok: true, ai: hasKey(), voice: Boolean(assemblyKey()), model: process.env.WISPR_MAX_MODEL || FAST_MODEL });
}

import { FAST_MODEL } from "../src/core/ai";
import { hasKey, json } from "./_lib";

export function GET() {
  return json({ ok: true, ai: hasKey(), model: process.env.WISPR_MAX_MODEL || FAST_MODEL });
}

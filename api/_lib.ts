import { FAST_MODEL, Writer } from "../src/core/ai";

// Shared by the hosted endpoints. The Anthropic key lives only in the server's
// environment (ANTHROPIC_API_KEY); nobody using the app ever needs one.

export function serverWriter() {
  return new Writer({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.WISPR_MAX_MODEL || FAST_MODEL,
    effort: "low",
  });
}

export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Speech to text for "Max on its own"; either name works. */
export const assemblyKey = () => process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLY_API_KEY || "";

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// ---------- limits: protect the key from runaway use ----------

const WINDOW_MS = 10 * 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Per-person request limit (in memory, per server instance: a speed bump, not a vault). */
export function rateLimited(request: Request, bucket: string, max: number): Response | null {
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  entry.count += 1;
  if (entry.count <= max) return null;
  const minutes = Math.ceil((entry.resetAt - now) / 60_000);
  return json({ error: `You've hit the demo's limit for now. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, 429);
}

export async function readBody<T>(request: Request, maxBytes: number): Promise<T | Response> {
  const text = await request.text();
  if (text.length > maxBytes) return json({ error: "That request is too large." }, 413);
  try {
    return JSON.parse(text) as T;
  } catch {
    return json({ error: "That request wasn't valid JSON." }, 400);
  }
}

/** Streams newline-delimited JSON events while `work` runs, then its result. */
export function ndjson(work: (send: (event: object) => void) => Promise<unknown>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ t: "done", result: await work(send) });
      } catch (err) {
        send({ t: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}

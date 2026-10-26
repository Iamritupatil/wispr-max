import { transcribe } from "../src/core/stt";
import { assemblyKey, json, rateLimited, readBody } from "./_lib";

// Speech to text for "Max on its own" (no Wispr Flow): the desktop app and
// browsers without built-in recognition send a recording here. The AssemblyAI
// key stays on the server.

type Body = { audio: string; mime: string; language?: string; vocabulary?: string[] };

export async function POST(request: Request) {
  if (!assemblyKey()) return json({ error: "Voice on the Wispr Max server isn't set up yet. Use Wispr Flow, or add your own speech key in Settings." }, 503);
  const limited = rateLimited(request, "transcribe", 60);
  if (limited) return limited;
  const body = await readBody<Body>(request, 4_000_000);
  if (body instanceof Response) return body;
  if (!body.audio) return json({ error: "No audio." }, 400);
  try {
    const text = await transcribe(Buffer.from(body.audio, "base64"), body.mime || "audio/webm", {
      provider: "assemblyai",
      apiKey: assemblyKey(),
      language: body.language || undefined,
      vocabulary: (body.vocabulary ?? []).slice(0, 200),
    }, request.signal);
    return json({ text });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

import { json, rateLimited, readBody } from "./_lib";

// Max's voice: natural speech from ElevenLabs when the server has a key
// (ELEVENLABS_API_KEY, and optionally ELEVENLABS_VOICE_ID). Without one the
// app falls back to the computer's own voice.

const DEFAULT_VOICE = "TxGEqnHWrfWFTfGW9XjX"; // "Josh": young, upbeat, English

/** GET /api/voice: checks the voice works (says nothing secret, just whether ElevenLabs answered). */
export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ ok: false, error: "ELEVENLABS_API_KEY isn't set on this deployment (add it, then redeploy)." });
  const res = await speakWith(key, "Hey, it's Max.");
  if (res.ok) return json({ ok: true, voice: process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE });
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  return json({ ok: false, status: res.status, error: detail });
}

function speakWith(key: string, text: string) {
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
  });
}

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ error: "No voice set up on the server." }, 503);
  const limited = rateLimited(request, "voice", 120);
  if (limited) return limited;
  const body = await readBody<{ text?: string }>(request, 4000);
  if (body instanceof Response) return body;
  const text = body.text?.trim().slice(0, 400);
  if (!text) return json({ error: "Nothing to say." }, 400);
  const res = await speakWith(key, text);
  if (!res.ok || !res.body) return json({ error: `Voice failed (${res.status}).` }, 502);
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}

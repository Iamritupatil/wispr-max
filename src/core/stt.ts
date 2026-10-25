import type { SttProvider } from "../shared/types";

export interface SttOptions {
  provider: SttProvider;
  apiKey: string;
  language?: string;
  /** Names and jargon to bias spelling. */
  vocabulary?: string[];
}

const PROVIDERS: Record<SttProvider, { url: string; model: string; label: string }> = {
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    label: "Groq",
  },
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "gpt-4o-mini-transcribe",
    label: "OpenAI",
  },
};

// Whisper-family models invent these on silence or noise.
const HALLUCINATIONS = [
  /^(thank you|thanks)( so much)?( for watching| for listening)?[.!]*$/i,
  /^(bye|you)[.!]*$/i,
  /^\.+$/,
  /^subtitles by/i,
];

export class SttError extends Error {}

export async function transcribe(
  audio: Uint8Array,
  mime: string,
  opts: SttOptions,
  signal?: AbortSignal,
): Promise<string> {
  const provider = PROVIDERS[opts.provider];
  if (!opts.apiKey) {
    throw new SttError(`Add a ${provider.label} API key in Settings to enable voice.`);
  }

  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append("model", provider.model);
  form.append("response_format", "json");
  if (opts.language) form.append("language", opts.language);
  if (opts.vocabulary?.length) {
    form.append("prompt", opts.vocabulary.join(", ").slice(0, 800));
  }

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new SttError(`Couldn't reach ${provider.label} for transcription.`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new SttError(`${provider.label} API key is invalid.`);
    throw new SttError(`${provider.label} transcription failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  return HALLUCINATIONS.some((re) => re.test(text)) ? "" : text;
}

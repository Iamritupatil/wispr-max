import type { SttProvider } from "../shared/types";

export interface SttOptions {
  provider: SttProvider;
  apiKey: string;
  language?: string;
  /** Names and jargon to bias spelling. */
  vocabulary?: string[];
}

export const STT_LABELS: Record<SttProvider, string> = {
  assemblyai: "AssemblyAI",
  groq: "Groq",
  openai: "OpenAI",
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
  const label = STT_LABELS[opts.provider];
  if (!opts.apiKey) throw new SttError(`Add ${/^[AEIOU]/.test(label) ? "an" : "a"} ${label} API key in Settings to enable voice.`);
  try {
    const text =
      opts.provider === "assemblyai"
        ? await assemblyAi(audio, mime, opts, signal)
        : await whisperCompatible(audio, mime, opts, signal);
    return HALLUCINATIONS.some((re) => re.test(text)) ? "" : text;
  } catch (err) {
    if (err instanceof SttError || (err instanceof Error && err.name === "AbortError")) throw err;
    throw new SttError(`Couldn't reach ${label} for transcription.`);
  }
}

async function failure(res: Response, label: string): Promise<SttError> {
  const body = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) return new SttError(`${label} API key is invalid.`);
  return new SttError(`${label} transcription failed (${res.status}): ${body.slice(0, 200)}`);
}

// ---------- Groq / OpenAI (one multipart request) ----------

const WHISPER = {
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
};

async function whisperCompatible(audio: Uint8Array, mime: string, opts: SttOptions, signal?: AbortSignal) {
  const { url, model } = WHISPER[opts.provider as "groq" | "openai"];
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (opts.language) form.append("language", opts.language);
  if (opts.vocabulary?.length) form.append("prompt", opts.vocabulary.join(", ").slice(0, 800));

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) throw await failure(res, STT_LABELS[opts.provider]);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

// ---------- AssemblyAI (upload → transcript → poll) ----------

const ASSEMBLY = "https://api.assemblyai.com/v2";
const POLL_MS = 120;
const POLL_TIMEOUT_MS = 60_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    });
  });

async function assemblyAi(audio: Uint8Array, _mime: string, opts: SttOptions, signal?: AbortSignal) {
  const label = STT_LABELS.assemblyai;
  const headers = { authorization: opts.apiKey };

  // 1. Upload the raw bytes.
  const upload = await fetch(`${ASSEMBLY}/upload`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/octet-stream" },
    body: new Uint8Array(audio),
    signal,
  });
  if (!upload.ok) throw await failure(upload, label);
  const { upload_url } = (await upload.json()) as { upload_url: string };

  // 2. Start the transcript. Optional tuning fields are dropped if the API rejects them,
  //    so an older account or model never breaks dictation.
  const base: Record<string, unknown> = {
    audio_url: upload_url,
    punctuate: true,
    format_text: true,
    ...(opts.language ? { language_code: opts.language } : { language_detection: true }),
  };
  const tuned: Record<string, unknown> = {
    ...base,
    speech_models: ["universal-3-pro", "universal-2"],
    ...(opts.vocabulary?.length ? { keyterms_prompt: opts.vocabulary.slice(0, 100) } : {}),
  };
  let created: Response | undefined;
  for (const body of [tuned, base]) {
    created = await fetch(`${ASSEMBLY}/transcript`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (created.status !== 400) break;
  }
  if (!created!.ok) throw await failure(created!, label);
  const { id } = (await created!.json()) as { id: string };

  // 3. Poll until it's done (a few hundred ms for a short clip).
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS, signal);
    const res = await fetch(`${ASSEMBLY}/transcript/${id}`, { headers, signal });
    if (!res.ok) throw await failure(res, label);
    const t = (await res.json()) as { status: string; text?: string | null; error?: string };
    if (t.status === "completed") return (t.text ?? "").trim();
    if (t.status === "error") {
      // Silence or a too-short clip isn't an error worth showing: treat it as nothing heard.
      if (/no spoken audio|audio duration|too short/i.test(t.error ?? "")) return "";
      throw new SttError(`${label} couldn't transcribe that: ${t.error ?? "unknown error"}`);
    }
  }
  throw new SttError(`${label} took too long to transcribe.`);
}

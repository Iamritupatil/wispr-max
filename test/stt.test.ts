import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SttError, transcribe } from "../src/core/stt";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init?: RequestInit };

/** Replays canned responses in order and records every request. */
function mockFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error(`unexpected request to ${url}`);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

const audio = new Uint8Array([1, 2, 3]);
const opts = { provider: "assemblyai" as const, apiKey: "aai-key", vocabulary: ["Priya Sharma", "Wispr"] };

test("AssemblyAI: uploads, creates a transcript with key terms, polls until done", async () => {
  const calls = mockFetch([
    { json: { upload_url: "https://cdn.assemblyai.com/upload/abc" } },
    { json: { id: "t1", status: "queued" } },
    { json: { status: "processing" } },
    { json: { status: "completed", text: " Email Priya about the role. " } },
  ]);
  assert.equal(await transcribe(audio, "audio/webm", opts), "Email Priya about the role.");

  assert.equal(calls[0].url, "https://api.assemblyai.com/v2/upload");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "aai-key");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.audio_url, "https://cdn.assemblyai.com/upload/abc");
  assert.deepEqual(body.keyterms_prompt, ["Priya Sharma", "Wispr"]);
  assert.equal(body.language_detection, true);
  assert.equal(calls[2].url, "https://api.assemblyai.com/v2/transcript/t1");
});

test("AssemblyAI: retries without optional tuning fields if they're rejected", async () => {
  const calls = mockFetch([
    { json: { upload_url: "u" } },
    { status: 400, text: "unknown field keyterms_prompt" },
    { json: { id: "t2" } },
    { json: { status: "completed", text: "hello" } },
  ]);
  assert.equal(await transcribe(audio, "audio/webm", { ...opts, language: "en" }), "hello");
  const retry = JSON.parse(String(calls[2].init?.body));
  assert.equal(retry.keyterms_prompt, undefined);
  assert.equal(retry.speech_models, undefined);
  assert.equal(retry.language_code, "en");
});

test("AssemblyAI: silence is nothing heard, not an error; bad keys are explained", async () => {
  mockFetch([
    { json: { upload_url: "u" } },
    { json: { id: "t3" } },
    { json: { status: "error", error: "Audio duration is too short." } },
  ]);
  assert.equal(await transcribe(audio, "audio/webm", opts), "");

  mockFetch([{ status: 401, text: "Invalid API key" }]);
  await assert.rejects(transcribe(audio, "audio/webm", opts), (e) => e instanceof SttError && /invalid/.test(e.message));

  await assert.rejects(transcribe(audio, "audio/webm", { ...opts, apiKey: "" }), /Add an AssemblyAI API key/);
});

test("Groq: one multipart request with the vocabulary as a prompt", async () => {
  const calls = mockFetch([{ json: { text: "Thanks for watching!" } }, { json: { text: "Running late" } }]);
  assert.equal(await transcribe(audio, "audio/webm", { provider: "groq", apiKey: "g" }), ""); // hallucination filtered
  assert.equal(await transcribe(audio, "audio/webm", { provider: "groq", apiKey: "g", vocabulary: ["Wispr"] }), "Running late");
  assert.equal((calls[1].init?.body as FormData).get("prompt"), "Wispr");
});

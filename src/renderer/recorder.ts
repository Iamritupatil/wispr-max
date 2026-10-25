import type { AudioPayload } from "../shared/types";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** Microphone capture with a live level meter. The mic is only open while recording. */
export class Recorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private audioCtx?: AudioContext;
  private analyser?: AnalyserNode;
  private samples?: Uint8Array<ArrayBuffer>;
  private startedAt = 0;
  private starting?: Promise<void>;

  get active() {
    return Boolean(this.recorder);
  }

  start(): Promise<void> {
    this.starting = this.open();
    return this.starting;
  }

  private async open() {
    this.cleanup();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.stream = stream;
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();

    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Uint8Array(this.analyser.fftSize);
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);
  }

  /** Loudness from 0 to 1, for the waveform. */
  level(): number {
    if (!this.analyser || !this.samples) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  async stop(): Promise<AudioPayload> {
    await this.starting;
    const recorder = this.recorder;
    if (!recorder) throw new Error("Recording never started.");
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.stop();
    await stopped;
    const durationMs = performance.now() - this.startedAt;
    const mime = (recorder.mimeType || "audio/webm").split(";")[0];
    const blob = new Blob(this.chunks, { type: mime });
    this.cleanup();
    return { data: new Uint8Array(await blob.arrayBuffer()), mime, durationMs };
  }

  async cancel() {
    await this.starting?.catch(() => undefined);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => undefined);
    this.stream = undefined;
    this.recorder = undefined;
    this.audioCtx = undefined;
    this.analyser = undefined;
    this.chunks = [];
  }
}

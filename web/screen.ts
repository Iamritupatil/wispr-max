import type { Screenshot } from "../src/shared/types";

// Screen context on the web, two ways:
//  - paste a screenshot of the chat (Win+Shift+S or Cmd+Shift+4, then paste):
//    no permissions, nothing shared but that one picture;
//  - or share a tab or window once, and each request includes a frame of it.
// The desktop app needs neither: it reads the screen by itself.

const EDGE = 1568;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let pasted: Screenshot | null = null;
const listeners = new Set<() => void>();

export const sharing = () => Boolean(stream);
export const hasPasted = () => Boolean(pasted);

export function onContextChange(cb: () => void) {
  listeners.add(cb);
}

function notify() {
  for (const l of listeners) l();
}

export async function startSharing(): Promise<void> {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
  video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  notify();
}

export function stopSharing() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video = null;
  notify();
}

function toScreenshot(source: CanvasImageSource, width: number, height: number): Screenshot {
  const scale = Math.min(1, EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], mediaType: "image/jpeg" };
}

/** A pasted or dropped screenshot becomes the context until it's removed or replaced. */
export async function attachImage(file: Blob): Promise<void> {
  const bitmap = await createImageBitmap(file);
  pasted = toScreenshot(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  notify();
}

export function clearImage() {
  pasted = null;
  notify();
}

/** The image in a paste, if there is one (a screenshot, not text). */
export function imageIn(data: DataTransfer | null): File | null {
  for (const item of Array.from(data?.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** What Max sees with the next request: the live shared tab, else the pasted screenshot. */
export function grabScreen(): Screenshot | undefined {
  if (video?.videoWidth) return toScreenshot(video, video.videoWidth, video.videoHeight);
  return pasted ?? undefined;
}

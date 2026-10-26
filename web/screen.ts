import type { Screenshot } from "../src/shared/types";

// Screen context on the web: the user shares a tab or window once, and each
// request includes a frame of it, so Max can read the conversation there.

const EDGE = 1568;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
const listeners = new Set<(on: boolean) => void>();

export const sharing = () => Boolean(stream);

export function onSharingChange(cb: (on: boolean) => void) {
  listeners.add(cb);
}

function notify() {
  for (const l of listeners) l(sharing());
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

/** The current frame of the shared tab or window, ready for Claude. */
export function grabScreen(): Screenshot | undefined {
  if (!video || !video.videoWidth) return undefined;
  const scale = Math.min(1, EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL("image/jpeg", 0.75).split(",")[1], mediaType: "image/jpeg" };
}

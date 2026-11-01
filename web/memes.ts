// When a reply comes back without its GIF or meme sound (the lookup was slow),
// fetch them on the side: the words show right away, the meme lands a beat later.

async function lookup(kind: "gif" | "sound", query: string): Promise<string | undefined> {
  if (!query.trim()) return undefined;
  try {
    const res = await fetch(`/api/${kind}?q=${encodeURIComponent(query.slice(0, 80))}`);
    return res.ok ? ((await res.json()) as { url?: string }).url : undefined;
  } catch {
    return undefined;
  }
}

const SOUNDS = ["bruh", "vine boom", "emotional damage", "faaah", "oh no no no"];

let audio: HTMLAudioElement | null = null;

/** Shows the GIF and plays the sound, looking up whichever didn't come with the reply. */
export function showMemes(
  r: { gifUrl?: string; soundUrl?: string; gif?: string; sound?: string; say?: string },
  gifEl: HTMLImageElement,
): void {
  const gif = r.gifUrl ? Promise.resolve(r.gifUrl) : lookup("gif", r.gif || r.say || "reaction");
  const sound = r.soundUrl ? Promise.resolve(r.soundUrl) : lookup("sound", r.sound || SOUNDS[Math.floor(Math.random() * SOUNDS.length)]);
  void gif.then((url) => {
    if (!url) return;
    gifEl.src = url;
    gifEl.classList.remove("hidden");
  });
  void sound.then((url) => {
    if (!url) return;
    audio?.pause();
    audio = new Audio(url);
    void audio.play().catch(() => undefined);
  });
}

export function stopMemes() {
  audio?.pause();
}

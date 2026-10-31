import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The user's meme folder: audio, GIFs and videos named after what they are
// ("rani-mukerji-angrezi-mein-gaali-mat-do.mp3"). An optional memes.json says
// when to use each one: { "rani-angrezi.mp3": "when the user swears at Max" }.

export type ClipKind = "audio" | "image" | "video";
export interface Clip {
  /** What Max sees: the file name without its extension, plus any note. */
  name: string;
  url: string;
  kind: ClipKind;
}

const KINDS: Record<string, ClipKind> = {
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio",
  ".gif": "image", ".png": "image", ".webp": "image", ".jpg": "image", ".jpeg": "image",
  ".mp4": "video", ".webm": "video",
};

const README = `Wispr Max memes

Drop your meme clips here: audio (.mp3, .wav), GIFs/images and short videos (.mp4, .webm).
Name each file after what it is, for example:
  rani-mukerji-angrezi-mein-gaali-mat-do.mp3
  main-tumhare-baap-ka-naukar-nahi-hoon.mp3
  bombastic-side-eye-dog.gif

Gen Z Max picks the one that fits the moment. To tell it when to use a clip,
add a memes.json file next to them:
  { "rani-mukerji-angrezi-mein-gaali-mat-do.mp3": "when the user swears at Max in English" }
`;

export const defaultMemeFolder = () => path.join(app.getPath("documents"), "Wispr Max memes");

/** Creates the folder (with a how-to) the first time, so people know where to put things. */
export function ensureMemeFolder(folder: string) {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const readme = path.join(folder, "README.txt");
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  } catch {
    // Read-only or missing drive: Max just has no clips.
  }
}

export function listClips(folder: string): Clip[] {
  let notes: Record<string, string> = {};
  try {
    notes = JSON.parse(fs.readFileSync(path.join(folder, "memes.json"), "utf8")) as Record<string, string>;
  } catch {
    // No notes: names alone are fine.
  }
  try {
    return fs
      .readdirSync(folder)
      .filter((f) => KINDS[path.extname(f).toLowerCase()])
      .slice(0, 200)
      .map((f) => {
        const base = path.basename(f, path.extname(f));
        return {
          name: notes[f] ? `${base} (${notes[f]})` : base,
          url: pathToFileURL(path.join(folder, f)).href,
          kind: KINDS[path.extname(f).toLowerCase()],
        };
      });
  } catch {
    return [];
  }
}

/** Matches Max's pick back to a file (it may echo the note too). */
export function findClip(clips: Clip[], picked: string): Clip | undefined {
  const want = picked.trim().toLowerCase();
  if (!want) return undefined;
  return clips.find((c) => c.name.toLowerCase() === want) ?? clips.find((c) => want.startsWith(c.name.split(" (")[0].toLowerCase()));
}

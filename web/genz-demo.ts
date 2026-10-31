import { RemoteWriter } from "../src/core/remote";
import { watchFlowInput } from "../src/renderer/flow-input";
import { toast } from "../src/renderer/app";

// The website's taste of Gen Z Max: say something to it, and it reacts with a
// meme sound and a GIF, exactly like the desktop app does.

const writer = new RemoteWriter(""); // this site's own server
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("genz-input");
const gif = $<HTMLImageElement>("genz-gif");
const say = $("genz-say");
const ghost = $("genz-ghost");
let audio: HTMLAudioElement | null = null;
let busy = false;
const recent: string[] = []; // so Max doesn't play the same meme twice in a row

async function react(text: string) {
  if (busy) return;
  busy = true;
  ghost.dataset.eyes = "left";
  say.classList.remove("hidden");
  say.textContent = "…";
  gif.classList.add("hidden");
  try {
    const r = await writer.react("command", text, undefined, [], undefined, recent);
    for (const n of [r.clip || r.sound, r.gif]) if (n?.trim()) recent.unshift(n.trim());
    recent.splice(8);
    ghost.dataset.eyes = "happy";
    say.textContent = r.skip || !r.say.trim() ? "Hmm. Thoda aur attitude dikhao, phir baat karte hain." : r.say;
    if (r.gifUrl) {
      gif.src = r.gifUrl;
      gif.classList.remove("hidden");
    }
    audio?.pause();
    if (r.soundUrl) {
      audio = new Audio(r.soundUrl);
      void audio.play().catch(() => undefined);
    }
  } catch (err) {
    say.classList.add("hidden");
    toast(err instanceof Error ? err.message : String(err), true);
    ghost.dataset.eyes = "center";
  } finally {
    busy = false;
  }
}

watchFlowInput(input, (text) => void react(text));

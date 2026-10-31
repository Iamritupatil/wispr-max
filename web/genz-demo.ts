import { abuseKind } from "../src/core/intent";
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
const turns: string[] = []; // the conversation so far: Max stays on topic, like on the desktop
const CLIP = { english: "ye-angrezi-gaali-apne-paas-rakh", hindi: "gaali-mat-do-bhai", yell: "chilla-mat-chudail" } as const;

/** What Max hears: your words, the right gaali clip when you swear, and what you two said before. */
function heard(text: string) {
  const kind = abuseKind(text);
  const hint = kind ? `\n\n(Play the clip "${CLIP[kind]}" for this, and caption it with a short comeback.)` : "";
  const history = turns.length ? `\n\n(Our conversation so far, oldest first:\n${turns.slice(-10).join("\n")})` : "";
  return text + hint + history;
}

/** "Am I the best coder alive?": side-eye dog, bruh, and the chicken on the tree screaming. */
async function bestCoderAlive() {
  ghost.dataset.eyes = "left";
  say.classList.remove("hidden");
  say.textContent = "Best coder alive. Sure, bro. Sure.";
  const res = await fetch("/api/gif?q=side%20eye%20dog").catch(() => undefined);
  const url = res?.ok ? ((await res.json()) as { url?: string }).url : undefined;
  if (url) {
    gif.src = url;
    gif.classList.remove("hidden");
  }
  audio?.pause();
  audio = new Audio("https://www.myinstants.com/media/sounds/wshh-vine-bruh-sound-effect.mp3");
  void audio.play().catch(() => undefined);
  setTimeout(() => {
    const chicken = new Audio("https://www.myinstants.com/media/sounds/chicken-on-tree-screaming.mp3");
    chicken.volume = 0.4;
    void chicken.play().catch(() => undefined);
  }, 900);
}

async function react(text: string) {
  if (/\bbest (?:coder|programmer|developer|engineer)\b/i.test(text)) return void bestCoderAlive();
  if (busy) return;
  busy = true;
  ghost.dataset.eyes = "left";
  say.classList.remove("hidden");
  say.textContent = "…";
  gif.classList.add("hidden");
  try {
    const r = await writer.react("command", heard(text), undefined, [], undefined, recent);
    turns.push(`You: ${text}`);
    if (r.say.trim()) turns.push(`Max: ${r.say}`);
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

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-try]"))) {
  b.addEventListener("click", () => {
    input.value = b.dataset.try ?? "";
    void react(input.value);
  });
}

// Max talks first, like on the desktop (no server call until you answer).
say.textContent = "Yo, I'm Max. Roast me, brag to me, or swear at me. I dare you.";
say.classList.remove("hidden");

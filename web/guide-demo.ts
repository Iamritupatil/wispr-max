import { RemoteWriter } from "../src/core/remote";
import { watchFlowInput } from "../src/renderer/flow-input";
import { toast } from "../src/renderer/app";
import { showMemes, stopMemes } from "./memes";
import { grabScreen, sharing, startSharing } from "./screen";
import type { Screenshot } from "../src/shared/types";

// The website's taste of the desktop app's walkthrough: share a tab or window,
// ask how to do something, and Max marks the exact spot on a picture of it,
// with a roast, a GIF and a meme sound. "I did it" looks again for the next step.

const writer = new RemoteWriter(""); // this site's own server
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const share = $<HTMLButtonElement>("gd-share");
const input = $<HTMLInputElement>("gd-q");
const stage = $("gd-stage");
const img = $<HTMLImageElement>("gd-img");
const pin = $("gd-pin");
const say = $("gd-say");
const gif = $<HTMLImageElement>("gd-gif");
const next = $<HTMLButtonElement>("gd-next");
const open = $<HTMLAnchorElement>("gd-open");

let goal = "";
let steps: string[] = [];
let plan: string[] = [];
let busy = false;
/** Trying it on the sample app instead of a shared screen. */
let sample: Screenshot | null = null;

function syncShare() {
  share.textContent = sharing() ? "Sharing ✓ (pick another)" : "Share your tab or window";
}

/** The sample app's screen, as Max would see it. */
async function sampleShot(src: string): Promise<Screenshot> {
  const pic = new Image();
  pic.src = src;
  await pic.decode();
  const canvas = document.createElement("canvas");
  canvas.width = pic.naturalWidth;
  canvas.height = pic.naturalHeight;
  canvas.getContext("2d")!.drawImage(pic, 0, 0);
  return { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg", width: canvas.width, height: canvas.height };
}

share.addEventListener("click", async () => {
  sample = null;
  try {
    await startSharing();
  } catch {
    // The picker was closed: nothing shared, nothing to say.
  }
  syncShare();
});

async function look() {
  const shot = sample ?? grabScreen();
  if (!shot) {
    toast("Share a tab or window first, so Max can see it.", true);
    share.focus();
    return;
  }
  if (busy) return;
  busy = true;
  stage.classList.remove("hidden");
  img.src = `data:${shot.mediaType};base64,${shot.data}`;
  pin.classList.add("hidden");
  gif.classList.add("hidden");
  next.classList.add("hidden");
  open.classList.add("hidden");
  say.textContent = "Looking…";
  try {
    const res = await writer.guide(goal, shot, undefined, steps, true);
    if (res.plan && !plan.length) plan = res.plan;
    const n = plan.length > 1 ? `${Math.min(steps.length + 1, plan.length)}/${plan.length} · ` : "";
    say.textContent = n + res.say;
    if (res.point) {
      pin.style.left = `${res.point.x * 100}%`;
      pin.style.top = `${res.point.y * 100}%`;
      pin.classList.remove("hidden");
    }
    // A GIF and a meme sound every time: whatever didn't come with the answer is fetched on the side.
    stopMemes();
    showMemes(res, gif);
    if (res.openUrl) {
      open.href = res.openUrl;
      open.classList.remove("hidden");
    }
    steps.push(res.say);
    // On the sample app nothing changes when you "click", so it's one step there.
    if (!res.done && !sample) next.classList.remove("hidden");
    stage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    say.textContent = "";
    toast(err instanceof Error ? err.message : String(err), true);
  } finally {
    busy = false;
  }
}

watchFlowInput(input, (text) => {
  if (APPS[app].image) return void askSample(text);
  goal = text;
  steps = [];
  plan = [];
  void look();
});
next.addEventListener("click", () => void look());

// ---------- pick an app: a sample (no setup) or your own screen ----------

const APPS: Record<string, { image?: string; questions: string[] }> = {
  voxly: {
    image: "/sample-app.png",
    questions: ["How do I create a new assistant?", "How do I change the voice of New Assistant to a female voice?", "Where do I publish it?", "Where are the settings?"],
  },
  mailbox: {
    image: "/sample-mail.png",
    questions: ["How do I write a new email?", "How do I reply to Tejas?", "Where are my drafts?", "Where do I change my settings?"],
  },
  own: { questions: [] },
};
const questions = $("gd-questions");
let app = "voxly";

function pickApp(name: string) {
  app = name;
  sample = null;
  for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-app]"))) b.classList.toggle("primary-chip", b.dataset.app === name);
  share.classList.toggle("hidden", name !== "own");
  input.placeholder =
    name === "own" ? "Ask about your shared screen: “how do I …?”, then Enter" : "Or ask anything about this app with Wispr Flow (or type), then Enter";
  // Show the sample app right away, so people see what Max is looking at.
  const image = APPS[name].image;
  stage.classList.toggle("hidden", !image);
  pin.classList.add("hidden");
  gif.classList.add("hidden");
  next.classList.add("hidden");
  open.classList.add("hidden");
  if (image) {
    img.src = image;
    say.textContent = "Pick a question, or ask me anything about this screen.";
  }
  questions.innerHTML = "";
  for (const q of APPS[name].questions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = q;
    chip.addEventListener("click", () => void askSample(q));
    questions.append(chip);
  }
  if (name === "own") input.focus();
}

async function askSample(q: string) {
  sample = await sampleShot(APPS[app].image!);
  goal = q;
  steps = [];
  plan = [];
  void look();
}

for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-app]"))) b.addEventListener("click", () => pickApp(b.dataset.app!));
pickApp("voxly");

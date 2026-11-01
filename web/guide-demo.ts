import { RemoteWriter } from "../src/core/remote";
import { watchFlowInput } from "../src/renderer/flow-input";
import { toast } from "../src/renderer/app";
import { showMemes, stopMemes } from "./memes";
import { grabScreen, sharing, startSharing } from "./screen";
import type { Screenshot } from "../src/shared/types";

// The website's taste of the desktop app's walkthrough: share a tab or window,
// ask how to do something, and Max marks the exact spot on a picture of it,
// with a roast, a GIF and a meme sound. "I did it" looks again for the next step.
// Plus the demo video, with chapters that jump to each part.

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
async function sampleShot(): Promise<Screenshot> {
  const pic = new Image();
  pic.src = "/sample-app.png";
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
  goal = text;
  steps = [];
  plan = [];
  void look();
});
next.addEventListener("click", () => void look());

for (const chip of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-sample]"))) {
  chip.addEventListener("click", async () => {
    sample = await sampleShot();
    goal = chip.dataset.sample ?? "";
    steps = [];
    plan = [];
    void look();
  });
}

// ---------- the demo video, with chapters ----------

const yt = $<HTMLIFrameElement>("yt");
const embed = (start = 0, autoplay = false) =>
  `https://www.youtube-nocookie.com/embed/${yt.dataset.video}?rel=0&start=${start}${autoplay ? "&autoplay=1" : ""}`;
yt.src = embed(); // set here, so the desktop app (which shares this page) never loads it

for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-t], [data-jump]"))) {
  b.addEventListener("click", (e) => {
    e.preventDefault();
    yt.src = embed(Number(b.dataset.t ?? b.dataset.jump), true);
    yt.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

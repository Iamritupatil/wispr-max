import type { OverlayApi } from "../shared/api";
import type { OverlayState, Phase } from "../shared/types";
import { type Eyes, ghostSvg } from "./ghost";
import { Recorder } from "./recorder";

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

const BAR_COUNT = 11;
const $ = (id: string) => document.getElementById(id)!;
const root = $("root");
const wave = $("wave");
const ghost = $("ghost");
const recorder = new Recorder();

ghost.innerHTML = ghostSvg();
for (let i = 0; i < BAR_COUNT; i++) {
  const bar = document.createElement("i");
  bar.style.setProperty("--i", String(i));
  wave.append(bar);
}

// ---------- the ghost's face ----------

let eyesTimer: number | undefined;
const setEyes = (eyes: Eyes) => (ghost.dataset.eyes = eyes);

/** Idle: blink now and then, sometimes glance around. Thinking: look side to side. */
function animateEyes(phase: Phase) {
  clearTimeout(eyesTimer);
  const loop = (fn: () => number) => {
    const next = () => (eyesTimer = window.setTimeout(next, fn()));
    eyesTimer = window.setTimeout(next, fn());
  };
  switch (phase) {
    case "idle":
      setEyes("center");
      loop(() => {
        const r = Math.random();
        if (ghost.dataset.eyes !== "center") setEyes("center");
        else if (r < 0.6) {
          setEyes("closed");
          return 140;
        } else setEyes(r < 0.8 ? "right" : "left");
        return ghost.dataset.eyes === "center" ? 2500 + Math.random() * 2500 : 900;
      });
      break;
    case "transcribing":
    case "thinking": {
      let left = false;
      setEyes("right");
      loop(() => {
        left = !left;
        setEyes(left ? "left" : "right");
        return 420;
      });
      break;
    }
    case "writing":
      setEyes("right"); // reading along as Max writes
      break;
    case "done":
      setEyes("happy");
      break;
    case "error":
      setEyes("closed");
      break;
    default:
      setEyes("center");
  }
}

// ---------- live waveform while listening ----------

const levels: number[] = new Array(BAR_COUNT).fill(0);
function meter() {
  if (!recorder.active || root.dataset.phase !== "listening") {
    ghost.style.removeProperty("--hop");
    return;
  }
  const level = recorder.level();
  levels.shift();
  levels.push(level);
  wave.querySelectorAll("i").forEach((bar, i) => {
    const centered = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / BAR_COUNT;
    // Quantize to 3px steps so the waveform stays pixel-art.
    const h = Math.round((3 + levels[i] * 18 * (0.5 + centered)) / 3) * 3;
    bar.style.height = `${Math.min(21, h)}px`;
  });
  ghost.style.setProperty("--hop", `${-Math.round(level * 4)}px`);
  requestAnimationFrame(meter);
}

// ---------- sounds: tiny 8-bit chimes ----------

let audioCtx: AudioContext | undefined;
function chime(notes: number[]) {
  audioCtx ??= new AudioContext();
  const t0 = audioCtx.currentTime;
  notes.forEach((freq, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t = t0 + i * 0.07;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(audioCtx!.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  });
}

// ---------- state ----------

const LABELS: Record<Phase, (s: OverlayState) => string> = {
  idle: () => "",
  listening: (s) => (s.mode === "max" ? "Max is listening" : "Listening"),
  transcribing: () => "Transcribing",
  thinking: (s) => (s.mode === "max" ? "Max is thinking" : "Polishing"),
  writing: () => "Writing",
  done: (s) =>
    s.message ??
    (s.mode === "max"
      ? `Done${s.app ? ` in ${s.app}` : ""} · also on your clipboard`
      : `Done${s.app ? ` in ${s.app}` : ""}`),
  error: (s) => s.message ?? "Something went wrong.",
};

function render(s: OverlayState) {
  if (root.dataset.phase !== s.phase) animateEyes(s.phase);
  root.dataset.phase = s.phase;
  root.dataset.mode = s.mode;
  $("label").textContent = LABELS[s.phase](s);
  $("to").textContent = s.contacts?.length ? `To: ${s.contacts.join(", ")}` : "";
  $("app").textContent = s.app ?? "";
  $("heard").textContent = s.transcript ? `“${s.transcript}”` : "";
  const text = $("text");
  text.replaceChildren();
  if (s.text) {
    const span = document.createElement("span");
    span.textContent = s.text;
    text.append(span);
  }
  if (s.phase === "listening") requestAnimationFrame(meter);
}

// ---------- drag the ghost anywhere; click it to dictate ----------

const bar = $("bar");
let hovering = false;
let drag: { x: number; y: number; moved: boolean } | null = null;

// The window ignores the mouse except while the pointer is over the ghost.
bar.addEventListener("mouseenter", () => {
  hovering = true;
  window.overlay.setInteractive(true);
});
bar.addEventListener("mouseleave", () => {
  hovering = false;
  if (!drag) window.overlay.setInteractive(false);
});

bar.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  bar.setPointerCapture(e.pointerId);
  window.overlay.dragStart();
});

bar.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x;
  const dy = e.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return; // still a click
  drag.moved = true;
  root.classList.add("dragging");
  window.overlay.drag(dx, dy);
});

const endDrag = (e: PointerEvent) => {
  if (!drag) return;
  const wasClick = !drag.moved && e.type === "pointerup";
  drag = null;
  root.classList.remove("dragging");
  window.overlay.dragEnd();
  if (wasClick) window.overlay.click();
  if (!hovering) window.overlay.setInteractive(false);
};
bar.addEventListener("pointerup", endDrag);
bar.addEventListener("pointercancel", endDrag);

window.overlay.onLayout(({ flip, offsetX }) => {
  root.dataset.flip = String(flip);
  root.style.setProperty("--offset-x", `${offsetX}px`);
});

animateEyes("idle");
window.overlay.onState(render);

window.overlay.onCommand(async (cmd) => {
  try {
    if (cmd.type === "start") {
      if (cmd.sounds) chime([523, 784]);
      await recorder.start();
      requestAnimationFrame(meter);
    } else if (cmd.type === "stop") {
      if (cmd.sounds) chime([784, 523]);
      window.overlay.sendAudio(await recorder.stop());
    } else if (cmd.type === "cancel") {
      await recorder.cancel();
      render({ phase: "idle", mode: "dictate" });
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    window.overlay.sendError(
      name === "NotAllowedError"
        ? "Microphone access is blocked. Allow it in system settings."
        : name === "NotFoundError"
          ? "No microphone found."
          : `Microphone error: ${err instanceof Error ? err.message : err}`,
    );
  }
});

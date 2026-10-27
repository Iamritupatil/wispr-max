import "piixpal/core";
import "piixpal/c/scout";

// First visit only: a little scout walks new people through the demo, in
// Wispr Max's own style, then leaves for good.

const SEEN = "wm.toured";

// The tour cards live in Piixpal's shadow root; theme them with our tokens (custom properties reach inside).
const THEME = `
.card{font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 40px rgba(20,30,28,.18);padding:14px 16px;animation-timing-function:ease-out}
.card.tip::after{display:none}
.card b{font:600 16px/1.3 var(--serif)}
.card h4,.card .row .n{font:500 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:var(--muted);letter-spacing:0;text-transform:none}
.card button,.card a.b{font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;border-radius:9px;padding:8px 14px;background:var(--btn-strong-bg);color:var(--btn-strong-ink);box-shadow:none}
.card button:active{transform:none;box-shadow:none}
.card button.ghost{background:transparent;color:var(--muted);box-shadow:none}
.card button.x{color:var(--muted)}
.card button:focus-visible{outline:2px solid var(--accent)}`;

function theme() {
  const root = document.querySelector("[data-piixpal-ui]")?.shadowRoot;
  if (!root || root.querySelector("style[data-wm]")) return;
  const style = document.createElement("style");
  style.dataset.wm = "";
  style.textContent = THEME;
  root.append(style);
}

let seen = false;
try {
  seen = Boolean(localStorage.getItem(SEEN));
} catch {
  // Private mode: show it.
}

if (!seen && innerWidth > 760) {
  const scout = document.createElement("piix-pal");
  scout.setAttribute("pal", "scout");
  scout.setAttribute("start", "auto");
  scout.setAttribute("at", "1"); // the far end of the card title, out of the way
  document.getElementById("demo-title")?.append(scout);
  // Begin the tour once the scout has landed (start="auto" is a fallback).
  scout.addEventListener("piix:ready", () => setTimeout(() => (scout as HTMLElement & { poke?: () => void }).poke?.(), 900), { once: true });
  document.addEventListener("piix:tour-step", theme);
  new MutationObserver(theme).observe(document.body, { childList: true });
  document.addEventListener("piix:tour-end", () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // fine
    }
    setTimeout(() => scout.remove(), 1500); // a moment to cheer, then gone
  });
}

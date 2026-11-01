// Wispr Max on the page: a little ghost with a box you talk into with Wispr Flow
// (or type). Max looks at the tab, circles the exact button, says the step with a
// roast, a GIF and a meme sound, and when you click, looks again for the next one.
// Esc or the × closes it.
(() => {
  if (window.__wisprMax) return window.__wisprMax.toggle();

  const GHOST = [
    "......OOOOOO......", "....OOWWWWWWOO....", "...OWWWWWWWWWWO...", "..OLWWWWWWWWWWWO..", ".OLWWWWWWWWWWWWWO.",
    ".OLWWWWWWWWWWWWWO.", "OLWWWWWWWWWWWWWWWO", "OLWWWWWWWWWWWWWWWO", "OLWWWWWWWWWWWWWWWO", "OLWWWWWWWWWWWWWWWO",
    "OLWWWWWWWWWWWWWWWO", "OLWWWWWWWWWWWWWWWO", "OLWWWWWWWWWWWWWWWO", "OLLWWWWWWWWWWWWWLO", "OLLLWWWWWWWWWWWLLO",
    "OMLLLWWWWWWWWLLLLO", "OMMLLLLLLLLLLLLLMO", "OMMMLLLLLLLLLLLMMO", "OMMMOLLLLLLLLOMMMO", ".OOO.OMMMMMMO.OOO.", "......OOOOOO......",
  ];
  const C = { O: "#4b6f6c", W: "#ffffff", L: "#d7dfe2", M: "#b5c3c8" };
  let rects = "";
  GHOST.forEach((row, y) => [...row].forEach((c, x) => c !== "." && (rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${C[c]}"/>`)));
  rects += `<rect x="6" y="8" width="1" height="4" fill="${C.O}"/><rect x="11" y="8" width="1" height="4" fill="${C.O}"/>`;
  const ghostSvg = `<svg viewBox="0 0 18 21" width="44" height="52" shape-rendering="crispEdges">${rects}</svg>`;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: Inter, system-ui, sans-serif; }
      .panel { position: fixed; right: 20px; bottom: 20px; width: 340px; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
      .bubble { background: #151c1b; color: #eef3f1; border: 2px solid #6cc4b8; border-radius: 14px; padding: 10px 12px; font-size: 14px; line-height: 1.4; max-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
      .gif { max-width: 220px; max-height: 150px; border-radius: 10px; border: 2px solid #6cc4b8; display: none; }
      .row { display: flex; gap: 8px; align-items: flex-end; width: 100%; }
      input { flex: 1; padding: 10px 12px; border-radius: 12px; border: 1px solid #2a3533; background: #0e1312; color: #eef3f1; font-size: 14px; outline: none; }
      input:focus { border-color: #6cc4b8; }
      .ghost { cursor: pointer; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); }
      .close { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: #2a3533; color: #fff; cursor: pointer; font-size: 13px; }
      .pin { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid #6cc4b8; box-shadow: 0 0 0 4px rgba(0,0,0,.3); animation: p 1.2s ease-in-out infinite; display: none; }
      @keyframes p { 50% { transform: scale(1.25); opacity: .6; } }
      .hidden { display: none !important; }
    </style>
    <div class="pin"></div>
    <div class="panel">
      <button class="close" title="Close (Esc)">×</button>
      <img class="gif" alt="" />
      <div class="bubble">Yo, I'm Max. Click the box, hold your Wispr Flow key and ask me how to do anything on this page. Or type it.</div>
      <div class="row"><input placeholder="Ask Max: “how do I …?”, then Enter" /><span class="ghost">${ghostSvg}</span></div>
    </div>`;
  document.documentElement.append(host);

  const $ = (s) => root.querySelector(s);
  const panel = $(".panel");
  const bubble = $(".bubble");
  const input = $("input");
  const gif = $(".gif");
  const pin = $(".pin");
  let goal = "";
  let steps = [];
  let plan = [];
  let audio = null;
  let waiting = null; // the click listener of the current step
  const send = (msg) => new Promise((ok) => chrome.runtime.sendMessage(msg, ok));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function say(text) {
    bubble.textContent = text;
  }

  function stopWaiting() {
    if (waiting) document.removeEventListener("click", waiting, true);
    waiting = null;
  }

  function close() {
    stopWaiting();
    audio?.pause();
    host.remove();
    delete window.__wisprMax;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey, true);
  $(".close").addEventListener("click", close);
  $(".ghost").addEventListener("click", () => input.focus());

  /** Screenshot of the tab, without Max on it, with its pixel size. */
  async function screenshot() {
    host.style.visibility = "hidden";
    await sleep(60);
    const shot = await send({ type: "look" });
    host.style.visibility = "";
    if (!shot?.url) throw new Error(shot?.error || "I couldn't see this tab. Click the Wispr Max icon again.");
    const img = new Image();
    img.src = shot.url;
    await img.decode();
    return { data: shot.url.split(",")[1], mediaType: "image/jpeg", width: img.naturalWidth, height: img.naturalHeight };
  }

  function memes(res) {
    const show = (url) => {
      if (!url) return;
      gif.src = url;
      gif.style.display = "block";
    };
    const play = (url) => {
      if (!url) return;
      audio?.pause();
      audio = new Audio(url);
      audio.play().catch(() => {});
    };
    gif.style.display = "none";
    if (res.gifUrl) show(res.gifUrl);
    else send({ type: "meme", kind: "gif", q: res.gif || res.say || "reaction" }).then((r) => show(r?.url));
    if (res.soundUrl) play(res.soundUrl);
    else send({ type: "meme", kind: "sound", q: res.sound || "bruh" }).then((r) => play(r?.url));
  }

  async function look() {
    stopWaiting();
    pin.style.display = "none";
    say("Looking…");
    try {
      const shot = await screenshot();
      const reply = await send({ type: "guide", body: { question: goal, screenshot: shot, steps, genz: true } });
      if (!reply?.result) throw new Error(reply?.error || "Max couldn't answer.");
      const res = reply.result;
      if (res.plan && !plan.length) plan = res.plan;
      const n = plan.length > 1 ? `${Math.min(steps.length + 1, plan.length)}/${plan.length} · ` : "";
      say(n + res.say);
      memes(res);
      steps.push(res.say);
      if (res.openUrl) {
        window.open(res.openUrl, "_blank", "noopener");
        return;
      }
      if (res.point) {
        pin.style.left = `${res.point.x * innerWidth}px`;
        pin.style.top = `${res.point.y * innerHeight}px`;
        pin.style.display = "block";
      }
      // Not done yet: when you click, Max looks again for the next step.
      if (!res.done && steps.length < 6) {
        waiting = (e) => {
          if (host.contains(e.target)) return;
          stopWaiting();
          pin.style.display = "none";
          say("Nice. Checking…");
          setTimeout(look, 1200);
        };
        document.addEventListener("click", waiting, true);
      }
    } catch (err) {
      say(err.message || String(err));
    }
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the page's own shortcuts stay out of Max's box
    if (e.key !== "Enter" || !input.value.trim()) return;
    goal = input.value.trim();
    input.value = "";
    steps = [];
    plan = [];
    look();
  });
  // Wispr Flow types the whole sentence in one go: send it a moment after it lands.
  let settle;
  input.addEventListener("input", (e) => {
    clearTimeout(settle);
    if (e.inputType === "insertFromPaste" || e.inputType === "insertText" && e.data && e.data.length > 3) {
      settle = setTimeout(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })), 700);
    }
  });

  window.__wisprMax = { toggle: () => (panel.classList.contains("hidden") ? (panel.classList.remove("hidden"), input.focus()) : close()) };
  input.focus();
})();

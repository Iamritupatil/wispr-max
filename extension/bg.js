// Wispr Max in Chrome. Clicking the toolbar ghost (or Alt+M) puts Max on the page;
// this worker takes the screenshots and talks to the Wispr Max server for it.

const SERVER = "https://wispr-max.vercel.app";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["max.js"] }).catch(() => {
    // Chrome's own pages (chrome://, the Web Store) can't have extensions on them.
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "look") {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 70 })
      .then((url) => reply({ url }))
      .catch((err) => reply({ error: err.message }));
    return true;
  }
  if (msg.type === "guide") {
    ask("guide", msg.body)
      .then((result) => reply({ result }))
      .catch((err) => reply({ error: err.message }));
    return true;
  }
  if (msg.type === "meme") {
    fetch(`${SERVER}/api/${msg.kind}?q=${encodeURIComponent(msg.q.slice(0, 80))}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => reply({ url: j.url }))
      .catch(() => reply({}));
    return true;
  }
});

/** One request to the Wispr Max server; it answers in lines of JSON, the last one the result. */
async function ask(op, body) {
  const res = await fetch(`${SERVER}/api/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...body }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Max couldn't answer (${res.status}).`);
  }
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.t === "done") return event.result;
    if (event.t === "error") throw new Error(event.message);
  }
  throw new Error("Max stopped before answering.");
}

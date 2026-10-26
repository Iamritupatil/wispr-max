import type { UpdateState } from "../src/shared/types";

// The web app installs like a real app (a PWA) and updates like one: each
// deploy ships a new service worker, which waits until you press Update.

declare const __VERSION__: string;

let state: UpdateState = { status: "idle", current: __VERSION__, kind: "web" };
const listeners = new Set<(s: UpdateState) => void>();
let registration: ServiceWorkerRegistration | undefined;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
  return state;
}

export const updateState = () => state;
export const onUpdate = (cb: (s: UpdateState) => void) => void listeners.add(cb);

function offer(worker: ServiceWorker) {
  set({ status: "available", message: "A new version of Wispr Max is ready." });
  worker.addEventListener("statechange", () => {
    if (worker.state === "redundant") set({ status: "idle", message: undefined });
  });
}

function watch(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      // The first install isn't an update; only a worker replacing another one is.
      if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
    });
  });
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!registration) return set({ status: "none", message: "Updates need the installed app or a secure (https) page." });
  if (state.status === "available") return state;
  set({ status: "checking", message: undefined });
  try {
    await registration.update();
    // A found update finishes installing in the background, then calls offer().
    await new Promise((r) => setTimeout(r, 1200));
    if (registration.waiting) offer(registration.waiting);
    return updateState().status === "available" ? state : set({ status: "none", message: "You're on the latest version." });
  } catch {
    return set({ status: "error", message: "Couldn't check for updates. Are you offline?" });
  }
}

export async function installUpdate(): Promise<UpdateState> {
  const waiting = registration?.waiting;
  if (!waiting) return checkForUpdates();
  set({ status: "installing", message: "Updating…" });
  // The new worker takes over, then the page reloads into the new version.
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  waiting.postMessage("SKIP_WAITING");
  return state;
}

// ---------- install as an app ----------

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<(canInstall: boolean) => void>();

export const installed = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function onInstallable(cb: (canInstall: boolean) => void) {
  installListeners.add(cb);
  cb(Boolean(installPrompt));
}

export async function install(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installListeners.forEach((l) => l(false));
  return outcome === "accepted";
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
  installListeners.forEach((l) => l(true));
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installListeners.forEach((l) => l(false));
});

if ("serviceWorker" in navigator && isSecureContext) {
  void navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      registration = reg;
      watch(reg);
      // Long-lived tabs and installed apps check now and then.
      setInterval(() => void reg.update().catch(() => undefined), 30 * 60 * 1000);
    })
    .catch(() => undefined);
}

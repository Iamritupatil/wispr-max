// The web app's entry: the browser bridge first (window.wispr), then the same
// app the desktop window runs, then the web-only parts.
import "./web-api";
import "../src/renderer/app";
import "./float-ghost";
import { install, installed, onInstallable } from "./pwa";

const installButtons = () => document.querySelectorAll<HTMLButtonElement>("[data-install]");

onInstallable((canInstall) => {
  installButtons().forEach((b) => b.classList.toggle("hidden", !canInstall));
  document.querySelectorAll<HTMLElement>("[data-installed]").forEach((el) => {
    el.textContent = installed() ? "Installed. You're using the app." : canInstall ? "" : "Use your browser's menu to install it (Install app, or Add to Home Screen).";
  });
});

document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-install]")) void install();
});

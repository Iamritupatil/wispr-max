import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "../shared/api";

const api: AppApi = {
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveSettings: (patch) => ipcRenderer.invoke("app:save-settings", patch),
  saveContact: (contact) => ipcRenderer.invoke("app:save-contact", contact),
  deleteContact: (id) => ipcRenderer.invoke("app:delete-contact", id),
  importContacts: () => ipcRenderer.invoke("app:import-contacts"),
  addSampleContacts: () => ipcRenderer.invoke("app:add-samples"),
  quickAddContacts: (text) => ipcRenderer.invoke("app:quick-add", text),
  clearHistory: () => ipcRenderer.invoke("app:clear-history"),
  compose: (req) => ipcRenderer.invoke("app:compose", req),
  smart: (req) => ipcRenderer.invoke("app:smart", req),
  onComposeText: (cb) => ipcRenderer.on("app:compose-text", (_e, text) => cb(text)),
  transcribe: (audio) => ipcRenderer.invoke("app:transcribe", audio),
  requestAccessibility: () => ipcRenderer.invoke("app:request-accessibility"),
  copy: (text) => ipcRenderer.invoke("app:copy", text),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openDraft: (draft) => ipcRenderer.invoke("app:open-draft", draft),
  onHistory: (cb) => ipcRenderer.on("app:history", (_e, update) => cb(update)),
  onNavigate: (cb) => ipcRenderer.on("app:navigate", (_e, tab) => cb(tab)),
};

contextBridge.exposeInMainWorld("wispr", api);

import { contextBridge, ipcRenderer } from "electron";
import type { OverlayApi } from "../shared/api";

const api: OverlayApi = {
  onCommand: (cb) => ipcRenderer.on("overlay:command", (_e, cmd) => cb(cmd)),
  onState: (cb) => ipcRenderer.on("overlay:state", (_e, state) => cb(state)),
  sendAudio: (payload) => ipcRenderer.send("overlay:audio", payload),
  sendError: (message) => ipcRenderer.send("overlay:error", message),
};

contextBridge.exposeInMainWorld("overlay", api);

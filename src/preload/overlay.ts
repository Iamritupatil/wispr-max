import { contextBridge, ipcRenderer } from "electron";
import type { OverlayApi } from "../shared/api";

const api: OverlayApi = {
  onCommand: (cb) => ipcRenderer.on("overlay:command", (_e, cmd) => cb(cmd)),
  onState: (cb) => ipcRenderer.on("overlay:state", (_e, state) => cb(state)),
  sendAudio: (payload) => ipcRenderer.send("overlay:audio", payload),
  sendError: (message) => ipcRenderer.send("overlay:error", message),
  onLayout: (cb) => ipcRenderer.on("overlay:layout", (_e, layout) => cb(layout)),
  setInteractive: (on) => ipcRenderer.send("overlay:interactive", on),
  dragStart: () => ipcRenderer.send("overlay:drag-start"),
  drag: (dx, dy) => ipcRenderer.send("overlay:drag", dx, dy),
  dragEnd: () => ipcRenderer.send("overlay:drag-end"),
  click: () => ipcRenderer.send("overlay:click"),
};

contextBridge.exposeInMainWorld("overlay", api);

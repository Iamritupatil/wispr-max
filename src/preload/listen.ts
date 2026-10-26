import { contextBridge, ipcRenderer } from "electron";
import type { ListenApi } from "../shared/api";

const api: ListenApi = {
  onOpen: (cb) => ipcRenderer.on("listen:open", (_e, opts) => cb(opts)),
  onSubmitNow: (cb) => ipcRenderer.on("listen:submit-now", () => cb()),
  submit: (text) => ipcRenderer.send("listen:submit", text),
  cancel: () => ipcRenderer.send("listen:cancel"),
};

contextBridge.exposeInMainWorld("listen", api);

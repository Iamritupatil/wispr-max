import type { Settings } from "./types";

/** The hosted backend: it holds the API key, so nobody using Wispr Max needs one. */
export const CLOUD_URL = "https://wispr-max.vercel.app";

export const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  model: "claude-haiku-5-5",
  effort: "low",
  sttProvider: "assemblyai",
  assemblyaiApiKey: "",
  groqApiKey: "",
  openaiApiKey: "",
  language: "",
  dictateHotkey: "CommandOrControl+Shift+Space",
  maxHotkey: "CommandOrControl+Shift+M",
  polishDictation: true,
  useSelection: true,
  keepResultOnClipboard: true,
  smartIntent: true,
  sounds: true,
  showIdleGhost: true,
  theme: "system",
  emailDrafts: "gmail",
  styles: { personal: "casual", work: "casual", email: "formal", other: "formal" },
  dictionary: [],
  snippets: [],
  profile: { name: "", role: "", email: "", signature: "", style: "" },
  voiceInput: "flow",
  screenContext: true,
  listenToFlow: true,
  flowRequests: "auto",
  cloudUrl: CLOUD_URL,
};

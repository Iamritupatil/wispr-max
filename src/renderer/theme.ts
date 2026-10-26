import type { Settings } from "../shared/types";

/** Light or dark on request; "system" follows the OS (the CSS media query). */
export function applyTheme(theme: Settings["theme"] = "system", doc: Document = document) {
  if (theme === "system") delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = theme;
}

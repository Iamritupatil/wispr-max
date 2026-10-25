import type { DictionaryEntry, Snippet } from "../shared/types";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a spoken phrase whatever punctuation or casing the transcriber gave it. */
function phraseRe(phrase: string) {
  const words = phrase.trim().split(/\s+/).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\d])${words.join("[\\s,.;:!?-]+")}(?![\\p{L}\\d])`, "giu");
}

/** Fixes words the speech model reliably mishears ("whisper max" → "Wispr Max"). */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  let out = text;
  for (const e of entries) {
    if (e.heardAs?.trim() && e.word.trim()) out = out.replace(phraseRe(e.heardAs), e.word.trim());
  }
  return out;
}

/** Swaps spoken snippet cues for their saved text. Trailing punctuation the
 *  transcriber attached to the cue is dropped so links stay clickable. */
export function expandSnippets(text: string, snippets: Snippet[]): string {
  let out = text;
  for (const s of snippets) {
    if (!s.trigger.trim() || !s.text) continue;
    const re = new RegExp(`${phraseRe(s.trigger).source}[.!?]?`, "giu");
    out = out.replace(re, () => s.text);
  }
  return out;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

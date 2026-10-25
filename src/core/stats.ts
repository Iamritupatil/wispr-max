export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Consecutive days with a session, ending today (or yesterday, so a streak survives until you skip a whole day). */
export function streak(days: string[], today = new Date()): number {
  const set = new Set(days);
  const d = new Date(today);
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Words per minute while speaking. */
export function wpm(words: number, ms: number): number {
  return ms > 0 ? Math.round(words / (ms / 60_000)) : 0;
}

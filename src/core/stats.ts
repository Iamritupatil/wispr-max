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

import type { Mode, Stats } from "../shared/types";

export function emptyStats(): Stats {
  return { words: 0, ms: 0, sessions: 0, days: [], daily: {}, apps: {}, maxSessions: 0 };
}

/** Adds one finished session to the usage totals (returns the same object, updated). */
export function addUse(stats: Stats, words: number, ms: number, session: { mode: Mode; app?: string }, now = new Date()): Stats {
  const today = localDay(now);
  const isMax = session.mode === "max";
  stats.words += words;
  stats.ms += ms;
  stats.sessions += 1;
  if (isMax) stats.maxSessions += 1;
  if (!stats.days.includes(today)) stats.days = [...stats.days, today].slice(-400);
  const day = (stats.daily[today] ??= { words: 0, ms: 0, sessions: 0, max: 0 });
  day.words += words;
  day.ms += ms;
  day.sessions += 1;
  if (isMax) day.max += 1;
  // Keep a year of daily totals.
  for (const key of Object.keys(stats.daily).sort().slice(0, -400)) delete stats.daily[key];
  const app = session.app?.trim() || "Other";
  stats.apps[app] = (stats.apps[app] ?? 0) + words;
  return stats;
}

/** Average typing speed, for "time saved". */
export const TYPING_WPM = 40;

/** Time you'd have spent typing the same words, minus the time spent talking. */
export function timeSavedMs(words: number, spokenMs: number): number {
  return Math.max(0, (words / TYPING_WPM) * 60_000 - spokenMs);
}

/** "2h 15m", "12m", "45s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Words per day for the last `n` days, oldest first, including empty days. */
export function lastDays(
  daily: Record<string, { words: number }>,
  n: number,
  today = new Date(),
): { day: string; words: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    const day = localDay(d);
    return { day, words: daily[day]?.words ?? 0 };
  });
}

/** Apps by words written, biggest first; the rest fold into "Other". */
export function topApps(apps: Record<string, number>, n: number): { app: string; words: number }[] {
  const sorted = Object.entries(apps)
    .map(([app, words]) => ({ app, words }))
    .filter((a) => a.words > 0)
    .sort((a, b) => b.words - a.words);
  if (sorted.length <= n) return sorted;
  const rest = sorted.slice(n - 1).reduce((sum, a) => sum + a.words, 0);
  return [...sorted.slice(0, n - 1), { app: "Other", words: rest }];
}

/** Words per minute while speaking. */
export function wpm(words: number, ms: number): number {
  return ms > 0 ? Math.round(words / (ms / 60_000)) : 0;
}

// Meme sounds from Myinstants (myinstants.com) when none of the user's own clips
// fit: its JSON API first (/api/v1/instants/?name=…), the search page as a
// fallback. Best effort: finding nothing just means no sound.

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://www.myinstants.com";

/** The play('/media/sounds/…mp3') links on a Myinstants search page. */
export function soundsInPage(html: string): string[] {
  return [...html.matchAll(/play\('([^']+\.mp3)'/g)].map((m) => new URL(m[1], BASE).href);
}

/** The first .mp3 in an API result, wherever the field lives ("sound" today). */
export function soundsInApi(body: unknown): string[] {
  const results = (body as { results?: Record<string, unknown>[] })?.results ?? [];
  return results
    .map((r) => Object.values(r).find((v): v is string => typeof v === "string" && /\.mp3(\?|$)/i.test(v)))
    .filter((v): v is string => Boolean(v))
    .map((v) => new URL(v, BASE).href);
}

const HEADERS = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" };

export async function findSound(query: string, fetchFn: FetchLike = fetch): Promise<string | undefined> {
  if (!query.trim()) return undefined;
  const q = encodeURIComponent(query);
  try {
    const res = await fetchFn(`${BASE}/api/v1/instants/?format=json&name=${q}&page=1`, { headers: { ...HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      // One of the top three clean matches, so the same request doesn't always sound the same.
      const body = (await res.json()) as { results?: Record<string, unknown>[] };
      const hits = (body.results ?? [])
        .map((r) => ({ name: String(r.name ?? ""), url: soundsInApi({ results: [r] })[0] ?? "" }))
        .filter((h) => h.url && isClean(h))
        .slice(0, 3)
        .map((h) => h.url);
      if (hits.length) return hits[Math.floor(Math.random() * hits.length)];
    }
  } catch {
    // fall through to the search page
  }
  try {
    const res = await fetchFn(`${BASE}/en/search/?name=${q}`, { headers: HEADERS, signal: AbortSignal.timeout(3500) });
    return res.ok ? soundsInPage(await res.text()).find((url) => isClean({ url })) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Max's built-in reactions: Indian meme sounds for moments everyone has, each
 * with when to use it. Max picks among them, and remembers its recent picks so
 * it doesn't repeat itself.
 */
const SOUNDS = "https://www.myinstants.com/media/sounds/";
export const BUILTIN_SOUNDS: { name: string; when: string; url?: string; slug?: string }[] = [
  { name: "ye-angrezi-gaali-apne-paas-rakh", slug: "ye-angrezi-gaali-apne-paas-56434", when: "ONLY when the user abuses Max with English swear words aimed at it ('f*** you Max', 'Max you b****'). Not for criticism or casual swearing" },
  { name: "gaali-mat-do-bhai", url: `${SOUNDS}gali-mat-do-bhai-by-pankaj.mp3`, when: "ONLY when the user abuses Max with Hindi gaali" },
  { name: "chilla-mat-chudail", slug: "chilla-mat-chudail-51952", when: "when the user is yelling or shouting at Max, in any language" },
  { name: "tu-kyu-chilla-raha", url: `${SOUNDS}tu-kyu-chilla-raha.mp3`, when: "when the user is yelling or shouting at Max (an alternative to chilla-mat-chudail)" },
  { name: "emotional-damage", url: `${SOUNDS}emotional-damage.mp3`, when: "when the user roasts or criticises Max, or Max sees something brutal (a harsh rejection, a savage reply)" },
  { name: "moye-moye", url: `${SOUNDS}moye-moye.mp3`, when: "for a fail, a rejection or a sad moment" },
  { name: "shabash-beta", url: `${SOUNDS}shabash-beta.mp3`, when: "for a win, good news, or when the user is sweet or does something well" },
  { name: "yeh-kya-baat-hui", url: `${SOUNDS}yeh-kya-baat-hui.mp3`, when: "when something is unfair or disappointing" },
  { name: "kaske-jhoota", url: `${SOUNDS}kaske-jhoota.mp3`, when: "when the user is lying, faking, larping or hiding something" },
  { name: "kyu-bhai", url: `${SOUNDS}tmp23x4wjtl.mp3`, when: "when the user asks something baffling, or Max is confused why" },
  { name: "sochna-padta-hai-re", url: `${SOUNDS}sochna-pdta-hai-re-hindustani-bhau.mp3`, when: "when the user asks Max to think hard or decide something" },
];

/** The built-in's sound file: its known address, or looked up by slug. */
export async function builtinSound(b: (typeof BUILTIN_SOUNDS)[number], fetchFn: FetchLike = fetch): Promise<string | undefined> {
  return b.url ?? (b.slug ? instantSound(b.slug, fetchFn) : undefined);
}

/** Myinstants is user-uploaded and some clips are explicit (sometimes under innocent titles). Never play those. */
const EXPLICIT = /madarchod|bh?e+n+chod|chutiy|\bchut\b|lund|lawd|lavd|\bgaand|bsdk|bhosd|randi|harami|\bfuck|bitch|\bslut|\bporn|\bsex|\bnsfw/i;
export const isClean = (s: { name?: string; url: string }) => !EXPLICIT.test(`${s.name ?? ""} ${s.url}`);

/** One Myinstants instant, by its slug: the API's detail first, then its page. */
export async function instantSound(slug: string, fetchFn: FetchLike = fetch): Promise<string | undefined> {
  try {
    const res = await fetchFn(`${BASE}/api/v1/instants/${encodeURIComponent(slug)}/?format=json`, { headers: { ...HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const hit = soundsInApi({ results: [await res.json()] })[0];
      if (hit) return hit;
    }
  } catch {
    // fall through to the page
  }
  try {
    const res = await fetchFn(`${BASE}/en/instant/${encodeURIComponent(slug)}/`, { headers: HEADERS, signal: AbortSignal.timeout(3500) });
    if (!res.ok) return undefined;
    const html = await res.text();
    return soundsInPage(html)[0] ?? html.match(/\/media\/sounds\/[^"'\s]+\.mp3/)?.[0]?.replace(/^/, BASE);
  } catch {
    return undefined;
  }
}

/** Top matches with their names (for picking good built-ins). */
export async function searchSounds(query: string, fetchFn: FetchLike = fetch): Promise<{ name: string; slug: string; url: string }[]> {
  try {
    const res = await fetchFn(`${BASE}/api/v1/instants/?format=json&name=${encodeURIComponent(query)}&page=1`, { headers: { ...HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const { results = [] } = (await res.json()) as { results?: Record<string, unknown>[] };
    return results.slice(0, 10).map((r) => ({ name: String(r.name ?? ""), slug: String(r.slug ?? ""), url: soundsInApi({ results: [r] })[0] ?? "" }));
  } catch {
    return [];
  }
}

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
      const hit = soundsInApi(await res.json())[0];
      if (hit) return hit;
    }
  } catch {
    // fall through to the search page
  }
  try {
    const res = await fetchFn(`${BASE}/en/search/?name=${q}`, { headers: HEADERS, signal: AbortSignal.timeout(3500) });
    return res.ok ? soundsInPage(await res.text())[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Max's built-in reactions: Myinstants sounds for moments everyone has. The more specific one comes first. */
export const BUILTIN_SOUNDS = [
  { name: "ye-angrezi-gaali-apne-paas-rakh", slug: "ye-angrezi-gaali-apne-paas-56434", when: "the user cusses or swears at Max in English" },
  { name: "chilla-mat-chudail", slug: "chilla-mat-chudail-51952", when: "the user sounds angry, shouts at Max or cusses at it (not in English)" },
] as const;

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

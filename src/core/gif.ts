// Reaction GIFs from GIPHY (licensed for this use). Needs a free GIPHY API key
// on the server (GIPHY_API_KEY); without one, Max still reacts, just no GIF.
// "translate" picks the single GIF that best matches a phrase, so the GIF fits
// the moment instead of being a random search hit.

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Gif = { images?: { fixed_height?: { url: string } } };

export async function findGif(query: string, apiKey: string | undefined, fetchFn: FetchLike = fetch): Promise<string | undefined> {
  if (!apiKey || !query.trim()) return undefined;
  const key = encodeURIComponent(apiKey);
  const q = encodeURIComponent(query);
  try {
    const res = await fetchFn(`https://api.giphy.com/v1/gifs/translate?api_key=${key}&s=${q}&weirdness=0&rating=pg-13`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const url = ((await res.json()) as { data?: Gif }).data?.images?.fixed_height?.url;
      if (url) return url;
    }
    const search = await fetchFn(`https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${q}&limit=1&rating=pg-13`, { signal: AbortSignal.timeout(3000) });
    if (!search.ok) return undefined;
    return ((await search.json()) as { data: Gif[] }).data[0]?.images?.fixed_height?.url;
  } catch {
    return undefined; // a missing GIF never breaks the joke
  }
}

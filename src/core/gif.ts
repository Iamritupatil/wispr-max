// Reaction GIFs from GIPHY (licensed for this use). Needs a free GIPHY API key
// on the server (GIPHY_API_KEY); without one, Max still talks, just no GIF.

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function findGif(query: string, apiKey: string | undefined, fetchFn: FetchLike = fetch): Promise<string | undefined> {
  if (!apiKey || !query.trim()) return undefined;
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=10&rating=pg-13`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    const { data } = (await res.json()) as { data: { images: { fixed_height?: { url: string } } }[] };
    const pick = data[Math.floor(Math.random() * Math.min(data.length, 6))];
    return pick?.images.fixed_height?.url;
  } catch {
    return undefined; // a missing GIF never breaks the joke
  }
}

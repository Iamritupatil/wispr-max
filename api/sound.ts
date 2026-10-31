import { findSound, instantSound, searchSounds } from "../src/core/sound";
import { json, rateLimited } from "./_lib";

/** GET /api/sound?q=bruh: the meme sound Max would play (also handy for checking Myinstants works). */
export async function GET(request: Request) {
  const limited = rateLimited(request, "sound", 60);
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  if (params.has("list")) return json({ results: await searchSounds((params.get("q") ?? "").slice(0, 80)) });
  const slug = params.get("slug");
  const url = slug ? await instantSound(slug.slice(0, 80)) : await findSound((params.get("q") ?? "").slice(0, 80));
  return json(url ? { url } : { error: "No sound found." }, url ? 200 : 404);
}

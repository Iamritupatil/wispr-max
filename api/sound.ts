import { findSound } from "../src/core/sound";
import { json, rateLimited } from "./_lib";

/** GET /api/sound?q=bruh: the meme sound Max would play (also handy for checking Myinstants works). */
export async function GET(request: Request) {
  const limited = rateLimited(request, "sound", 60);
  if (limited) return limited;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const url = await findSound(q.slice(0, 80));
  return json(url ? { url } : { error: "No sound found." }, url ? 200 : 404);
}

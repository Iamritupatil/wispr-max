import { findGif } from "../src/core/gif";
import { json, rateLimited } from "./_lib";

/** GET /api/gif?q=facepalm: the GIF Max would show (also a quick check that GIPHY works). */
export async function GET(request: Request) {
  const limited = rateLimited(request, "gif", 60);
  if (limited) return limited;
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const url = await findGif(q, process.env.GIPHY_API_KEY);
  return json(url ? { url } : { error: process.env.GIPHY_API_KEY ? "No GIF found." : "GIPHY_API_KEY isn't set." }, url ? 200 : 404);
}

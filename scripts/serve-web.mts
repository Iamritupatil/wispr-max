// Runs the web app locally, the way Vercel serves it: web-dist/ as files and
// api/ as functions. Run with: npm run web (put ANTHROPIC_API_KEY in your
// environment first). WISPR_MAX_API=http://host sends /api calls there instead.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const ROOT = path.resolve("web-dist");
const PORT = Number(process.env.PORT ?? 3000);
const PROXY = process.env.WISPR_MAX_API;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

type Handler = (request: Request) => Response | Promise<Response>;

async function api(name: string, request: Request): Promise<Response> {
  if (PROXY) return fetch(`${PROXY}/api/${name}`, request);
  if (!/^[a-z]+$/.test(name)) return new Response("Not found", { status: 404 });
  const mod = (await import(`../api/${name}.ts`).catch(() => null)) as Record<string, Handler> | null;
  const handler = mod?.[request.method];
  return handler ? handler(request) : new Response("Not found", { status: 404 });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body,
          duplex: "half",
        } as RequestInit);
        const response = await api(url.pathname.slice(5), request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) for await (const chunk of response.body) res.write(chunk);
        return res.end();
      }
      let file = path.join(ROOT, path.normalize(url.pathname));
      if (!file.startsWith(ROOT)) throw new Error("outside");
      if (!(await fs.stat(file).catch(() => null))?.isFile()) file = path.join(ROOT, "index.html");
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(await fs.readFile(file));
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  })
  .listen(PORT, () => console.log(`Wispr Max web on http://localhost:${PORT}${PROXY ? ` (API: ${PROXY})` : ""}`));

import { json } from "./_lib";

// The Download button: straight to the installer for this computer, from the
// newest GitHub release, so nobody lands on a GitHub page. Works whatever the
// files are called (Wispr-Max-Setup-0.3.0.exe, …).

const REPO = "Iamritupatil/wispr-max";
type Asset = { name: string; browser_download_url: string };
type Release = { draft: boolean; assets: Asset[] };

let cache: { at: number; releases: Release[] } | null = null;

async function releases(): Promise<Release[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.releases;
  const get = (token?: string) =>
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "wispr-max-download",
        ...(token && { authorization: `Bearer ${token}` }),
      },
    });
  // A token only raises GitHub's rate limit; if it's bad, ask without one.
  let res = await get(process.env.GITHUB_TOKEN);
  if (!res.ok && process.env.GITHUB_TOKEN) res = await get();
  if (!res.ok) throw new Error("Couldn't reach GitHub for the installer. Try again in a minute.");
  const list = ((await res.json()) as Release[]).filter((r) => !r.draft);
  cache = { at: Date.now(), releases: list };
  return list;
}

export function pickAsset(assets: Asset[], os: string, arch: string): Asset | undefined {
  const real = assets.filter((a) => !/\.(blockmap|yml|yaml)$/i.test(a.name));
  if (os === "mac") {
    const dmgs = real.filter((a) => /\.dmg$/i.test(a.name));
    return dmgs.find((a) => a.name.includes(arch)) ?? dmgs.find((a) => !/arm64|x64/.test(a.name)) ?? dmgs[0] ?? real.find((a) => /mac.*\.zip$/i.test(a.name));
  }
  if (os === "linux") return real.find((a) => /\.AppImage$/i.test(a.name));
  return real.find((a) => /\.exe$/i.test(a.name)) ?? real.find((a) => /\.msi$/i.test(a.name));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const os = url.searchParams.get("os") ?? "win";
  const arch = url.searchParams.get("arch") ?? "x64";
  try {
    for (const release of await releases()) {
      const asset = pickAsset(release.assets, os, arch);
      if (asset) {
        return new Response(null, {
          status: 302,
          headers: { location: asset.browser_download_url, "cache-control": "public, s-maxage=300" },
        });
      }
    }
  } catch (err) {
    if (url.searchParams.has("check")) return json({ ok: false, error: (err as Error).message }, 502);
  }
  if (url.searchParams.has("check")) return json({ ok: false, error: "No published installer for this computer yet." }, 404);
  // Nothing published for this computer yet: back to the app, which explains.
  return new Response(null, { status: 302, headers: { location: `/?download=unavailable&os=${encodeURIComponent(os)}` } });
}

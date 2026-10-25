import type { Contact, ContactLink } from "../shared/types";

// One-paste contacts: a LinkedIn or X link, a WhatsApp number, an email, a phone
// number, or a sentence about someone. Everything here is offline and instant;
// the main process can enrich the result from the profile page afterwards.

const PLATFORMS: { platform: string; re: RegExp; handle?: (m: RegExpMatchArray) => string }[] = [
  { platform: "LinkedIn", re: /(?:^|\/\/|\.)linkedin\.com\/in\/([^/?#\s]+)/i },
  { platform: "X", re: /(?:^|\/\/|\.)(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?=$|[/?#])/i },
  { platform: "Instagram", re: /(?:^|\/\/|\.)instagram\.com\/([A-Za-z0-9_.]{1,30})(?=$|[/?#])/i },
  { platform: "GitHub", re: /(?:^|\/\/|\.)github\.com\/([A-Za-z0-9-]{1,39})(?=$|[/?#])/i },
  { platform: "Facebook", re: /(?:^|\/\/|\.)facebook\.com\/([A-Za-z0-9.]{3,})(?=$|[/?#])/i },
  { platform: "Threads", re: /(?:^|\/\/|\.)threads\.(?:net|com)\/@([A-Za-z0-9_.]+)/i },
  { platform: "Telegram", re: /(?:^|\/\/)t\.me\/([A-Za-z0-9_]{4,})/i },
  { platform: "WhatsApp", re: /(?:^|\/\/)wa\.me\/\+?(\d{7,15})/i },
];

// Paths on these sites that are pages, not people.
const NOT_PEOPLE = /^(home|login|signup|explore|search|settings|about|help|share|intent|i|p|reel|reels|stories|watch|pages|groups|orgs|features|marketplace)$/i;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL_TOKEN = /^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?$/i;

export interface ParsedContactInput {
  name?: string;
  /** True when the name was only guessed from a link or email address. */
  nameGuessed: boolean;
  email?: string;
  phone?: string;
  links: ContactLink[];
  /** Words left over after the links, email and number: a description to read. */
  description: string;
}

const titleCase = (words: string[]) =>
  words.map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");

/** "priya-sharma-1a2b3c4d" → "Priya Sharma" (LinkedIn adds a random suffix). */
export function nameFromSlug(slug: string): string | undefined {
  const words = decodeURIComponent(slug)
    .split(/[-_.]+/)
    .filter(Boolean)
    .filter((w) => !/\d/.test(w)); // drop LinkedIn's id suffix
  if (!words.length || words.some((w) => !/^\p{L}+$/u.test(w))) return undefined;
  return titleCase(words);
}

/** "priya.sharma@…" → "Priya Sharma"; "ps1987@…" → undefined. */
function nameFromEmail(email: string): string | undefined {
  const local = email.split("@")[0].split("+")[0];
  if (!/[._-]/.test(local)) return undefined;
  return nameFromSlug(local);
}

function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  return (raw.trim().startsWith("+") ? "+" : "") + digits;
}

function toUrl(token: string) {
  return /^https?:\/\//i.test(token) ? token : `https://${token}`;
}

export function parseContactInput(text: string): ParsedContactInput {
  const out: ParsedContactInput = { nameGuessed: false, links: [], description: "" };
  const leftover: string[] = [];

  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.replace(/^[<(["']+|[>)\]"'.]+$/g, "");
    if (!token) continue;

    const asEmail = token.replace(/^mailto:/i, "");
    if (new RegExp(`^${EMAIL.source}$`).test(asEmail)) {
      out.email ??= asEmail.toLowerCase();
      continue;
    }

    const platform = PLATFORMS.map((p) => ({ p, m: token.match(p.re) })).find(({ m }) => m);
    if (platform?.m && !NOT_PEOPLE.test(platform.m[1])) {
      const handle = platform.m[1];
      const url = toUrl(token).replace(/[?#].*$/, "").replace(/\/+$/, "");
      if (!out.links.some((l) => l.url === url)) out.links.push({ platform: platform.p.platform, url, handle });
      if (platform.p.platform === "WhatsApp") out.phone ??= `+${handle}`;
      continue;
    }

    if (URL_TOKEN.test(token) && token.includes(".") && /[a-z]/i.test(token)) {
      const url = toUrl(token);
      try {
        out.links.push({ platform: new URL(url).hostname.replace(/^www\./, ""), url });
        continue;
      } catch {
        // not a URL after all
      }
    }
    leftover.push(raw);
  }

  // Phone numbers span several tokens ("+91 98765 43210"), so find them in what's left.
  let rest = leftover.join(" ");
  const phone = rest.match(/\+?\d[\d\s().-]{6,}\d/);
  if (phone) {
    const normalized = normalizePhone(phone[0]);
    if (normalized) {
      out.phone ??= normalized;
      rest = rest.replace(phone[0], " ");
    }
  }
  out.description = rest.replace(/\s+/g, " ").trim();

  // Best guess at a name until the profile (or Claude) tells us better.
  const linkedin = out.links.find((l) => l.platform === "LinkedIn");
  const guess =
    (linkedin?.handle && nameFromSlug(linkedin.handle)) ||
    (out.email && nameFromEmail(out.email)) ||
    out.links.find((l) => l.handle && l.platform !== "WhatsApp")?.handle;
  if (guess) {
    out.name = guess;
    out.nameGuessed = true;
  }
  return out;
}

/** True when there's something to describe beyond links and numbers. */
export function hasDescription(p: ParsedContactInput): boolean {
  return p.description.split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Reads a public profile page's title and description (Open Graph tags), e.g.
 * LinkedIn's "Priya Sharma - Senior Recruiter - Northwind | LinkedIn".
 */
export function parseProfileMeta(html: string, platform: string): Partial<Contact> {
  const meta = (prop: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
      "i",
    );
    const m = html.match(re);
    return decodeEntities((m?.[1] ?? m?.[2] ?? "").trim());
  };
  const title = meta("og:title") || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  const description = meta("og:description") || meta("description");
  if (!title || /sign ?in|log ?in|sign ?up|authwall|join linkedin/i.test(title)) return {};

  const parts = title
    .replace(/\s*[|·/]\s*(LinkedIn|X|Twitter|Instagram|GitHub|Facebook|Threads|Telegram)\s*$/i, "")
    .replace(/\s+on (X|Twitter|Instagram|Threads)\s*:.*$/i, "")
    .split(/\s+[-–—|]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const name = parts[0]?.replace(/\s*\(@[\w.]+\)\s*$/, "").trim();
  if (!name || name.split(/\s+/).length > 5 || !/\p{L}/u.test(name)) return {};

  const out: Partial<Contact> = { name };
  if (platform === "LinkedIn" && parts.length >= 2) {
    out.title = parts[1];
    if (parts[2]) out.company = parts[2];
  }
  if (description) out.notes = `From ${platform}: ${description.slice(0, 240)}`;
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

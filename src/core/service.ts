import type { SmartResult, Written } from "../shared/api";
import type {
  Contact,
  ContactLink,
  DictionaryEntry,
  FocusContext,
  Profile,
  Snippet,
  StyleCategory,
  StyleId,
} from "../shared/types";
import type { StreamHandlers, WriterLike } from "./ai";
import { hasDescription, parseContactInput, parseProfileMeta } from "./contact-input";
import { newId } from "./contacts";
import { guessIntent } from "./intent";
import { buildVocabulary, type Clarification } from "./prompts";
import { toneFor } from "./style";
import { expandSnippets } from "./text";

// The writing and contact logic shared by the desktop app and the web server,
// so both behave exactly the same.

export interface WriteRequest {
  instruction: string;
  context: FocusContext;
  profile: Profile;
  contacts: Contact[];
  snippets: Snippet[];
  dictionary: DictionaryEntry[];
  styles: Record<StyleCategory, StyleId>;
  emailDraft?: boolean;
  clarifications?: Clarification[];
}

function inputFor(req: WriteRequest) {
  return {
    context: req.context,
    profile: req.profile,
    contacts: req.contacts,
    snippets: req.snippets,
    options: {
      tone: toneFor(req.styles, req.emailDraft ? { app: "Mail" } : req.context).guide,
      emailDraft: req.emailDraft,
      clarifications: req.clarifications,
    },
  };
}

/** Max: write what was asked, or come back with one question. */
export function compose(writer: WriterLike, req: WriteRequest, stream: StreamHandlers = {}): Promise<Written> {
  return writer.compose({ ...inputFor(req), instruction: req.instruction }, stream);
}

/**
 * Dictating or asking? Clear phrasing is decided by rules; Claude decides the
 * rest in the same call that writes. Same routing as the Dictate hotkey.
 */
export async function smart(writer: WriterLike, req: WriteRequest, stream: StreamHandlers = {}): Promise<SmartResult> {
  const input = inputFor(req);
  const vocabulary = buildVocabulary(req.contacts, req.dictionary, req.profile);
  const guess = guessIntent(req.instruction, req.contacts);
  if (guess.intent === "dictation") {
    const text = await writer.polish(req.instruction, req.context, vocabulary, input.options.tone);
    return { intent: "dictation", decidedBy: "rules", reason: guess.reason, text: expandSnippets(text, req.snippets) };
  }
  if (guess.intent === "command") {
    const written = await writer.compose({ ...input, instruction: guess.instruction }, stream);
    return { intent: "command", decidedBy: "rules", reason: guess.reason, ...written };
  }
  const res = await writer.auto({ ...input, instruction: req.instruction, vocabulary }, stream);
  return {
    intent: res.intent,
    decidedBy: "claude",
    reason: res.intent === "command" ? "Claude heard a request to write" : "Claude heard dictation",
    text: res.intent === "dictation" ? expandSnippets(res.text, req.snippets) : res.text,
    question: res.question,
  };
}

// ---------- one-paste contacts ----------

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export interface ContactDeps {
  /** Reads descriptions; null when there's no API key (the description becomes notes). */
  writer: WriterLike | null;
  fetch: FetchLike;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Links, numbers, emails or a sentence: one contact per line when every line has a link or number. */
export async function quickContacts(text: string, deps: ContactDeps): Promise<Contact[]> {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const entries =
    lines.length > 1 &&
    lines.every((l) => {
      const p = parseContactInput(l);
      return p.links.length || p.email || p.phone;
    })
      ? lines
      : [text.trim()];
  return Promise.all(entries.map((entry) => quickContact(entry, deps)));
}

async function quickContact(text: string, deps: ContactDeps): Promise<Contact> {
  const parsed = parseContactInput(text);
  let contact: Contact = {
    id: newId(),
    name: parsed.name ?? "",
    ...(parsed.email && { email: parsed.email }),
    ...(parsed.phone && { phone: parsed.phone }),
    ...(parsed.links.length && { links: parsed.links }),
  };
  let named = Boolean(parsed.name && !parsed.nameGuessed);

  // A description ("recruiter at Northwind, handling my PM application") is read by Claude.
  if (hasDescription(parsed)) {
    const fields = deps.writer
      ? await deps.writer.extractContact(text).catch(() => ({}) as Partial<Contact>)
      : { notes: parsed.description };
    contact = { ...contact, ...fields, id: contact.id, links: contact.links };
    if (fields.name) named = true;
  }

  // Public profile pages fill in what's still missing.
  if (parsed.links.length) {
    const profile = await profileFromLinks(parsed.links, deps.fetch);
    if (profile.name && !named) contact.name = profile.name;
    contact.title ||= profile.title;
    contact.company ||= profile.company;
    contact.notes ||= profile.notes;
  }

  contact.name ||= parsed.email ?? parsed.phone ?? parsed.links[0]?.handle ?? "New contact";
  return Object.fromEntries(Object.entries(contact).filter(([, v]) => v !== undefined && v !== "")) as unknown as Contact;
}

/** Best effort: many sites hide profiles from apps, so this quietly gives up after a few seconds. */
async function profileFromLinks(links: ContactLink[], fetchFn: FetchLike): Promise<Partial<Contact>> {
  for (const link of links) {
    if (link.platform === "WhatsApp") continue;
    try {
      if (link.platform === "GitHub" && link.handle) {
        const res = await fetchFn(`https://api.github.com/users/${encodeURIComponent(link.handle)}`, {
          headers: { "user-agent": "WisprMax", accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        const u = (await res.json()) as { name?: string; company?: string; bio?: string };
        if (u.name) {
          return {
            name: u.name,
            ...(u.company && { company: u.company.replace(/^@/, "") }),
            ...(u.bio && { notes: `From GitHub: ${u.bio}` }),
          };
        }
        continue;
      }
      const res = await fetchFn(link.url, {
        headers: { "user-agent": BROWSER_UA, "accept-language": "en" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const profile = parseProfileMeta((await res.text()).slice(0, 400_000), link.platform);
      if (profile.name) return profile;
    } catch {
      // Blocked, offline or slow: the contact still gets added from what was pasted.
    }
  }
  return {};
}

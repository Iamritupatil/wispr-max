import type { Contact } from "../shared/types";

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- CSV ----------

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES: Record<keyof Omit<Contact, "id" | "links">, RegExp> = {
  name: /^(name|full ?name|display ?name)$/i,
  email: /^(e-?mail|e-?mail ?address|e-?mail 1 - value|primary e-?mail)$/i,
  phone: /^(phone|mobile|phone ?number|phone 1 - value|mobile phone)$/i,
  company: /^(company|organi[sz]ation|organi[sz]ation ?name|organization 1 - name)$/i,
  title: /^(title|job ?title|role|position|organization 1 - title)$/i,
  relationship: /^(relationship|relation|how we met)$/i,
  notes: /^(notes?|description|context)$/i,
};

/** Parses CSV exports from Google Contacts, Outlook, LinkedIn or a hand-made sheet. */
export function parseContactsCsv(text: string): Contact[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const idx = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([k, re]) => [k, col(re)]),
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const first = col(/^(first ?name|given ?name)$/i);
  const last = col(/^(last ?name|family ?name|surname)$/i);

  const contacts: Contact[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name =
      get(idx.name) || [get(first), get(last)].filter(Boolean).join(" ");
    if (!name && !get(idx.email)) continue;
    contacts.push(
      compact({
        id: newId(),
        name: name || get(idx.email),
        email: get(idx.email),
        phone: get(idx.phone),
        company: get(idx.company),
        title: get(idx.title),
        relationship: get(idx.relationship),
        notes: get(idx.notes),
      }),
    );
  }
  return contacts;
}

// ---------- vCard ----------

function unescapeVcf(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/** Parses .vcf exports from iPhone, macOS Contacts, Google or Outlook. */
export function parseVcf(text: string): Contact[] {
  // Unfold continuation lines (RFC 6350 §3.2).
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const contacts: Contact[] = [];
  for (const card of cards) {
    const props = new Map<string, string>();
    for (const line of card.split(/\r?\n/)) {
      const m = line.match(/^(?:item\d+\.)?([A-Z-]+)(?:;[^:]*)?:(.*)$/i);
      if (!m) continue;
      const key = m[1].toUpperCase();
      if (!props.has(key)) props.set(key, m[2]);
    }
    let name = unescapeVcf(props.get("FN") ?? "");
    if (!name && props.has("N")) {
      const [family = "", given = ""] = (props.get("N") ?? "").split(";");
      name = [given, family].map(unescapeVcf).filter(Boolean).join(" ");
    }
    const email = unescapeVcf(props.get("EMAIL") ?? "");
    if (!name && !email) continue;
    contacts.push(
      compact({
        id: newId(),
        name: name || email,
        email,
        phone: unescapeVcf(props.get("TEL") ?? ""),
        company: unescapeVcf((props.get("ORG") ?? "").split(";")[0]),
        title: unescapeVcf(props.get("TITLE") ?? ""),
        notes: unescapeVcf(props.get("NOTE") ?? ""),
      }),
    );
  }
  return contacts;
}

export function parseContactsFile(fileName: string, text: string): Contact[] {
  return /\.vcf$/i.test(fileName) || /BEGIN:VCARD/i.test(text)
    ? parseVcf(text)
    : parseContactsCsv(text);
}

/** Adds imported contacts, updating existing ones matched by email or name. */
export function mergeContacts(existing: Contact[], incoming: Contact[]): Contact[] {
  const out = existing.map((c) => ({ ...c }));
  for (const c of incoming) {
    const match = out.find(
      (e) =>
        (c.email && e.email && e.email.toLowerCase() === c.email.toLowerCase()) ||
        e.name.toLowerCase() === c.name.toLowerCase(),
    );
    if (match) {
      const links = [...(match.links ?? [])];
      for (const l of c.links ?? []) if (!links.some((x) => x.url === l.url)) links.push(l);
      if (links.length) match.links = links;
      for (const [k, v] of Object.entries(c)) {
        if (k !== "id" && k !== "links" && v && !(match as unknown as Record<string, string>)[k]) {
          (match as unknown as Record<string, string>)[k] = v;
        }
      }
    } else {
      out.push(c);
    }
  }
  return out;
}

function compact(c: Contact): Contact {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) if (v) out[k] = v;
  return out as unknown as Contact;
}

// ---------- matching ----------

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@.\s]/g, " ");

/**
 * Contacts the instruction probably refers to: full name, first or last name,
 * email local part, or company mentioned as a whole word.
 */
export function findMentionedContacts(instruction: string, contacts: Contact[]): Contact[] {
  const text = ` ${normalize(instruction)} `;
  const has = (term?: string) => {
    if (!term) return false;
    const t = normalize(term).trim();
    return t.length >= 2 && text.includes(` ${t} `);
  };
  const scored: { c: Contact; score: number }[] = [];
  for (const c of contacts) {
    const parts = normalize(c.name).split(/\s+/).filter((p) => p.length >= 2);
    let score = 0;
    if (has(c.name)) score += 10;
    if (parts.length > 1 && has(parts[0])) score += 5;
    if (parts.length > 1 && has(parts[parts.length - 1])) score += 3;
    if (parts.length === 1 && has(parts[0])) score += 5;
    if (c.email && has(c.email.split("@")[0])) score += 4;
    if (has(c.company)) score += 2;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

export function formatContact(c: Contact): string {
  const bits = [c.name];
  if (c.email) bits.push(`email: ${c.email}`);
  if (c.phone) bits.push(`phone: ${c.phone}`);
  const job = [c.title, c.company].filter(Boolean).join(" at ");
  if (job) bits.push(job);
  if (c.relationship) bits.push(`relationship: ${c.relationship}`);
  if (c.links?.length) bits.push(c.links.map((l) => `${l.platform}: ${l.url}`).join(", "));
  if (c.notes) bits.push(`notes: ${c.notes.replace(/\s+/g, " ")}`);
  return `- ${bits.join(" | ")}`;
}

export const SAMPLE_CONTACTS: Omit<Contact, "id">[] = [
  {
    name: "Priya Sharma",
    email: "priya.sharma@northwind.io",
    company: "Northwind",
    title: "Senior Technical Recruiter",
    relationship: "Recruiter for my Product Manager application",
    notes: "Final-round interview was on Oct 14 with the platform team. She said I'd hear back within a week. Prefers email.",
  },
  {
    name: "Daniel Okafor",
    email: "daniel@okafor.dev",
    company: "Okafor Labs",
    title: "Founder",
    relationship: "Hackathon teammate, close friend",
    notes: "Casual tone, we talk on Slack and WhatsApp.",
  },
  {
    name: "Dr. Elena Rossi",
    email: "e.rossi@university.edu",
    company: "State University",
    title: "Professor of Computer Science",
    relationship: "My thesis advisor",
    notes: "Formal tone. Always address her as Professor Rossi.",
  },
  {
    name: "Marcus Lee",
    email: "marcus.lee@brightpath.com",
    company: "BrightPath",
    title: "Head of Partnerships",
    relationship: "Potential client I met at a conference",
    notes: "Interested in a pilot for Q1. Owes me pricing feedback.",
  },
];

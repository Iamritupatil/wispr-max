import type { Contact, EmailDrafts } from "../shared/types";

const EMAIL_INTENT = /\b(e-?mail|mail)\b/i;
const ADDRESS = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

/**
 * The recipient when an instruction asks for an email to a known person or an
 * explicit address, e.g. "email Priya asking whether my job is confirmed".
 */
export function emailRecipient(instruction: string, mentioned: Contact[]): string | null {
  if (!EMAIL_INTENT.test(instruction)) return null;
  const explicit = instruction.match(ADDRESS)?.[0];
  if (explicit) return explicit;
  return mentioned.find((c) => c.email)?.email ?? null;
}

/** Splits "Subject: …\n\nbody" output. Without a subject line the whole text is the body. */
export function parseEmailDraft(text: string): { subject: string; body: string } {
  const m = text.match(/^\s*subject:\s*(.+)\n+([\s\S]*)$/i);
  return m ? { subject: m[1].trim(), body: m[2].trim() } : { subject: "", body: text.trim() };
}

/** A URL that opens a pre-filled compose window, or null when drafts are off. */
export function draftUrl(
  target: EmailDrafts,
  draft: { to: string; subject: string; body: string },
): string | null {
  const q = (params: Record<string, string>) =>
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  switch (target) {
    case "gmail":
      return `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to: draft.to, su: draft.subject, body: draft.body })}`;
    case "outlook":
      return `https://outlook.office.com/mail/deeplink/compose?${q({ to: draft.to, subject: draft.subject, body: draft.body })}`;
    case "mailto":
      return `mailto:${encodeURIComponent(draft.to)}?${q({ subject: draft.subject, body: draft.body })}`;
    default:
      return null;
  }
}

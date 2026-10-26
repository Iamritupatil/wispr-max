import { quickContacts } from "../src/core/service";
import { hasKey, json, rateLimited, readBody, serverWriter } from "./_lib";

/** One-paste contacts: links, numbers, emails or a sentence. Profile pages are read here (browsers can't). */
export async function POST(request: Request) {
  const limited = rateLimited(request, "contact", 40);
  if (limited) return limited;
  const body = await readBody<{ text: string }>(request, 20_000);
  if (body instanceof Response) return body;
  if (!body.text?.trim()) return json({ error: "Paste a link, number or email." }, 400);
  const contacts = await quickContacts(body.text, {
    writer: hasKey() ? serverWriter() : null,
    fetch: (url, init) => fetch(url, init),
  });
  return json({ contacts });
}

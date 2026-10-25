import type { FocusContext, StyleCategory, StyleId } from "../shared/types";

const PATTERNS: [StyleCategory, RegExp][] = [
  ["email", /\b(gmail|outlook|mail|superhuman|spark|thunderbird|proton ?mail|hey\.com|airmail|mimestream|yahoo mail)\b/i],
  ["work", /\b(slack|teams|linear|jira|notion|asana|clickup|confluence|github|gitlab|figma|zoom|google (docs|chat)|basecamp|linkedin)\b/i],
  ["personal", /\b(messages|imessage|whatsapp|telegram|signal|messenger|discord|instagram|snapchat|wechat|line)\b/i],
];

/** Classifies the app (and browser tab title) the user is typing into. */
export function categorize(ctx: Pick<FocusContext, "app" | "windowTitle">): StyleCategory {
  // Window titles first: in a browser, "Inbox - Gmail" matters more than "Google Chrome".
  for (const source of [ctx.windowTitle, ctx.app]) {
    if (!source) continue;
    for (const [category, re] of PATTERNS) if (re.test(source)) return category;
  }
  return "other";
}

export const CATEGORY_LABELS: Record<StyleCategory, { title: string; apps: string }> = {
  personal: { title: "Personal messages", apps: "iMessage, WhatsApp, Telegram, Discord" },
  work: { title: "Work messages", apps: "Slack, Teams, Linear, Notion, LinkedIn" },
  email: { title: "Email", apps: "Gmail, Outlook, Apple Mail, Superhuman" },
  other: { title: "Everything else", apps: "Docs, notes, browsers, code editors" },
};

export const STYLES: Record<StyleId, { label: string; guide: string; example: string }> = {
  formal: {
    label: "Formal",
    guide: "Formal: full sentences, proper capitalization and punctuation, no slang.",
    example: "Hi Priya, I hope you're well. I wanted to follow up on the role.",
  },
  casual: {
    label: "Casual",
    guide: "Casual: relaxed and friendly, normal capitalization, light punctuation.",
    example: "Hey Priya, just checking in on the role. Any news?",
  },
  "very-casual": {
    label: "Very casual",
    guide: "Very casual: all lowercase, minimal punctuation, short and texty.",
    example: "hey priya any news on the role",
  },
  excited: {
    label: "Excited",
    guide: "Excited: upbeat and energetic, exclamation points where they fit.",
    example: "Hi Priya! Just checking in on the role, any news?!",
  },
};

export function toneFor(styles: Record<StyleCategory, StyleId>, ctx: FocusContext) {
  const category = categorize(ctx);
  return { category, style: styles[category], guide: STYLES[styles[category]].guide };
}

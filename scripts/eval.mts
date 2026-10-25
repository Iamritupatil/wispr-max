// Live quality check against the real Claude API.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval
//
// 1. Intent: every labeled phrase in test/fixtures/intents.json goes through the
//    same routing as the Dictate hotkey (instant rules, then Claude for the rest).
// 2. Writing: Max and dictation outputs are checked against concrete rules
//    (no preamble, no markdown, right format for the app, facts from contacts).
import { Writer } from "../src/core/ai.ts";
import { SAMPLE_CONTACTS } from "../src/core/contacts.ts";
import { parseEmailDraft } from "../src/core/email.ts";
import { guessIntent } from "../src/core/intent.ts";
import { buildVocabulary } from "../src/core/prompts.ts";
import { toneFor } from "../src/core/style.ts";
import type { Contact, FocusContext, Profile, StyleCategory, StyleId } from "../src/shared/types.ts";
import cases from "../test/fixtures/intents.json" with { type: "json" };

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the live eval.");
  process.exit(1);
}

const writer = new Writer({ model: process.env.MODEL ?? "claude-opus-5-5", effort: "low" });
const contacts: Contact[] = SAMPLE_CONTACTS.map((c, i) => ({ ...c, id: String(i) }));
const profile: Profile = {
  name: "Alex Chen",
  role: "CS student, aspiring PM",
  email: "alex@example.com",
  signature: "Best,\nAlex Chen",
  style: "No emojis in email.",
};
const styles: Record<StyleCategory, StyleId> = { personal: "very-casual", work: "casual", email: "formal", other: "formal" };
const vocabulary = buildVocabulary(contacts, [], profile);
const input = (instruction: string, context: FocusContext, emailDraft = false) => ({
  instruction,
  context,
  profile,
  contacts,
  snippets: [{ id: "s", trigger: "my calendar link", text: "https://cal.com/alexchen/30min" }],
  vocabulary,
  options: { tone: toneFor(styles, emailDraft ? { app: "Mail" } : context).guide, emailDraft },
});

let failures = 0;
const report = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `\n      ${detail.replace(/\n/g, "\n      ")}` : ""}`);
};

// ---------- 1. intent ----------

console.log("\nIntent: dictating, or asking Max to write?");
let correct = 0;
let byRules = 0;
await Promise.all(
  cases.map(async (c) => {
    const guess = guessIntent(c.text, contacts);
    let intent = guess.intent;
    if (intent === "unsure") {
      intent = (await writer.auto(input(c.text, { app: c.app }))).intent;
    } else {
      byRules++;
    }
    const ok = intent === c.intent;
    if (ok) correct++;
    report(ok, `[${c.app}] ${c.text}`, ok ? "" : `expected ${c.intent}, got ${intent}${guess.intent === "unsure" ? " (Claude)" : " (rules)"}`);
  }),
);
console.log(`  ${correct}/${cases.length} correct, ${byRules} decided instantly by rules`);

// ---------- 2. writing quality ----------

const PREAMBLE = /^(sure|here('s| is)|certainly|of course|okay|ok)[\s,!:]/i;
const MARKDOWN = /(\*\*|^#+\s|^```)/m;
const words = (s: string) => s.trim().split(/\s+/).length;
const common = (out: string) => [
  [!PREAMBLE.test(out), "no preamble"],
  [!MARKDOWN.test(out), "no markdown"],
] as const;

type Check = { label: string; run: () => Promise<string>; checks: (out: string) => ReadonlyArray<readonly [boolean, string]> };
const checks: Check[] = [
  {
    label: "Email draft from Slack: 'Email Priya asking whether my job is confirmed'",
    run: () => writer.compose(input("Email Priya asking whether my job is confirmed", { app: "Slack" }, true)),
    checks: (out) => {
      const d = parseEmailDraft(out);
      return [
        ...common(d.body),
        [d.subject.length > 3, "has a subject line"],
        [/priya/i.test(d.body.split("\n")[0]), "greets Priya"],
        [/alex/i.test(d.body.slice(-60)), "signs off as Alex"],
        [/14|final[- ]round|interview/i.test(d.body), "uses the contact notes (Oct 14 final round)"],
      ];
    },
  },
  {
    label: "In Gmail: same request types the body only",
    run: () => writer.compose(input("Email Priya asking whether my job is confirmed", { app: "Google Chrome", windowTitle: "Compose - Gmail" })),
    checks: (out) => [...common(out), [!/^subject:/i.test(out), "no subject line in the body"], [/priya/i.test(out.split("\n")[0]), "greets Priya"]],
  },
  {
    label: "Slack: 'Tell Daniel I'll be ten minutes late to standup'",
    run: () => writer.compose(input("Tell Daniel I'll be ten minutes late to standup", { app: "Slack" })),
    checks: (out) => [
      ...common(out),
      [words(out) <= 40, `short (${words(out)} words)`],
      [!/^dear\b|\bbest,|\bregards\b/im.test(out), "no email formalities"],
      [/10|ten/i.test(out), "keeps the facts"],
    ],
  },
  {
    label: "WhatsApp with 'very casual' style",
    run: () => writer.compose(input("Tell Daniel I'll be ten minutes late", { app: "WhatsApp" })),
    checks: (out) => [...common(out), [out === out.toLowerCase(), "all lowercase"]],
  },
  {
    label: "Rewrite selected text: 'Make this more formal'",
    run: () => writer.compose(input("Make this more formal", { app: "Gmail", selection: "hey can u send the thing by fri thx" })),
    checks: (out) => [...common(out), [!/\bu\b|\bthx\b/i.test(out), "no texting shorthand"], [/friday/i.test(out), "keeps the deadline"]],
  },
  {
    label: "Snippet use: 'Email Marcus my calendar link'",
    run: () => writer.compose(input("Email Marcus my calendar link so we can book the pilot call", { app: "Gmail" })),
    checks: (out) => [...common(out), [out.includes("https://cal.com/alexchen/30min"), "includes the snippet exactly"]],
  },
  {
    label: "Follows contact notes: 'Email Elena asking to move our meeting'",
    run: () => writer.compose(input("Email Elena asking to move our meeting to another day", { app: "Gmail" })),
    checks: (out) => [...common(out), [/professor rossi/i.test(out), "follows the contact note (Professor Rossi)"]],
  },
  {
    label: "Dictation polish: self-corrections and fillers",
    run: () => writer.polish("so um the meeting is at 4 no actually 5 and uh bring the slides", { app: "Messages" }, vocabulary),
    checks: (out) => [
      [!/\b(um|uh)\b/i.test(out), "fillers removed"],
      [/\b5\b|five/i.test(out) && !/\b4\b|four/i.test(out), "applies '4, no actually 5'"],
      [!PREAMBLE.test(out), "no preamble"],
    ],
  },
  {
    label: "Dictation never answers questions",
    run: () => writer.polish("can you send me the deck by friday", { app: "Slack" }, vocabulary),
    checks: (out) => [[/deck/i.test(out) && /friday/i.test(out) && words(out) <= 12, "transcribed, not answered"]],
  },
];

console.log("\nWriting quality");
for (const c of checks) {
  const started = Date.now();
  const out = await c.run();
  const results = c.checks(out);
  const ok = results.every(([pass]) => pass);
  report(
    ok,
    `${c.label} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    results.map(([pass, what]) => `${pass ? "✓" : "✗"} ${what}`).join("   ") + (ok ? "" : `\n--- output ---\n${out}`),
  );
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);

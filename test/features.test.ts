import assert from "node:assert/strict";
import { test } from "node:test";
import { draftUrl, emailRecipient, parseEmailDraft } from "../src/core/email";
import { streak, wpm } from "../src/core/stats";
import { categorize, toneFor } from "../src/core/style";
import { applyDictionary, countWords, expandSnippets } from "../src/core/text";

const priya = { id: "1", name: "Priya Sharma", email: "priya@northwind.io" };

test("email intent resolves the recipient from contacts or an explicit address", () => {
  assert.equal(emailRecipient("Email Priya asking whether my job is confirmed", [priya]), "priya@northwind.io");
  assert.equal(emailRecipient("send an e-mail to bob@x.com about lunch", []), "bob@x.com");
  assert.equal(emailRecipient("Tell Priya I'm late", [priya]), null);
  assert.equal(emailRecipient("email Daniel", [{ id: "2", name: "Daniel" }]), null);
});

test("parses subject and body from Max's email draft output", () => {
  assert.deepEqual(parseEmailDraft("Subject: Following up on the PM role\n\nHi Priya,\n\nThanks!"), {
    subject: "Following up on the PM role",
    body: "Hi Priya,\n\nThanks!",
  });
  assert.deepEqual(parseEmailDraft("Hi Priya"), { subject: "", body: "Hi Priya" });
});

test("builds pre-filled compose URLs", () => {
  const d = { to: "priya@northwind.io", subject: "Role update?", body: "Hi Priya,\nAny news & updates?" };
  const gmail = new URL(draftUrl("gmail", d)!);
  assert.equal(gmail.host, "mail.google.com");
  assert.equal(gmail.searchParams.get("to"), d.to);
  assert.equal(gmail.searchParams.get("su"), d.subject);
  assert.equal(gmail.searchParams.get("body"), d.body);
  assert.match(draftUrl("mailto", d)!, /^mailto:priya%40northwind\.io\?subject=Role%20update%3F&body=/);
  assert.equal(new URL(draftUrl("outlook", d)!).searchParams.get("subject"), d.subject);
  assert.equal(draftUrl("off", d), null);
});

test("categorizes apps, preferring the browser tab title", () => {
  assert.equal(categorize({ app: "Google Chrome", windowTitle: "Inbox (3) - me@gmail.com - Gmail" }), "email");
  assert.equal(categorize({ app: "Slack" }), "work");
  assert.equal(categorize({ app: "WhatsApp" }), "personal");
  assert.equal(categorize({ app: "Code", windowTitle: "main.ts" }), "other");
  const tone = toneFor({ personal: "very-casual", work: "casual", email: "formal", other: "formal" }, { app: "Messages" });
  assert.equal(tone.style, "very-casual");
  assert.match(tone.guide, /lowercase/);
});

test("dictionary fixes mishearings as whole words, any casing", () => {
  const dict = [
    { id: "1", word: "Wispr Max", heardAs: "whisper max" },
    { id: "2", word: "Kubernetes", heardAs: "cooper netties" },
    { id: "3", word: "Anthropic" },
  ];
  assert.equal(applyDictionary("I love Whisper, max! And cooper netties.", dict), "I love Wispr Max! And Kubernetes.");
  assert.equal(applyDictionary("whispering maximally", dict), "whispering maximally");
});

test("snippets expand spoken cues", () => {
  const snippets = [{ id: "1", trigger: "my calendar link", text: "https://cal.com/alex/30min" }];
  assert.equal(
    expandSnippets("Sure, here's My calendar link.", snippets),
    "Sure, here's https://cal.com/alex/30min",
  );
  assert.equal(expandSnippets("no cue here", snippets), "no cue here");
});

test("stats: streak, words per minute, word count", () => {
  const today = new Date("2026-10-25T10:00:00");
  assert.equal(streak(["2026-10-23", "2026-10-24", "2026-10-25"], today), 3);
  assert.equal(streak(["2026-10-23", "2026-10-24"], today), 2); // today not used yet
  assert.equal(streak(["2026-10-20"], today), 0);
  assert.equal(wpm(300, 120_000), 150);
  assert.equal(countWords("  hello   there world "), 3);
});

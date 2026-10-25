import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildComposeUser,
  buildProfileAndContacts,
  buildVocabulary,
  cleanOutput,
  stripWakePhrase,
} from "../src/core/prompts";

const profile = { name: "Alex Chen", role: "", email: "", signature: "Best,\nAlex", style: "" };

test("wake phrase routes dictation to Max but ignores a person called Max", () => {
  assert.equal(stripWakePhrase("Hey Max, email Priya about the role"), "Email Priya about the role");
  assert.equal(stripWakePhrase("hey max write a haiku"), "Write a haiku");
  assert.equal(stripWakePhrase("Max, see you at five"), null);
  assert.equal(stripWakePhrase("Hey Maxine, how are you"), null);
  assert.equal(stripWakePhrase("Hey Max."), null);
});

test("compose prompt carries app, window, selection and instruction", () => {
  const msg = buildComposeUser(
    "reply yes",
    { app: "Google Chrome", windowTitle: "Inbox - Gmail", selection: "Are you free Thursday?" },
    { tone: "Formal: full sentences." },
    new Date("2026-10-25T12:00:00"),
  );
  assert.match(msg, /App: Google Chrome/);
  assert.match(msg, /Window: Inbox - Gmail/);
  assert.match(msg, /Date: Sunday, October 25, 2026/);
  assert.match(msg, /<selected_text>\nAre you free Thursday\?\n<\/selected_text>/);
  assert.match(msg, /<instruction>\nreply yes\n<\/instruction>/);
  assert.match(msg, /Tone: Formal: full sentences\./);
  assert.doesNotMatch(msg, /output_format/);
  assert.match(buildComposeUser("email priya", {}, { emailDraft: true }), /<output_format>[\s\S]*subject line/);
});

test("profile block lists contacts, and only matches when the list is huge", () => {
  const few = [{ id: "1", name: "Priya Sharma", email: "p@x.io", relationship: "recruiter" }];
  const block = buildProfileAndContacts(profile, few, "email priya");
  assert.match(block, /Name: Alex Chen/);
  assert.match(block, /- Priya Sharma \| email: p@x.io \| relationship: recruiter/);
  assert.match(block, /<snippets>\n\(none\)/);
  const withSnippets = buildProfileAndContacts(profile, few, "x", [{ id: "s", trigger: "my calendar", text: "https://cal.com/a" }]);
  assert.match(withSnippets, /- "my calendar": https:\/\/cal\.com\/a/);

  const many = Array.from({ length: 400 }, (_, i) => ({ id: String(i), name: `Person ${i}` }));
  many.push({ id: "x", name: "Priya Sharma" });
  const big = buildProfileAndContacts(profile, many, "email priya");
  assert.match(big, /401 contacts in total/);
  assert.match(big, /Priya Sharma/);
  assert.doesNotMatch(big, /Person 12\b/);
});

test("vocabulary includes profile, contacts, companies and custom words once", () => {
  const vocab = buildVocabulary(
    [{ id: "1", name: "Priya Sharma", company: "Northwind" }],
    [
      { id: "a", word: "Kubernetes" },
      { id: "b", word: "Northwind" },
      { id: "c", word: "Anthropic", heardAs: "anthropic" },
    ],
    profile,
  );
  assert.deepEqual(vocab, ["Alex Chen", "Priya Sharma", "Northwind", "Kubernetes", "Anthropic"]);
});

test("cleanOutput strips fences and wrapping quotes only", () => {
  assert.equal(cleanOutput("```\nHi Priya,\n```"), "Hi Priya,");
  assert.equal(cleanOutput('"Running late!"'), "Running late!");
  assert.equal(cleanOutput('She said "hi" and "bye"'), 'She said "hi" and "bye"');
});

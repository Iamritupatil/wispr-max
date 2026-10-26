import assert from "node:assert/strict";
import { test } from "node:test";
import { calledMax, guessIntent, parseAutoOutput } from "../src/core/intent";
import cases from "./fixtures/intents.json";

const contacts = [
  { id: "1", name: "Priya Sharma", email: "priya@northwind.io" },
  { id: "2", name: "Daniel Okafor" },
  { id: "3", name: "Dr. Elena Rossi" },
  { id: "4", name: "Marcus Lee" },
];

test("the instant rules never mislabel the labeled set (unsure is fine: Claude decides those)", () => {
  const wrong = cases
    .map((c) => ({ ...c, guess: guessIntent(c.text, contacts) }))
    .filter((c) => c.guess.intent !== "unsure" && c.guess.intent !== c.intent);
  assert.deepEqual(
    wrong.map((w) => `${w.text} → ${w.guess.intent} (${w.guess.reason})`),
    [],
  );
});

test("the rules settle most clear-cut requests instantly", () => {
  const commands = cases.filter((c) => c.intent === "command");
  const instant = commands.filter((c) => guessIntent(c.text, contacts).intent === "command");
  assert.ok(instant.length / commands.length >= 0.85, `only ${instant.length}/${commands.length} commands decided instantly`);
});

test("the example from the brief is a request to Max", () => {
  assert.equal(guessIntent("Okay, I want to write an email. Can you write it?").intent, "command");
});

test("Hey Max is stripped from the instruction", () => {
  const g = guessIntent("Hey Max, tell Daniel I'll be late", contacts);
  assert.equal(g.intent, "command");
  assert.equal(g.instruction, "Tell Daniel I'll be late");
  assert.notEqual(guessIntent("Hey Maxine, how are you").intent, "command");
  assert.notEqual(guessIntent("Hey Max.").intent, "command");
});

test("plain speech is dictation without asking Claude", () => {
  assert.equal(guessIntent("I'm running ten minutes late, start without me").intent, "dictation");
  assert.equal(guessIntent("Can you send me the deck by Friday?").intent, "unsure");
});

test("parses Claude's auto-mode header", () => {
  assert.deepEqual(parseAutoOutput("MODE: write\n\nHi Priya,"), { intent: "command", text: "Hi Priya," });
  assert.deepEqual(parseAutoOutput("MODE: dictation\nRunning late."), { intent: "dictation", text: "Running late." });
  assert.equal(parseAutoOutput("Hi Priya"), null);
});

test("auto mode can ask instead of writing", () => {
  assert.deepEqual(parseAutoOutput("MODE: ask\n\nWhich role was this for?"), {
    intent: "command",
    text: "",
    question: "Which role was this for?",
  });
});

test("calling Max by name in a Flow dictation hands it to Max", () => {
  assert.equal(calledMax("Hey Max, reply saying Thursday works."), "Reply saying Thursday works.");
  assert.equal(calledMax("Max, write a short note to the recruiter"), "Write a short note to the recruiter");
  assert.equal(calledMax("ok max write an email to Priya"), "Write an email to Priya");
  assert.equal(calledMax("Max: thank Elena for the referral"), "Thank Elena for the referral");
  // Dictation that merely mentions Max is left alone.
  assert.equal(calledMax("Max will join the call at five."), null);
  assert.equal(calledMax("I told Max, sounds good"), null);
  assert.equal(calledMax("Hey Max"), null);
});

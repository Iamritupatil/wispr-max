import assert from "node:assert/strict";
import { test } from "node:test";
import { calledMax, guessIntent, parseAutoOutput, routeCall } from "../src/core/intent";
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

test("after Hey Max: run an agent, guide on screen, or write", () => {
  assert.deepEqual(routeCall("Tell Claude to fix the failing login test"), { kind: "agent", agent: "claude", task: "fix the failing login test" });
  assert.deepEqual(routeCall("ask codex to add dark mode to the settings page"), { kind: "agent", agent: "codex", task: "add dark mode to the settings page" });
  assert.deepEqual(routeCall("Run Claude Code and write tests for the API"), { kind: "agent", agent: "claude", task: "write tests for the API" });
  assert.equal(routeCall("How do I attach a camera to this Raspberry Pi?").kind, "guide");
  assert.equal(routeCall("I'm stuck, what do I click next").kind, "guide");
  assert.equal(routeCall("Is this tweet real?").kind, "guide");
  assert.equal(routeCall("Write a follow-up to Tejas about the role, I haven't heard back").kind, "write");
  assert.equal(routeCall("Can you write an email to Priya asking about the deadline?").kind, "write");
  assert.equal(calledMax("Hello Max, how do I export this?"), "How do I export this?");
});

test("research goes to the user's agent, not the screen guide", () => {
  assert.deepEqual(routeCall("Can you do research about Farza, the founder of Hey Clicky?"), { kind: "agent", agent: "claude", task: "Can you do research about Farza, the founder of Hey Clicky?" });
  assert.equal(routeCall("look up the latest Wispr Flow pricing").kind, "agent");
  assert.equal(routeCall("How do I export this?").kind, "guide");
});

test("Max hears its name the way Flow actually types it", () => {
  assert.equal(calledMax("Max can you do research about Farza"), "Can you do research about Farza");
  assert.equal(calledMax("So Max, write a reply saying yes"), "Write a reply saying yes");
  assert.equal(calledMax("Max. How do I export this?"), "How do I export this?");
  assert.equal(calledMax("Hey Max how do I export this"), "How do I export this");
  assert.equal(calledMax("Okay Max tell Claude to fix the tests"), "Tell Claude to fix the tests");
  // Still just dictation:
  assert.equal(calledMax("Max will join the call at five."), null);
  assert.equal(calledMax("Max is stuck in traffic"), null);
  assert.equal(calledMax("Max can't make it today"), null);
});

test("help requests go to the screen guide wherever the question is", () => {
  assert.equal(routeCall("I want to submit my project to WeMakeDevs. Can you just tell me how I do that? I don't know what to do.").kind, "guide");
  assert.equal(routeCall("I'm stuck on this page, show me how to edit it").kind, "guide");
  assert.equal(routeCall("Write a reply to Tejas saying I'll send it tomorrow").kind, "write");
});

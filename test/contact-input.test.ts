import assert from "node:assert/strict";
import { test } from "node:test";
import { hasDescription, nameFromSlug, parseContactInput, parseProfileMeta } from "../src/core/contact-input";

test("a pasted LinkedIn URL becomes a contact with a name from the slug", () => {
  const p = parseContactInput("https://www.linkedin.com/in/priya-sharma-1a2b3c4d/?utm_source=share");
  assert.equal(p.name, "Priya Sharma");
  assert.equal(p.nameGuessed, true);
  assert.deepEqual(p.links, [
    { platform: "LinkedIn", url: "https://www.linkedin.com/in/priya-sharma-1a2b3c4d", handle: "priya-sharma-1a2b3c4d" },
  ]);
});

test("recognises social profiles, WhatsApp numbers, emails and phone numbers", () => {
  const p = parseContactInput(
    "x.com/danokafor instagram.com/dan.okafor github.com/okafor wa.me/447700900123 dan@okafor.dev",
  );
  assert.deepEqual(p.links.map((l) => `${l.platform}:${l.handle}`), [
    "X:danokafor",
    "Instagram:dan.okafor",
    "GitHub:okafor",
    "WhatsApp:447700900123",
  ]);
  assert.equal(p.phone, "+447700900123");
  assert.equal(p.email, "dan@okafor.dev");
  assert.equal(p.description, "");
});

test("phone numbers with spaces and a sentence of description", () => {
  const p = parseContactInput("Marcus Lee, +1 (415) 555-0134, head of partnerships at BrightPath, met him at a conference");
  assert.equal(p.phone, "+14155550134");
  assert.match(p.description, /Marcus Lee.*BrightPath.*conference/);
  assert.equal(hasDescription(p), true);
  assert.equal(p.name, undefined); // a sentence needs Claude (or the user) to name it
});

test("names from emails only when the address looks like a name", () => {
  assert.equal(parseContactInput("priya.sharma@northwind.io").name, "Priya Sharma");
  assert.equal(parseContactInput("ps1987@gmail.com").name, undefined);
});

test("ignores links that aren't people", () => {
  assert.deepEqual(parseContactInput("https://x.com/home").links.map((l) => l.platform), ["x.com"]);
  assert.equal(nameFromSlug("john-doe-0a1b2c"), "John Doe");
  assert.equal(nameFromSlug("jd2024"), undefined);
});

test("reads LinkedIn and X profile titles, and skips login walls", () => {
  const linkedin = parseProfileMeta(
    `<meta property="og:title" content="Priya Sharma - Senior Technical Recruiter - Northwind | LinkedIn" />
     <meta property="og:description" content="Hiring for product and platform teams &amp; more." />`,
    "LinkedIn",
  );
  assert.deepEqual(linkedin, {
    name: "Priya Sharma",
    title: "Senior Technical Recruiter",
    company: "Northwind",
    notes: "From LinkedIn: Hiring for product and platform teams & more.",
  });
  assert.equal(parseProfileMeta(`<title>Daniel Okafor (@danokafor) / X</title>`, "X").name, "Daniel Okafor");
  assert.deepEqual(parseProfileMeta(`<title>Sign Up | LinkedIn</title>`, "LinkedIn"), {});
});

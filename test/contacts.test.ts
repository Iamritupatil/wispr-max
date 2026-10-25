import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findMentionedContacts,
  mergeContacts,
  parseContactsCsv,
  parseContactsFile,
  parseVcf,
} from "../src/core/contacts";

test("parses a Google Contacts style CSV with first/last names and quoted fields", () => {
  const csv = [
    "First Name,Last Name,E-mail 1 - Value,Organization 1 - Name,Notes",
    'Priya,Sharma,priya@northwind.io,Northwind,"Recruiter, PM role"',
    'Dan,Okafor,,"Okafor ""Labs""",',
  ].join("\r\n");
  const contacts = parseContactsCsv(csv);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].name, "Priya Sharma");
  assert.equal(contacts[0].email, "priya@northwind.io");
  assert.equal(contacts[0].notes, "Recruiter, PM role");
  assert.equal(contacts[1].company, 'Okafor "Labs"');
  assert.equal(contacts[1].email, undefined);
});

test("parses vCards including folded lines and escaped characters", () => {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Rossi;Elena;;Dr.;",
    "EMAIL;type=INTERNET;type=pref:e.rossi@university.edu",
    "ORG:State University;CS",
    "NOTE:Thesis advisor\\, formal tone.\\nUse Professor Ro",
    " ssi.",
    "END:VCARD",
    "BEGIN:VCARD",
    "FN:Marcus Lee",
    "item1.TEL;type=CELL:+1 555 0100",
    "END:VCARD",
  ].join("\n");
  const contacts = parseVcf(vcf);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].name, "Elena Rossi");
  assert.equal(contacts[0].company, "State University");
  assert.equal(contacts[0].notes, "Thesis advisor, formal tone.\nUse Professor Rossi.");
  assert.equal(contacts[1].phone, "+1 555 0100");
});

test("detects vCard content regardless of extension", () => {
  assert.equal(parseContactsFile("x.txt", "BEGIN:VCARD\nFN:A B\nEND:VCARD").length, 1);
});

test("merge fills gaps on matching contacts instead of duplicating", () => {
  const merged = mergeContacts(
    [{ id: "1", name: "Priya Sharma", email: "priya@northwind.io" }],
    [
      { id: "2", name: "P. Sharma", email: "PRIYA@northwind.io", company: "Northwind" },
      { id: "3", name: "New Person" },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].company, "Northwind");
  assert.equal(merged[0].name, "Priya Sharma");
});

test("finds contacts by first name, company and full name, best match first", () => {
  const contacts = [
    { id: "1", name: "Priya Sharma", company: "Northwind" },
    { id: "2", name: "Daniel Okafor" },
    { id: "3", name: "Priya Patel" },
  ];
  assert.deepEqual(
    findMentionedContacts("email priya sharma about the offer", contacts).map((c) => c.id),
    ["1", "3"],
  );
  assert.deepEqual(findMentionedContacts("Tell Daniel I'm late", contacts).map((c) => c.id), ["2"]);
  assert.deepEqual(findMentionedContacts("ping the Northwind recruiter", contacts).map((c) => c.id), ["1"]);
  assert.deepEqual(findMentionedContacts("write a haiku", contacts), []);
});

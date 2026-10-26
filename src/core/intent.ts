import type { Contact } from "../shared/types";

/**
 * Is the user dictating (their words are the text) or asking Max to write
 * something? Clear-cut cases are decided here instantly; anything in between
 * is "unsure" and goes to Claude, which decides while it writes.
 *
 * The rules are tuned to never call real dictation a command: "Can you send
 * me the deck by Friday?" is a message to a coworker, not a request to Max.
 */
export type Intent = "dictation" | "command";

export interface IntentGuess {
  intent: Intent | "unsure";
  /** For commands: the instruction with any "Hey Max" removed. */
  instruction: string;
  reason: string;
}

const FILLER = String.raw`(?:(?:okay|ok|so|um+|uh+|hmm+|alright|right|well|hey|please)[,.]?\s+)*`;

// Things Max writes. Writing verbs only count as commands when aimed at one of these.
const ARTIFACT = String.raw`(?:e-?mail|mail|message|msg|reply|response|note|text|dm|post|tweet|thread|letter|cover letter|bio|summary|caption|paragraph|intro(?:duction)?|invitation|invite|thank[- ]you(?: note)?|apology|follow[- ]?up|announcement|update|blurb|description|outline|draft|list)`;
const WRITE_VERB = String.raw`(?:write|draft|compose|prepare|put together|come up with|craft|create)`;
const EDIT_VERB = String.raw`(?:rewrite|re-write|rephrase|reword|translate|summari[sz]e|shorten|proofread|polish|condense)`;
// Verbs that only ever mean "write to this person" when followed by a contact's name…
const COMPOSE_TO = String.raw`(?:e-?mail|message|text|ping|dm|write to|write back to|reply to|respond to|follow up with)`;
// …and verbs that need a clause saying what to say ("Tell Daniel that…", "Ask Priya whether…").
const RELAY = String.raw`(?:tell|ask|remind|thank|invite|let)`;
const RELAY_CLAUSE = String.raw`(?:asking|saying|that|about|whether|if|for|to|know)\b`;
const THIS = String.raw`(?:this|that|it|the (?:above|selection|selected text|text|paragraph|message|email))`;

const WAKE = new RegExp(String.raw`^\s*(?:hey|hi|okay|ok|yo)[,.]?\s+max\b[\s,.:!?-]*`, "i");
// "Max, reply to…": a bare name only counts with a pause after it, so dictating
// "Max will join the call" isn't mistaken for calling Max.
const CALL = new RegExp(String.raw`^\s*(?:(?:hey|hi|okay|ok|yo)[,.]?\s+max\b|max\s*[,:!])[\s,.:!?-]*`, "i");

/**
 * Did the user call Max by name ("Hey Max, …", "Max, …") at the start of a
 * Wispr Flow dictation? Returns the instruction without the name, or null.
 */
export function calledMax(transcript: string): string | null {
  const call = transcript.match(CALL);
  if (!call) return null;
  const rest = transcript.slice(call[0].length).trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

// "a quick LinkedIn post", "a polite Slack message": up to two describing words before the thing.
const DET = String.raw`(?:an? |the |my |this |that |some )?(?:[\w'-]+ ){0,2}?`;
// What makes "write a message…" a request to Max rather than an instruction to a coworker:
// it says who it's for or what it should say.
const PURPOSE = String.raw`\b(?:to|for|asking|saying|telling|letting|thanking|about|regarding|explaining|inviting|declining|accepting|apologi[sz]ing|following up|that says|on behalf)\b`;

const RULES: { re: RegExp; reason: string }[] = [
  {
    // "Can you write an email to Priya…", "Could you help me draft a reply asking…"
    re: new RegExp(String.raw`\b(?:can|could|would|will) you (?:please )?(?:help me )?${WRITE_VERB} ${DET}${ARTIFACT}\b(?:.*${PURPOSE}| for me\b)`, "i"),
    reason: "asks Max to write something",
  },
  {
    // "…can you write it?", "Can you write that for me?"
    re: /\b(?:can|could|would|will) you (?:please )?(?:write|draft|compose) (?:it|this|that|one)(?: for me)?(?: please)?\s*[?.!]?\s*$/i,
    reason: "asks Max to write it",
  },
  {
    // "Write an email to Priya…", "Draft a polite reply saying…"
    re: new RegExp(String.raw`^${FILLER}${WRITE_VERB} (?:me |us )?${DET}${ARTIFACT}\b.*${PURPOSE}`, "i"),
    reason: "starts with a writing command",
  },
  {
    // "Help me write…", "Help me reply to…"
    re: new RegExp(String.raw`^${FILLER}help me (?:${WRITE_VERB}|reply|respond|word|answer|e-?mail|message|text)\b`, "i"),
    reason: "asks for help writing",
  },
  {
    // "Rewrite this to sound friendlier", "Translate that into Spanish"
    re: new RegExp(String.raw`^${FILLER}${EDIT_VERB} ${THIS}\b`, "i"),
    reason: "asks Max to edit text",
  },
  {
    // "Make this more formal", "Make it sound friendlier" (but not "make it 5pm")
    re: new RegExp(String.raw`^${FILLER}make ${THIS} (?:a (?:bit|little|lot) )?(?:more|less|sound|shorter|longer|clearer|friendlier|nicer|warmer|simpler|better|formal|casual|professional|polite|concise|punchier)\b`, "i"),
    reason: "asks Max to edit text",
  },
  {
    // "Reply saying I'm free Thursday", "Respond that we accept"
    re: new RegExp(String.raw`^${FILLER}(?:reply|respond|answer)(?: to (?:this|that|him|her|them|it))? (?:saying|that|with|and say|telling)\b`, "i"),
    reason: "asks Max to reply",
  },
];

/** Words that never appear in plain dictation of a short message to someone. */
const REQUEST_HINT =
  /\b(?:max|write|draft|compose|rewrite|rephrase|translate|summari[sz]e|proofread|e-?mail|reply|respond|message|tell|ask|remind|for me|can you|could you|would you|help me|i want you|i need you)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function guessIntent(transcript: string, contacts: Contact[] = []): IntentGuess {
  const text = transcript.trim();

  const wake = text.match(WAKE);
  if (wake) {
    const rest = text.slice(wake[0].length).trim();
    if (rest) {
      return { intent: "command", instruction: rest.charAt(0).toUpperCase() + rest.slice(1), reason: 'said "Hey Max"' };
    }
  }

  for (const { re, reason } of RULES) {
    if (re.test(text)) return { intent: "command", instruction: text, reason };
  }

  // "Email Priya asking…", "Thank Elena for…": aimed at someone in the user's contacts.
  const names = contacts
    .flatMap((c) => [c.name, c.name.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0]])
    .filter((n) => n && n.length > 1)
    .map(escapeRe);
  if (names.length) {
    const who = String.raw`(?:${names.join("|")})\b(?!'s\b)`;
    const composeTo = new RegExp(String.raw`^${FILLER}${COMPOSE_TO} ${who}`, "i");
    const relay = new RegExp(String.raw`^${FILLER}${RELAY} ${who},? ${RELAY_CLAUSE}`, "i");
    if (composeTo.test(text) || relay.test(text)) {
      return { intent: "command", instruction: text, reason: "asks Max to write to a contact" };
    }
  }

  if (!REQUEST_HINT.test(text)) {
    return { intent: "dictation", instruction: text, reason: "plain speech, no request to Max" };
  }
  return { intent: "unsure", instruction: text, reason: "could be either; Claude decides" };
}

/** Claude's answer starts with this header line in auto mode. */
export const AUTO_HEADER = /^\s*MODE:\s*(dictation|write|ask)\s*\n+/i;

/**
 * Splits "MODE: write\n\n…text" into the decision and the text. "MODE: ask"
 * is a request to write where Max needs one detail first: `question` is set.
 */
export function parseAutoOutput(raw: string): { intent: Intent; text: string; question?: string } | null {
  const m = raw.match(AUTO_HEADER);
  if (!m) return null;
  const mode = m[1].toLowerCase();
  const text = raw.slice(m[0].length);
  if (mode === "ask") return { intent: "command", text: "", question: text.replace(/^ASK:\s*/i, "").trim() };
  return { intent: mode === "write" ? "command" : "dictation", text };
}

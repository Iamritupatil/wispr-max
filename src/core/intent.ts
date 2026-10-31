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
const CALL = new RegExp(
  String.raw`^\s*(?:(?:so|okay|ok|um+|uh+|oh|hey|hi|hello|yo|arre|acha|अरे|सुनो)[,.!]?\s+)*(?:max\b|मैक्स|मेक्स)` +
    // "Max, …" / "Max. …" / "Hey Max …": any pause after the name, or a greeting before it…
    String.raw`(?:\s*[,.:!?।-]+|(?<=(?:hey|hi|hello|okay|ok|yo|so|arre|acha)[,.!]?\s+max)\b` +
    // …or straight into a request: "Max can you…", "Max write…", "Max research…".
    String.raw`|(?=\s+(?:can you|could you|would you|please|write|draft|reply|tell|ask|research|look up|find|search|how|what|where|why|who|explain|help|show|make|give|play|open|send|summari[sz]e|translate)\b))[\s,.:!?-]*`,
  "i",
);

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

export type CallRoute =
  | { kind: "agent"; agent: "claude" | "codex"; task: string }
  | { kind: "guide"; question: string }
  | { kind: "write"; instruction: string }
  | { kind: "vent"; text: string }
  | { kind: "chat"; text: string };

const AGENT = /^(?:please\s+)?(?:(?:tell|ask|have|get|let)\s+(claude(?: code)?|codex|chat ?gpt|the agent|my agent)(?:\s+to)?|(?:run|launch|start|open|use)\s+(claude(?: code)?|codex|chat ?gpt|the agent|my agent)\s+(?:and|to)|(?:claude|codex)[,:])\s+(.+)$/is;
const RESEARCH = /\b(?:research|look up|look into|find out (?:about|who|what|more)|search (?:for|about|the web)|google (?:it|this|that|for)|dig into|investigate|find (?:me )?(?:info|information|details) (?:on|about))\b/i;
// Max only types into the box when asked to write something.
const WRITE_HINT = /\b(?:write|draft|compose|reply|respond|e-?mail|message|dm|text (?:him|her|them)|tweet|post|caption|letter|rephrase|rewrite|reword|translate|summari[sz]e|make (?:this|it) (?:more|less|sound))\b/i;
// Swearing aimed at Max (Flow sometimes softens it: "fuxk", "f***").
const VENT =
  /\b(?:f+u+[cx]*k+\w*|f\*+k?|fck\w*|wtf|shit\w*|b[i!1*]tch\w*|bastard|asshole|dumbass|idiot|stupid|useless|chutiy\w*|bsdk|madarchod|bhenchod|bc|mc|pagal|bewakoo?f|bakwaa?s|saa?la|kamina|nalla|gadha|ullu|nikamm?a)\b|चूतिया|पागल|बेवकूफ|बकवास|साला|कमीना|गधा|उल्लू|निकम्मा|भेनचोद|मादरचोद/i;

// Banter, not a task: "do you know I became the CEO of Google?", "are you there?". Max just talks back.
const CHAT =
  /^(?:(?:do|did) you know\b|guess what|you know what|are you (?:there|awake|alive|real|ok|mad|serious)|(?:hey|hi|hello|yo|sup|wassup|what'?s up)\b|how are you|i (?:just |finally )?(?:became|got|won|bought|made|am the|did it)\b|you(?:'re| are| r) (?:so |the |my )|lol|haha|bro\b)/i;

const ENGLISH_ABUSE = /\b(?:f+u+[cx]*k+\w*|f\*+k?|fck\w*|motherf\w*|b[i!1*]tch\w*|bastard|asshole|dickhead|son of a)|b[i!1*]tch/i;
const HINDI_ABUSE = /\b(?:chutiy\w*|bsdk|madarchod|bhenchod|bc|mc|saa?la|kamina|harami)\b|चूतिया|साला|कमीना|भेनचोद|मादरचोद|हरामी/i;

/** Which meme a swear at Max gets, decided here so it's always right: English gaali, Hindi gaali, or yelling. */
export function abuseKind(text: string): "english" | "hindi" | "yell" | null {
  if (ENGLISH_ABUSE.test(text)) return "english";
  if (HINDI_ABUSE.test(text)) return "hindi";
  const letters = text.replace(/[^a-z]/gi, "");
  if ((letters.length > 8 && letters === letters.toUpperCase()) || /!{2,}/.test(text)) return "yell";
  return null;
}

// "…can you just tell me how I do that?", "…I don't know what to do": help, wherever it's asked.
const HOW =
  /\b(?:how (?:do|can|should|would|to) (?:i|we|you)\b|how to\b|tell me how|show me how|walk me through|what (?:do|should) i (?:do|click|press)|where (?:do|can|should) i|help me (?:with|to|find|do|figure)|i(?:'m| am) (?:stuck|lost|confused)|i don'?t know (?:how|what|where))/i;
const GUIDE =
  /^(?:how|what|where|which|why|when|who|is (?:this|it|that)|are (?:these|they)|can you (?:help|show|explain|tell me|teach)|could you (?:help|show|explain|tell me)|help me|show me|explain|teach me|walk me through|i(?:'m| am) (?:stuck|lost|confused|not sure)|i don'?t (?:know|understand))\b/i;

/** "Max, remember I prefer aisle seats" / "forget my seat preference": what Max knows about you. */
export function memoryCommand(text: string): { kind: "remember"; fact: string } | { kind: "forget"; about: string } | null {
  const t = text.trim().replace(/[.!]+$/, "");
  const r = t.match(/^(?:please\s+)?(?:remember|don'?t forget)(?:\s+that)?\s+(.{3,})$/i);
  if (r) return { kind: "remember", fact: r[1].trim() };
  const f = t.match(/^(?:please\s+)?forget(?:\s+(?:about|that))?\s+(.{2,})$/i);
  return f ? { kind: "forget", about: f[1].trim() } : null;
}

/**
 * After "Hey Max": hand a task to the user's own agent ("tell Claude to…"),
 * answer a question about the screen ("how do I…?"), or write something.
 */
export function routeCall(instruction: string, contacts: Contact[] = []): CallRoute {
  const text = instruction.trim();
  const agent = text.match(AGENT);
  if (agent) {
    const name = (agent[1] ?? agent[2] ?? text.split(/[\s,:]/)[0]).toLowerCase();
    return { kind: "agent", agent: /codex|chat ?gpt/.test(name) ? "codex" : "claude", task: agent[3].trim() };
  }
  // "Research the founder of…", "look up…": real work on the web, for the user's agent.
  if (RESEARCH.test(text)) return { kind: "agent", agent: "claude", task: text };
  // Swearing at Max is venting: Max reacts, it never types anything.
  if (VENT.test(text)) return { kind: "vent", text };
  // "Can you write an email…" is writing, even though it starts like a question.
  if (guessIntent(text, contacts).intent === "command") return { kind: "write", instruction: text };
  // A question ("is this tweet real?") is a question, even if it mentions a tweet or a message.
  if (HOW.test(text)) return { kind: "guide", question: text };
  if (CHAT.test(text)) return { kind: "chat", text };
  if (GUIDE.test(text)) return { kind: "guide", question: text };
  if (WRITE_HINT.test(text)) return { kind: "write", instruction: text };
  // Everything else said to Max (questions, chat, complaints) is answered, not typed.
  return { kind: "guide", question: text };
}

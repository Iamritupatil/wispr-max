<p align="center"><img src="assets/icon.png" width="112" alt="Wispr Max: a tiny pixel ghost" /></p>

<h1 align="center">Wispr Max</h1>
<p align="center"><b>Wispr Flow, maxed out.</b> Dictate anywhere, or tell a tiny ghost what to write and it types the finished text into whatever app you're in.</p>

---

## The problem

Voice dictation tools like Wispr Flow type what you *say*. But a lot of writing isn't dictation, it's delegation:

> "Write an email to Priya asking whether my job is confirmed."

Today that means opening ChatGPT, explaining who Priya is, pasting in context, generating, copying, switching back to Gmail, finding her address, and pasting. That's seven steps and two context switches for a three-paragraph email.

## The solution

Wispr Max is a little ghost that floats at the bottom of your screen, with two hotkeys that work in **every app**:

| Hotkey | Mode | What happens |
|---|---|---|
| `Ctrl/Cmd + Shift + Space` | **Dictate** | Speak, and your words appear at the cursor, cleaned up: no "um"s, proper punctuation, and "no wait, I mean…" corrections applied. |
| `Ctrl/Cmd + Shift + M` | **Max** | Say what you *want*. Max writes it **as you**, using your contacts, your style and the app you're in, and types it in. |

Press once to talk, press again to finish, and `Esc` cancels.

### It knows when you're asking

You don't have to remember which hotkey to press. With **smart intent** on, the Dictate hotkey works out whether you're *dictating* or *asking Max to write something*:

| You say (Dictate hotkey) | Wispr Max hears | Typed |
|---|---|---|
| "Okay, I want to write an email to Priya. Can you write it?" | a request to Max | the whole email (or a ready-to-send draft) |
| "Hey Max, tell Daniel I'll be late" | a request to Max | a message to Daniel |
| "Can you send me the deck by Friday?" | dictation, a question for your coworker | *Can you send me the deck by Friday?* |
| "I need you to email the client today" | dictation, an instruction to your coworker | *I need you to email the client today.* |

Clear-cut phrasing is decided instantly by rules, with no API call. Ambiguous phrasing goes to Claude, which decides and writes in the **same** call, so it costs no extra time. When it's genuinely unclear, Wispr Max types your own words: that's the safer mistake. The `Max` hotkey always means "write this for me".

### The email feature

Say **"Email Priya asking whether my job is confirmed"** and:

- **In Gmail, Outlook or any mail app**, the email is written straight into the compose box.
- **From anywhere else**, Max opens a new **Gmail draft** (or Outlook, or your default mail app) with **To**, **Subject** and **body** already filled in. Priya's address comes from your contacts, and the body draws on your notes about her ("final round was Oct 14, said I'd hear back in a week"). You just hit Send.

Details Max doesn't know become `[placeholders]`. It never makes them up.

### Everything from Wispr Flow (except meeting notes)

| Wispr Flow feature | In Wispr Max |
|---|---|
| Dictation in any app | ✓ Works system-wide, and knows when you're asking instead of dictating |
| AI auto-edits | ✓ Smart formatting removes fillers, fixes punctuation and applies self-corrections |
| Command Mode | ✓ Highlight text, press Max and say "make this more formal" or "reply saying I'm free Thursday" |
| Personal dictionary | ✓ Words to always spell right, plus "often heard as" auto-fixes. Contact names are added automatically. |
| Snippets | ✓ Say "my calendar link" and your booking URL is typed. Max can use snippets too. |
| Styles per app type | ✓ Personal / Work / Email / Other, each Formal, Casual, Very casual or Excited |
| 100+ languages | ✓ Whisper auto-detects, or pin a language |
| Flow bar | ✓ The ghost: it floats when idle, listens with a pixel waveform, glances around while thinking, and smiles when done |
| Sounds | ✓ Tiny 8-bit chimes on start and stop |
| Stats and history | ✓ Day streak, words, WPM, and a day-by-day activity feed with one-click copy |
| ~~Meeting notes~~ | Deliberately left out |
| **New: Max** | AI writing from a spoken instruction, aware of your contacts, profile, style, app and selection |
| **New: Email drafts** | Pre-filled Gmail / Outlook / Mail drafts from one sentence |

## Demo script (90 seconds)

1. **Contacts**, then **Add sample contacts** (or import a CSV/vCard). **About you**: enter your name.
2. Anywhere (Slack, a browser, the desktop), press **Max** and say *"Email Priya asking whether my job is confirmed."* A Gmail draft opens with To, Subject and a polite follow-up that mentions the Oct 14 final round.
3. In Slack, press **Max**: *"Tell Daniel I'll be ten minutes late to standup."* You get a casual one-liner, not an email.
4. Highlight a paragraph, press **Max**: *"make this shorter and friendlier."* It's rewritten in place.
5. Press **Dictate** and ramble: *"so um the meeting is at 4, no actually 5, and send them my calendar link."* You get something like *"The meeting is at 5, and send them https://cal.com/you/30min."*

No mic or OS permissions on the demo machine? Use **Try Max** on the Home screen: pick Gmail, click the first example, then **Open as email draft**.

## How it works

```
 hotkey ──▶ ghost overlay (never takes focus) ──▶ mic recording
                │
                ├─ meanwhile: detect the active app + tab title, copy any selected text
                ▼
     speech-to-text (Groq Whisper / OpenAI), biased with your dictionary + contact names
                ▼
     dictionary auto-fixes ("whisper max" → "Wispr Max")
                ▼
   ┌─ Dictate: Claude polishes in your style for this app ─▶ snippets expanded
   └─ Max:    Claude writes from instruction + contacts + profile + snippets + style + selection
                │   (streamed live into the overlay)
                ├─ email to a contact, outside a mail app ─▶ open pre-filled Gmail/Outlook/Mail draft
                ▼
     clipboard + simulated Cmd/Ctrl+V into the focused app, then your clipboard is restored
```

- **Writing:** Claude (`claude-opus-5-5` by default, effort `low` for speed) via the official Anthropic SDK, streamed. Contacts, profile and snippets are prompt-cached. Server-side refusal fallbacks are on.
- **Intent:** `src/core/intent.ts` rules decide clear cases instantly, and Claude decides the rest inside the writing call. They're tested against a labeled set of 38 real-world phrasings (`test/fixtures/intents.json`); the rules never mislabel a single one.
- **Speech:** AssemblyAI (default; your contacts and dictionary go in as key terms), Groq `whisper-large-v3-turbo`, or OpenAI `gpt-4o-mini-transcribe`.
- **No native modules:** `osascript` on macOS, PowerShell on Windows, `xdotool`/`wtype` on Linux. `npm install` just works.
- **Private by default:** contacts, history, stats and settings live in your local app-data folder. API keys are encrypted with the OS keychain.

## Getting started

Requirements: Node 20+, plus API keys for [Anthropic](https://console.anthropic.com/settings/keys) (writing) and one speech-to-text provider: [AssemblyAI](https://www.assemblyai.com/dashboard/api-keys) (default), [Groq](https://console.groq.com/keys) or [OpenAI](https://platform.openai.com/api-keys).

```bash
npm install
npm run dev        # build and launch
```

Add your keys in **Settings** (or export `ANTHROPIC_API_KEY` and `ASSEMBLYAI_API_KEY` before launching), fill in **About you**, and add contacts.

### Checking quality

```bash
npm test                                   # offline: intent rules, prompts, drafts, speech-to-text flow (mocked)
ANTHROPIC_API_KEY=sk-ant-... npm run eval  # live: intent accuracy + writing-quality checks against Claude
```

`npm run eval` sends every labeled phrase through the real Dictate-hotkey routing and reports accuracy. It then checks Max's writing against concrete rules: no preamble or markdown, a subject line only for drafts, greets the right person, uses your contact notes and snippets, short messages in Slack, lowercase in "very casual" apps, and dictation that is cleaned up but never answered.

### Permissions

| OS | What to allow |
|---|---|
| macOS | **Microphone** (prompted on first launch) and **Accessibility** for Wispr Max, or for your terminal when running `npm run dev`: System Settings → Privacy & Security → Accessibility. Allow it to control **System Events** if asked; that's how text gets pasted. |
| Windows | Nothing extra. |
| Linux | Install `xdotool` (X11) or `wtype` (Wayland). Global hotkeys are most reliable on X11. |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build and launch |
| `npm run watch` | Rebuild on change (run `npm start` alongside) |
| `npm test` | Unit tests: intent detection, contacts, prompts, email drafts, styles, dictionary, snippets, stats, speech-to-text (mocked) |
| `npm run eval` | Live quality check against Claude (needs `ANTHROPIC_API_KEY`) |
| `npm run typecheck` | TypeScript checks |
| `npm run dist` | Package an installer into `release/` (dmg / nsis / AppImage) |
| `npm run icons` | Re-render the ghost icons in `assets/` (needs Playwright) |

## Project structure

```
src/
  core/            platform-independent logic, unit tested
    ai.ts          Claude client: compose (Max) and polish (Dictate), streaming
    intent.ts      dictating or asking? instant rules + Claude for the ambiguous rest
    prompts.ts     system prompts and context building
    email.ts       email intent, subject parsing, Gmail/Outlook/mailto draft URLs
    style.ts       app → Personal/Work/Email/Other, and the four tones
    text.ts        dictionary auto-fixes, snippet expansion
    contacts.ts    CSV/vCard import, merging, finding who an instruction is about
    stats.ts       streaks and words per minute
    stt.ts         speech-to-text: AssemblyAI, Groq or OpenAI
  main/            Electron main process: hotkeys, sessions, paste, tray, storage
  preload/         narrow, typed bridges for each window
  renderer/
    ghost.ts       the pixel-art mascot, drawn from a grid as crisp SVG
    overlay.*      the floating ghost and Flow-style bar
    app.*          Home, Dictionary, Snippets, Style, Contacts, About you, Settings
test/              node:test suites
```

## Roadmap

- Push-to-talk (hold to record) via a native key listener
- Live contacts sync from Google / Apple Contacts and CRMs
- "Send it" voice command for chat apps
- On-device Whisper for offline dictation

## License

APCH 2.0

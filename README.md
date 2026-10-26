<p align="center"><img src="assets/icon.png" width="112" alt="Wispr Max: a tiny pixel ghost" /></p>

<h1 align="center">Wispr Max</h1>
<p align="center"><b>Wispr Flow, maxed out.</b> Talk with Wispr Flow, and a tiny ghost reads the conversation on your screen, writes the reply in your style and types it where your cursor is.</p>

<p align="center"><b>Try it in your browser:</b> <a href="https://wispr-max.vercel.app">wispr-max.vercel.app</a> (no sign-up, no API keys) · <a href="https://github.com/Iamritupatil/wispr-max/releases/latest">Desktop app for Windows and macOS</a></p>

---

## Built on Wispr Flow

Wispr Max is a layer on top of [Wispr Flow](https://wisprflow.ai), not a replacement for it. Flow does what it's best at, turning your voice into text, and Max picks up from there:

1. **You talk with Flow, as always.** Hold your own Flow key (Caps Lock, Ctrl + Win, fn…) and start with **"Hey Max, …"** or **"Max, …"**. Max listens along with Flow: it takes back what Flow typed and handles it. (Or click the ghost / press `Ctrl/Cmd + Shift + M` and Flow types into Max's bubble.)
2. **Max reads your screen.** The LinkedIn chat with the recruiter, the Slack thread, the email you're answering: Max sees it, so you don't have to explain anything.
3. **Max writes it as you.** Short and professional if that's how you write, using your contacts, your sign-off and how you've been talking to this person.
4. **It types it in.** No ChatGPT tab, no copy, no paste. About one to two seconds with Claude Haiku.

If something's missing ("which role?"), the ghost asks one short question in a speech bubble instead of guessing. Without Flow, Max still works with its own microphone; with Flow, it's the feature we'd love to see in Flow itself.

## The problem

Voice dictation tools like Wispr Flow type what you *say*. But a lot of writing isn't dictation, it's delegation: a reply in Slack, a note on LinkedIn, a follow-up email, a tweet, a cover letter.

> "Reply to Daniel saying I'll push the fix tonight."
> "Write a LinkedIn note thanking Elena for the referral."
> "Email the recruiter asking whether my job is confirmed."

Today each of those means opening ChatGPT, explaining who the person is and what's going on, generating, copying, switching back, and pasting. Wispr Max writes it in real time, right where your cursor already is: **no copying, no pasting, no switching apps.**

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

### It asks instead of guessing

Max doesn't make up the parts it can't know. Say *"email the person I'm getting a job from, it's been a week"* and the ghost asks back, in a little speech bubble, *"Which role was this for, and who's it going to?"* Answer out loud and it writes. It asks only when guessing would make the message wrong (at most twice); small gaps like a date become `[placeholders]`.

### Email drafts

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
| Insights / usage | ✓ A **Usage** page: words, time saved, speaking speed, streak, a words-per-day chart, where you talk, and a share card for build-in-public posts |
| History | ✓ A day-by-day activity feed with one-click copy |
| ~~Meeting notes~~ | Deliberately left out |
| **New: Max** | AI writing from a spoken instruction, aware of your contacts, profile, style, app and selection |
| **New: Email drafts** | Pre-filled Gmail / Outlook / Mail drafts from one sentence |

## Demo script (90 seconds)

1. **Contacts**: paste someone's LinkedIn link (or X, Instagram, GitHub, a WhatsApp number, an email) and they're added instantly. Or click **Add sample contacts**. **About you**: enter your name.
2. Anywhere (Slack, a browser, the desktop), press **Max** and say *"Email Priya asking whether my job is confirmed."* A Gmail draft opens with To, Subject and a polite follow-up that mentions the Oct 14 final round.
3. In Slack, press **Max**: *"Tell Daniel I'll be ten minutes late to standup."* You get a casual one-liner, not an email.
4. Highlight a paragraph, press **Max**: *"make this shorter and friendlier."* It's rewritten in place.
5. Press **Dictate** and ramble: *"so um the meeting is at 4, no actually 5, and send them my calendar link."* You get something like *"The meeting is at 5, and send them https://cal.com/you/30min."*
6. Press **Max** and say *"email the person I'm getting a job from, it's been a week and I haven't heard back."* The ghost asks which role and who it's for. Answer out loud and Max writes it.

No mic or OS permissions on the demo machine? On the Home screen, click the big ghost and talk, or type to Max, then **Open as email draft**.

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

- **Voice:** Wispr Flow types into Max's bubble; a burst of text (Flow's dictation) sends itself after a moment, no Enter needed. An experimental watcher can also notice requests in your normal Flow dictations (reads Flow's local history, read-only).
- **Screen context:** the desktop app captures the screen under your cursor; the web app reads a tab you share. One frame goes to Claude with that request and is never stored.
- **Writing:** Claude Haiku 5.5 (effort `low`, for one-to-two-second replies) via the official Anthropic SDK, streamed. Bring your own key, or use the hosted Wispr Max server (`api/`) so nobody needs one.
- **Intent:** `src/core/intent.ts` rules decide clear cases instantly, and Claude decides the rest inside the writing call. They're tested against a labeled set of 38 real-world phrasings (`test/fixtures/intents.json`); the rules never mislabel a single one.
- **Speech:** AssemblyAI (default; your contacts and dictionary go in as key terms), Groq `whisper-large-v3-turbo`, or OpenAI `gpt-4o-mini-transcribe`.
- **No native modules:** `osascript` on macOS, PowerShell on Windows, `xdotool`/`wtype` on Linux. `npm install` just works.
- **Private by default:** contacts, history, stats and settings live in your local app-data folder. API keys are encrypted with the OS keychain.

## Web app

[wispr-max.vercel.app](https://wispr-max.vercel.app) is the same app in your browser: talk with Wispr Flow into the box (or use your browser's mic), share the tab you're replying in so Max can read it, and drag the ghost anywhere. **Pop out** puts the ghost in a small window that stays on top of your other apps (Chrome and Edge); results are copied, ready to paste. Install it from the address bar like any app; **Settings → Updates** switches to new versions.

Your contacts, profile and history stay in your browser. Only what Max needs for one message goes to the server.

### Host your own

The web app and its API deploy to [Vercel](https://vercel.com) as they are: import the repo, add `ANTHROPIC_API_KEY` as an environment variable (and optionally `WISPR_MAX_MODEL`), and deploy. `vercel.json` has the build settings. Requests are rate-limited per visitor; set a spend limit on your Anthropic key too.

Locally: `ANTHROPIC_API_KEY=sk-ant-... npm run web` serves it on http://localhost:3000.

## Download

Grab the installer for Windows, macOS or Linux from **[Releases](https://github.com/Iamritupatil/wispr-max/releases)**. The builds aren't code-signed yet: Windows shows a SmartScreen prompt (**More info → Run anyway**), and on macOS right-click the app and choose **Open** the first time.

### Updating

Open **Settings → Updates → Check for updates**, then **Update now**. Wispr Max also checks quietly in the background and shows *Update available* in the sidebar.

- **Installed from Releases:** it downloads the new version and restarts into it.
- **Running from a git clone:** it pulls the latest code, reinstalls packages if they changed, rebuilds and restarts. It never overwrites your own edits; if you've changed files, it asks you to run `git pull` yourself.

## Getting started (from source)

Requirements: Node 22+ and [Wispr Flow](https://wisprflow.ai). Keys are optional: without an [Anthropic](https://console.anthropic.com/settings/keys) key, Max writes through the hosted Wispr Max server, and with Flow you don't need a speech-to-text key. To use Max's own microphone instead of Flow, add [AssemblyAI](https://www.assemblyai.com/dashboard/api-keys), [Groq](https://console.groq.com/keys) or [OpenAI](https://platform.openai.com/api-keys).

```bash
npm install
npm run dev        # build and launch
```

Fill in **About you** and add a few contacts (paste a LinkedIn link or a number). Keys, if you use your own, go in **Settings** (or export `ANTHROPIC_API_KEY` before launching).

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
| `npm run web` | Build the web app and serve it with its API on localhost:3000 |
| `npm run build:web` | Build the web app into `web-dist/` (what Vercel deploys) |
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
    service.ts     the writing and contact logic shared by the app and the server
    remote.ts      the hosted server, behind the same interface as calling Claude
  main/            Electron main process: hotkeys, sessions, paste, tray, storage
    updater.ts     the Update button: GitHub Releases for installers, git pull for clones
  preload/         narrow, typed bridges for each window
  renderer/
    ghost.ts       the pixel-art mascot, drawn from a grid as crisp SVG
    overlay.*      the floating ghost and Flow-style bar
    listen.*       the bubble Wispr Flow types into
    app.*          Home, Usage, Dictionary, Snippets, Style, Contacts, About you, Settings
api/               the hosted server (Vercel functions): write, contact, health
web/               the web app: browser bridge, floating ghost, tab sharing, PWA updates
test/              node:test suites
```

## Contributing

Wispr Max is open source and contributions are welcome.

1. Fork the repo and create a branch.
2. `npm install`, then `npm run dev` to run it.
3. Before opening a pull request, run `npm run typecheck` and `npm test`. CI runs both on every push.
4. If you change prompts, run `npm run eval` with your own `ANTHROPIC_API_KEY`, and mention the result in the PR.

### Releasing

```bash
npm version minor          # bumps the version and tags it
git push --follow-tags     # GitHub Actions builds Windows, macOS and Linux installers
```

The **Release** workflow publishes the installers to GitHub Releases, and installed copies pick them up through the Update button.

## Roadmap

- Push-to-talk (hold to record) via a native key listener
- Live contacts sync from Google / Apple Contacts and CRMs
- "Send it" voice command for chat apps
- On-device Whisper for offline dictation

## License

APCH 2.0

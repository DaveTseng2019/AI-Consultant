**English** | [繁體中文](./README.zh-TW.md)

# AI Consultant

Put the **web versions** of ChatGPT, Claude, Gemini and Grok side by side in one desktop
window. Ask once and all four answer at the same time, or bring one provider's own view
to the centre and ask it alone in its own input box — that question and answer reach the
transcript too. Or let them run a preset flow in relay — reviewing each other, or debating.
Tauri 2 + React + Rust.

## No API key

The main window holds four child webviews that load the same four sites you use every day.
Sending does not call any API. It **uses the browser session you are already logged in
with**: it types into the site's own input box, presses the site's own send button, and
reads the answer back.

So the account, the quota and the model version are all yours, and there is no key to keep
safe. The price is that **a provider redesign breaks it**, and what breaks is usually a
selector in `adapters/*.json`.

For the mechanism (the three layers, the bridge, connection state, the send path) see
[`docs/BASICS.md`](../docs/BASICS.md).

## Six modes

| Mode | Shape |
|---|---|
| Free mode | Send to all four at once, each answers on its own |
| Multi-party consultation | Two sources answer → review and add → summarise the research |
| Four-way debate | For → against → judge → summary |
| Coding mode | Plan → review → implement → test → accept (8 steps) |
| Reasoned dialectic | 5 rounds of dialectic spiral × 4 seats |
| Brainstorm | 12 rounds · 48 turns · 5 stages |

Every mode except free mode is serial — **a later step gets the earlier answers as
material**. That is the basic difference from free mode.

A send leaves a transcript and a snapshot behind, and both export to Markdown. "Replay"
**runs the question again**, so the AIs answer afresh; it does not play back the old
screen.

A snapshot lives in memory only and is gone when the app closes. To keep it across a
restart, turn on "durable snapshots" in settings: it redacts the snapshot and stores it in
the local app data (no cookies, no provider storage). What survives depends on the
redaction tier: `full-local` keeps both the question and the AI answers in plain text,
`prompt-text` keeps the question in plain text and hashes the answers, and `metadata-only`
and `hashes` keep no text at all — you have to type the question again to replay.

## Running it

There is no installer. Build one yourself.

Prerequisites: Node.js `^22.13.0 || >=24.0.0`, pnpm 11 (`corepack enable`), Rust stable
(on Windows, "Desktop development with C++" from the MSVC Build Tools), and WebView2
(usually already present on Windows 10/11).

```sh
pnpm install
pnpm build:injected   # generates the injected scripts, do not skip it
pnpm tauri dev        # the first Rust compile takes a while
```

After a change, run `pnpm verify` (typecheck + lint + test + agent contract + adapter
check). For release builds, the portable build and the agent launch scripts, see
[`docs/RUN-AND-UPDATE.md`](../docs/RUN-AND-UPDATE.md).

The data directory is `%APPDATA%\tw.micasa.aiconsultant`, and it holds a separate login
profile for each of the four providers.

## Where it stands

The version number in the repo is always `0.0.0`; the real one is injected by CI from the
tag. The app can check whether a newer version exists, but it never downloads or installs
one by itself.

Windows x64 is verified on real hardware. macOS Apple Silicon is only partly verified
(ad-hoc signature; Grok once got stuck on a Cloudflare check). Linux is built by CI only,
with no report from real hardware. See
[`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md).

Report a vulnerability through the private form in GitHub Security, not a public issue:
[`SECURITY.md`](../SECURITY.md).

## Changes by version

| Version | Date | Changes |
|---|---|---|
| [v0.0.12](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.12) | 2026-08-31 | The conversation history rail can be dragged wider, so a long title reads in full instead of being truncated - it takes the room from the provider stage beside it, never from the transcript, and always leaves the stage 240px; the mode picker now lives only while the transcript is empty, since the mode is settled by the first message, with the badge in the conversation header saying which one is running and New conversation bringing the picker back; and the stage's expand button covers that picker in one press from any state, where a stage that had already grown on its own - every provider on first run, while they all report signed out - used to need two |
| [v0.0.11](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.11) | 2026-08-31 | Starting a new conversation no longer reloads all four provider pages - the site's own new chat control is pressed instead, so the login and the injected bridge survive and the next send can start straight away; the reload stays as the fallback for when that control is missing or the URL never reaches a new conversation |
| [v0.0.10](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.10) | 2026-08-30 | A toolbar button running your own script had been failing on every press since the command behind it was renamed, and both example scripts route through that one command, so both were down; a button that wants the run is now greyed out, with the reason on hover, when there is no run to give it - a run is held in memory, so restoring an older conversation or restarting leaves none; exports land in one place instead of two, named for when the conversation started rather than when the button was pressed, so exporting the same conversation twice rewrites one file, the save dialog opens where the last export went, and the .md handed to a script goes there too instead of into a temp folder that gets swept; each answer is headed by its provider's own mark, embedded in the file so it still shows when read offline, and anything else that speaks gets a brain rather than a robot |
| [v0.0.9](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.9) | 2026-08-29 | Expand on a provider stage now folds the mode shelf away and hands the stage that room, instead of painting the provider over it - only when you press the button, since the stage also expands on its own for a signed-out provider and the picker has to stay; a line under the composer says what the file button takes (code and other text files) and that images go in by pasting them, which the rejection message used to be the only place to learn |
| [v0.0.8](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.8) | 2026-08-29 | The toolbar button for your own script became a list of them - name, script, note, what the button hands the script (nothing, the run, or this conversation as .md), and whether to ask first - reorderable, with no cap, and an older settings file carries its script into the first entry; a new "one copy at a time" raises the window you already have instead of starting a second app; settings moved to the connection strip, which start-up does not hide, and its section headings are larger and brighter; the mode shelf hides only while a run is in flight; examples/custom-actions/ documents writing your own |
| [v0.0.7](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.7) | 2026-08-29 | The "Run script" button works with durable snapshots off: the run is written at full-local for the script to read and deleted again afterwards (tested); every provider name now carries its mark, in the transcript, the provider pane title, the diagnostics cards and event log, and the access-scope panel; the mode shelf hides only while a run is in flight or the stage is expanded; the access-scope section shows one shared panel instead of four identical ones |
| [v0.0.6](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.6) | 2026-08-28 | A screenshot pastes straight from the clipboard into the question and goes out with it (tested on Grok); "send to the selected AIs" stays visible in every mode, and a mode whose roles fix the participants shows them ticked but locked |
| [v0.0.5](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.5) | 2026-08-28 | Grok no longer returns only the opening line when it stops to search; code blocks have their border back; clicking a connection chip while idle enlarges that provider's view, but not while an answer is in progress; settings shows the running version |
| [v0.0.4](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.4) | 2026-08-27 | Connection progress is visible at start-up, and the send targets and status message are no longer hidden by a collapsed panel; "New conversation" no longer stacks up a second empty conversation; collapsing the history is now an option; the portable build can check for updates, and the download points at the portable zip |
| [v0.0.3](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.3) | 2026-08-25 | Answers to questions asked in a provider's own view reach the main screen too; times are local 24-hour; connection and send chips carry the provider logo; the last work mode is remembered; font size splits into interface and main surface |
| [v0.0.2](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.2) | 2026-08-21 | A question typed in a provider's own view reaches the transcript; a monospace font setting was added |
| [v0.0.1](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.1) | 2026-08-21 | First release |

The release notes of each version have the full content.

## Documents

| File | Content |
|---|---|
| [`docs/BASICS.md`](../docs/BASICS.md) | How this app works. The mechanism, not a user manual |
| [`docs/RUN-AND-UPDATE.md`](../docs/RUN-AND-UPDATE.md) | Run it, update it, produce an executable |
| [`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md) | How far each platform is actually verified |
| [`docs/RELEASE.md`](../docs/RELEASE.md) | The release procedure and the frozen release policy |
| [`docs/AGENT-READY-SOURCE-RELEASE.md`](../docs/AGENT-READY-SOURCE-RELEASE.md) | The contract that lets an agent start this app from source |

Some files in `docs/` came from the source project and describe **its** product, which is
already different from this one.

## Source and licence

An independent project derived from
[teddashh/multi-ai-chat-desktop](https://github.com/teddashh/multi-ai-chat-desktop). The
code was branched from the state of the upstream project on 2026-08-20.

MIT, the same as the source project.

Copyright © 2026 Ted Huang (teddashh) — original author of multi-ai-chat-desktop.
Copyright © 2026 Dave Tseng — modifications in this fork.

The full text is in [`LICENSE`](../LICENSE); attribution details are in
[`NOTICE.md`](../NOTICE.md).

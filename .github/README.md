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
tag. The app can check whether a newer version exists. An installed build only points you at
the download page; a portable build replaces itself in place -- it downloads the new
release, unpacks it over its own folder and reopens.

Windows x64 is verified on real hardware. macOS Apple Silicon is only partly verified
(ad-hoc signature; Grok once got stuck on a Cloudflare check). Linux runs: v0.0.17 was driven in a real
Linux desktop session, but that session was WSLg, and the binary was a local build rather than the
`.AppImage` CI attaches -- bare metal has still never been reported. See
[`docs/COMPATIBILITY.md`](../docs/COMPATIBILITY.md).

Report a vulnerability through the private form in GitHub Security, not a public issue:
[`SECURITY.md`](../SECURITY.md).

## Grok's rough edges

Four things about Grok are invisible to the app, and all four catch first-time users:

1. **The sign-in page always lists all four methods (Google, X, Apple, email), which does not
   mean all four work.** Only the ones you enabled under Sign-in methods on your
   [x.ai account page](https://accounts.x.ai/account) reach the account you already have.
   Everyone enables a different set, so "Google will not let me in" is not an app fault.
2. **Signing in with X detours through an authorization page of X's own**
   (`xAI Single Sign-On wants to access...`); press `Authorize app` to come back to Grok.
   That page does not look like Grok, which is why it reads as a wrong turn.
3. **Right after you sign in or register, Grok asks for your birth year inside the chat.**
   Not a dialog, not a challenge page - a message. The app cannot tell: the card still says
   Ready, but what comes back to your question is that age question, and the sequential modes
   feed it to the next step as material. Put Grok on the stage, switch to the real page and
   answer it once; a new profile or a fresh sign-in asks again.
4. **The Firsting Time A card sitting at "Opening..." means the page has not reported a sign-in state yet, not
   that you are signed out.** Press Sign in above the card, or close and reopen the app, and
   it usually settles into ready.

A signed-out Grok on the stage says 1, 3 and 4 on screen. The long version is in
[`docs/BASICS.md`](../docs/BASICS.md).

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

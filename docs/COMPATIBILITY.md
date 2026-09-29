**English** | [繁體中文](./COMPATIBILITY.zh-TW.md)

# Compatibility and manual test matrix

> Last reviewed: 2026-09-29. The newest real-device records are `v0.0.2` on Windows, `v0.0.17` on
> Linux, the single-provider check on `v0.0.19`, and the Meta AI and startup-restore checks on
> `v0.0.23`; the versions in between were not re-run item by item.
>
> This document records **evidence actually observed**, not guarantees. Provider DOM and sign-in
> flows can change at any time, and every piece of real-device evidence below comes from the
> maintainer's single machine.

## What the states mean

- **Verified** — actually run on the named platform, or covered by targeted automated tests.
- **CI only** — GitHub Actions can build the artifact, but no real-device launch has been reported.
- **Verified through WSLg only** — run in a real Linux desktop session, but that session was WSLg on
  the maintainer's Windows machine. Bare metal has still never been reported.
- **Unverified** — support is not claimed until there is a repeatable manual check.

## Desktop platforms

| Platform | Packaging evidence | Real-device launch | State |
|---|---|---|---|
| Windows x64 | NSIS installer and portable build; both local dev and packaged builds succeed | See the v0.0.2 record below | **Verified** |
| macOS Apple Silicon | CI builds the `.dmg` and mounts it to verify the ad-hoc signature of the embedded `.app` | None | **CI only** |
| Linux x86_64 | CI builds the `.AppImage` with WebKitGTK dependencies | See the v0.0.17 record below | **Verified through WSLg only** |

macOS is ad-hoc signed only — not Developer ID signed and not notarised; the Windows artifacts are
not signed at all. Both are [a frozen release policy](./RELEASE.md), not a to-do.

### v0.0.2 Windows real-device test (2026-08-21)

Environment: Windows 11 Pro `10.0.26200`, WebView2 Runtime `151.0.4129.93`. What was tested is the
**portable build produced by CI**, not a local build and not dev.

| Item | Result |
|---|---|
| Portable zip structure | `ai-consultant.exe` + a `PORTABLE` marker file + `README-portable.txt` |
| Version injection | FileVersion / ProductVersion of both exes are `0.0.2` (the repo pins `0.0.0`; CI injects from the tag) |
| Authenticode signature | `NotSigned`, matching policy |
| Launch | Succeeded, WebView2 loaded normally |
| Sign-in on all four providers | All ready |
| Monospace font setting | Works |
| Question/answer capture on the live page | Works |

Not verified: the NSIS installer was never actually installed; image generation, export, update
check and the other items on the list below were not re-run item by item for this version.

**The portable build does not isolate data.** The `PORTABLE` marker (`portable_marker_exists` in
`src-tauri/src/settings.rs`) is only used to recognise a portable build: the update check installs
in place (download the release's portable zip, overwrite this folder, restart) instead of sending
the user to the installer page, and the debug bundle records this field too. Settings and login
state still go through `app_data_dir()` and are shared with an installed build.
Moving to another computer does not carry the login state along, and it leaves traces on the
original machine.

### v0.0.17 Linux test through WSLg (2026-09-06)

Environment: Ubuntu 24.04.4 LTS on WSL2 (kernel `6.18.35.2-microsoft-standard-WSL2`), displayed
through WSLg. What was tested is an **AppImage built in that checkout**
(`AI Consultant_0.0.0_amd64.AppImage` — a local build carries the repo's `0.0.0`), **not the
`.AppImage` CI attaches to the release**.

| Item | Result |
|---|---|
| Launch | Succeeded; WebKitGTK loaded |
| Window layout | Provider panes sit where the app puts them; before this version they were stacked into horizontal bands and the app UI was left a 78px sliver |
| Input inside a provider | Typing and clicking inside a provider pane work |
| Four providers in parallel | One question answered by four providers, three of them parked |
| Window resize | Provider positions follow the resize |

Not verified: the CI `.AppImage`, bare-metal Linux, sign-in on all four providers, and every item in
the product-behaviour list below that is not named above. The fix is Linux-only; Windows and macOS
keep the code path they already had.

### v0.0.19 provider handoff-completion test (2026-09-17)

This version tightened what counts as the end of a turn: the same current assistant turn, unchanged
full response text, no strong activity signal, and a stable completion marker. **Only the Grok item
was tested against a live account**; the rest were not tested at all.

Environment: Windows 11 Pro `10.0.26200`, running the executable from a local `pnpm build:local`
(stamped `v0.0.19`), **not** the artifact CI attached to the release.

| Item | Result |
|---|---|
| Grok Heavy does not finish early | **Passed** — the opening line does not end the turn; the transcript gets the complete answer |
| A send is refused while ChatGPT is generating | **Not tested** |
| ChatGPT multi-phase output does not finish early | **Not tested** |
| Grok stuck-state recovery that recreates the child webview | **Not tested** (needs a real wedge past the watchdog window) |

Not verified: the three items marked not tested above, the CI artifacts themselves (no released file
was downloaded and run), the same behaviour on macOS and Linux, and every item in the
product-behaviour list below that is not named here.

> This version also fixes a problem only this repository could hit: upstream rewrote the completion
> check to read ChatGPT's turn markup while still gating on a per-provider table, and this
> repository's table carries a Grok entry as well. Without the fix Grok never completes at all. The
> row above is the result after that fix.

### v0.0.23 Meta AI and startup restore (2026-09-29)

This version adds Meta AI as a fifth provider, adds a substitute provider that takes
over a role whose provider is not ready, gives Consult a third answerer and an anonymous
review, and fixes three startup-restore problems. Checked by hand by the maintainer.

Environment: Windows 11 Pro `10.0.26200`, **executables built locally with `pnpm build:local`**
while the release was being prepared (the last one stamped `v0.0.22-48-ge2bdecb` with uncommitted changes, the same code as `5f96368`), not the CI artifacts
attached to the release.

| Item | Result |
|---|---|
| Meta AI sign-in inside the app | **Passed** |
| Free mode, one long question to ChatGPT, Grok and Meta AI | **Passed** — all three answered in full and the run finished on its own |
| Meta AI in the centre reopens after a restart | **Passed** — failed before the fix; a trace showed the restore skipped it |
| Meta AI stays ticked in "Send to selected AI" after a restart | **Passed** |
| Every open provider is still open after restarts | **Passed** — a trace showed partial `openProviders` writes during startup before the fix and none after; also checked over several graceful restarts |
| Connection cards in one row | **Passed** |
| Collaboration roles Defaults button | **Passed** |
| Choosing the substitute saves at once | **Automated test only** |
| Consult: ChatGPT, Grok and Meta AI answer at once, Claude reviews, Gemini summarises | **Passed** (dev build) |
| Consult: removing and adding back answerers and the summary in "Send to selected AI", and the Defaults button | **Passed** (dev build) |
| Role-mode chips show only the logo and the role | **Passed** (dev build) |
| A ChatGPT fraction captured as "(numerator) / denominator" | **Passed** (dev build) |
| The reviewer refers to the answers by letter only | **Automated test only** |
| The substitute takes over a signed-out role | **Automated test only** — all five were signed in, so it never triggered |
| The third answerer or the summary is skipped when its provider is not ready | **Automated test only** |
| Claude and Gemini answering a question in free mode | **Not tested** — both answered inside Consult |
| Meta AI or the substitute in a role mode other than Consult (debate, coding, roundtable, brainstorm) | **Not tested** |

Rows marked "dev build" were run on the development build started with `pnpm agent:launch`: the same
code as the released commit, but not a packaged executable.

Not verified: the rows marked above, the CI artifacts themselves, and macOS and Linux.

## The agent source-launch lane

| Evidence | Windows | macOS / Linux | State |
|---|---|---|---|
| Manifest / schema and Skill drift tests | 21 `pnpm agent:verify` checks pass locally | The same suite passes on all three CI operating systems | Source contract **verified**; GUI launch counted separately |
| doctor / audit / dry-run JSON | Run locally; dry-run writes no runtime state | The Node contract path passes on all three CI operating systems | Windows **verified**; the rest **CI only** |
| App-level READY wait | `agent:launch --wait` repeatedly obtained a same-run, identity-verified READY marker locally | No real-device report | Windows **verified**; the rest **unverified** |
| Launch/stop race safety | The fail-closed launch mutex was observed being released; stop re-verifies identity before killing and before deleting the same runtime state; foreign / EPERM tests pass | Same code, never exercised | Windows **verified**; the rest **unverified** |
| Recovery from corrupt state | The default stop refuses a malformed state file and keeps it; `--clear-invalid-state` deletes only the state file, after which launch/stop work normally | Never exercised | Windows **verified**; the rest **unverified** |

The agent contract does not claim that CI ever displayed a window. It also does not install host
prerequisites, inventory the operating system, sandbox the checked-out code, upload receipts, or
roll back host changes. See [`AGENT-READY-SOURCE-RELEASE.md`](./AGENT-READY-SOURCE-RELEASE.md).

The v2.0.0 source contract supports Node.js `^22.13.0 || >=24.0.0`, matching the locked pnpm and
lint toolchain. `agent:doctor` blocks an unsupported Node version and stops, rather than treating
an invalid launch as ready.
This requirement only affects source development; users of a packaged build need no Node.js.

## Provider adapters

| Provider | Bundled adapter | Automated coverage | Real-device evidence |
|---|---:|---|---|
| ChatGPT | v8 | Structure, logged-out precedence, completion markers, ProseMirror composer | Signed in and ready on the v0.0.2 packaged build; long question answered in full on v0.0.23 (local build) |
| Claude | v4 | Structure, sign-in page detection, explicit Google SSO scope | Signed in and ready on the v0.0.2 packaged build |
| Gemini | v2 | Structure, bounded navigation and blocked state for Google `/sorry` | Signed in and ready on the v0.0.2 packaged build; live-page capture works |
| Grok | v7 | Structure, challenge-first deferred takeover, watchdog recovery, DOM changes refused during a challenge | Signed in and ready on the v0.0.2 packaged build |
| Meta AI | v3 | Structure, narrow seed contract, usable-composer login, gated composer stays logged out | Signed in and answered on v0.0.23 (local build) |

The automated tests verify adapter structure, schema v1 / v2 parsing compatibility, rejection of
typed detectors, logged-out precedence, permitted policies, HTTPS URL parsing and navigation
boundaries. They do **not** sign in to real accounts. A remote adapter update cannot widen the URL
scope built into an installed build.

The app does not bypass sign-in, age, subscription, challenge or any provider-side requirement; a
guided flow that assigned a seat to a provider stays blocked until that provider reports its input
box ready.

Gemini may redirect an embedded session to `https://www.google.com/sorry/index?...`. The current
code allows only Gemini onto the HTTPS `www.google.com/sorry` path family, reports it as blocked
rather than signed in, skips the permission shim there, and defers bridge startup until Google
redirects back to Gemini. Sibling paths, lookalike domains, non-HTTPS URLs and cross-provider use
are all refused. Actually completing a challenge is still awaiting manual verification.

Grok's Cloudflare challenge: a single atomic driver reads the shared Cloudflare / hCaptcha title,
body and marker signals in one pass before it changes provider state or creates a bridge, then
retries unresolved and blocked documents through page-load events and a host watchdog. A known
challenge title contains the Traditional Chinese phrase 安全驗證. An engine that is already running
refuses fill, send and stop during a challenge. Closing an allowlisted Grok sign-in popup preserves
one same-document native reload; owner / epoch gating, invalidation on close, rollback and a
bounded navigation-start lease prevent duplicated or permanently stuck recovery, and nothing is
evaluated against a blocked document along the way. **The app never automates or bypasses a
challenge.**

## Product behaviour

Every "automated evidence" entry below comes from this repo's test suites (`pnpm test` 534 checks,
`pnpm agent:verify` 21 checks, `cargo test` 91 checks, all green on 2026-09-11). "Manual check
before release" is a checklist, not a record of work done — the two real-device sections above are
the record, and they cover only the items they name.

| Area | Automated evidence | Manual check before release |
|---|---|---|
| Free mode | Four-way fan-out tests | Send to every selected provider and confirm each one's final response |
| Dialectic / consultation / coding | Standard flow-graph ordering, prompt chaining, four-provider default assignment, preflight for an unavailable provider, configurable roles, bounded retries, terminal errors | Run one default flow end to end and confirm the role labels and the final summary |
| Reasoned dialectic | Five-round four-seat history, four-provider default coverage, configurable assignment, duplicate-seat preflight | Run it once and confirm that earlier turns in the same session are still reachable |
| Brainstorm | 12 rounds × 4 seats rotating, four-provider defaults, four perspectives, 48-step history chaining, five stage prompts, preflight, localisation, snapshots | Set aside 45–90 minutes; confirm four contributions per round and the final integration |
| Long answers | Thinking, pulled fragments, bulk-ready and done-ready all refresh the 10-minute inactivity window; the ChatGPT completion-marker test covers thinking that runs past 10 minutes and fails closed once it truly stops; a 60-minute hard cap also applies | Run a task that exceeds 10 minutes, then confirm that a genuinely stuck task still terminates |
| Session isolation | Conversation persistence compared against the latest snapshot | Create two sessions and confirm that messages and export provenance do not contaminate each other |
| Continuity of a restored session | Stable response identity and bounded same-session replay | Reopen a session and ask a follow-up; confirm the old context is available and does not leak across sessions |
| Response fidelity | DOM to Markdown: paragraphs, nested lists, links, fenced code, direct and nested tables, image-only fallback, revisions and shortening at completion, delayed render batches, literal replacement patterns inside code | Compare one slowly completing answer containing code and a table; confirm the final DOM matches the transcript |
| Live-page question/answer capture | An emptied input box counts as a send, confirmed by either thinking or a new answer node, manual clean-up not adopted | Type and send in the provider's own input box; confirm both question and answer enter the transcript |
| Transcript scrolling | Near-bottom detection and user scroll intent; scroll-linked provider focus, resize / reflow recalculation, the boundary before the first message, binary search, maximised workspace | Stream a long answer, scroll up, resize the window, maximise and restore; confirm the provider chips and the reading position stay stable |
| Session quota recovery | Eviction on quota only, transient failures preserved, persisted state outcome | Fill the local history close to the quota and confirm that only the oldest session is removed |
| Snapshot / replay | Schema, redaction, version mismatch, replay, app version | Enable local snapshot persistence, then save and replay once |
| Markdown export | Format and provenance | Confirm the UTC time, the app version, the matching latest flow / snapshot and the adapter versions |
| HTML export (v0.0.19) | Same heading and provenance as the `.md`; a terminal's box-drawn table, a markdown table flattened onto one line, and a standalone run of "key: value" lines all become `<table>`; the file is named "date + conversation title" | Export a conversation that contains a table, open it in a browser, and confirm the table is drawn, the marks are right, and the name carries the date and the title |
| Diagrams in an export (v0.0.16) | Per-provider source recovery: ChatGPT and Grok from React props, Gemini from the opening keyword, Claude from the response element; each one drops the block rather than exporting the surrounding chrome when the source cannot be read | Ask all four for a Mermaid diagram and confirm the exported `.md` carries the source, not the provider's own UI labels. Measured against a captured run: 121 of 133 diagrams render, the 12 failures being the models' own syntax errors |
| A file a provider hands you (v0.0.16) | Download acceptance on the provider webviews; a finished download is read back under a 512 KB cap and valid UTF-8 only | Press the provider's own Download and confirm the notice names the saved path; for a text file confirm it is filed in the transcript as "provider - filename" and reaches the exported `.md`. An image or an archive is reported by path alone |
| Adapter hot update | Rust validation, version gating, cache, URL scope | Use a higher-versioned test adapter within the permitted host scope |
| Control-pane security | Capability and CSP configuration | Confirm that "Settings → check for updates" and export still work in the packaged build |

## Manual smoke checklist before a release

1. Install or launch the platform's artifact in a clean environment.
2. Sign in to each provider, preferably with a non-sensitive test account. Use Claude's official
   Google or email flow; do not call it ready before the input box appears. On Windows, close
   Grok's embedded popup after signing in and confirm that the blocked pane reloads itself once and
   turns ready without a manual reload. On macOS, explicitly confirm that Grok leaves the
   Cloudflare verification page before calling the version verified.
3. Confirm prompt insertion, auto-send, the thinking state, text completion and reset on a new
   session.
4. Run one free mode and one serial mode, and cancel one run in progress.
5. Generate an image on a provider that supports it, and confirm the flow completes without relying
   on text-only output.
6. Export Markdown and check the provenance; open a new app session and confirm the histories are
   isolated from each other. Ask for a Mermaid diagram and confirm its source reaches the export;
   press a provider's own Download button and confirm the saved path is reported, and that a text
   file also enters the transcript.
7. Installed build: open settings, check for updates, switch theme and interface language, follow
   the author / sponsor links. Portable build: confirm that "download and update automatically"
   closes the app, replaces the folder and reopens it; on failure the old version must be brought
   back and `update-log.txt` must pop up. `README-portable.txt` must also link to the latest
   GitHub Release. With response language set to Auto, confirm that an English question gets
   English and a Traditional Chinese question gets Traditional Chinese, independently of the
   interface language; then verify a fixed language choice again. Pay particular attention to Grok
   answering the question rather than echoing the internal `<response-language-policy>` block.
8. Export a sanitised debug bundle only on failure; never attach secrets or raw provider page
   content.

## How to report

If you have a real macOS or Linux machine, the most valuable report is: OS/CPU, app version,
installation method, whether it opens the first time, sign-in / auto-send / completion detection
for all four providers, and a debug bundle with no private content. For adapter problems use the
GitHub **Adapter broken** form; for security issues report privately as described in
[`SECURITY.md`](../SECURITY.md).

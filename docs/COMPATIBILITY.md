**English** | [繁體中文](./COMPATIBILITY.zh-TW.md)

# Compatibility and manual test matrix

> Last reviewed: 2026-08-21, against `v0.0.2`.
>
> This document records **evidence actually observed**, not guarantees. Provider DOM and sign-in
> flows can change at any time, and every piece of real-device evidence below comes from the
> maintainer's single machine.

## What the states mean

- **Verified** — actually run on the named platform, or covered by targeted automated tests.
- **CI only** — GitHub Actions can build the artifact, but no real-device launch has been reported.
- **Unverified** — support is not claimed until there is a repeatable manual check.

## Desktop platforms

| Platform | Packaging evidence | Real-device launch | State |
|---|---|---|---|
| Windows x64 | NSIS installer and portable build; both local dev and packaged builds succeed | See the v0.0.2 record below | **Verified** |
| macOS Apple Silicon | CI builds the `.dmg` and mounts it to verify the ad-hoc signature of the embedded `.app` | None | **CI only** |
| Linux x86_64 | CI builds the `.AppImage` with WebKitGTK dependencies | None | **CI only** |

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
| ChatGPT | v6 | Structure, logged-out precedence, completion markers | Signed in and ready on the v0.0.2 packaged build |
| Claude | v4 | Structure, sign-in page detection, explicit Google SSO scope | Signed in and ready on the v0.0.2 packaged build |
| Gemini | v2 | Structure, bounded navigation and blocked state for Google `/sorry` | Signed in and ready on the v0.0.2 packaged build; live-page capture works |
| Grok | v7 | Structure, challenge-first deferred takeover, watchdog recovery, DOM changes refused during a challenge | Signed in and ready on the v0.0.2 packaged build |

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

Every "automated evidence" entry below comes from this repo's test suites (`pnpm test` 493 checks,
`pnpm agent:verify` 21 checks, `cargo test` 87 checks, all green on 2026-08-21). "Manual check
before release" is a checklist, not a record of work done — v0.0.2 only covered the items listed in
the Windows real-device section above.

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
   isolated from each other.
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

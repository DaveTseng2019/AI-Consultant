**English** | [繁體中文](./RUN-AND-UPDATE.zh-TW.md)

# Run and update guide

This document collects the everyday run and update procedures. For the full background see
[.github/README.md](../.github/README.md).

## Prerequisites

- Node.js ^22.13.0 || >=24.0.0
- pnpm (this project pins `pnpm@11`; Corepack works: `corepack enable`)
- Rust stable toolchain (on Windows, MSVC + Visual Studio Build Tools "Desktop development with C++")
- Windows 10/11 usually ships WebView2 already

## Ways to run it

### Way 1: run it directly (development mode)

```sh
pnpm install
pnpm build:injected   # produce the injected scripts in src-tauri/gen/injected
pnpm tauri dev        # the first Rust compile is slow; the window opens by itself when it finishes
```

### Way 2: through the agent scripts (with audit and state management)

```sh
node scripts/agent/doctor.mjs --json     # check the prerequisites
node scripts/agent/launch.mjs --wait --timeout-ms 600000 --json
node scripts/agent/status.mjs --json --lines 80   # check state; only state: "ready" counts as ready
node scripts/agent/stop.mjs --json       # stop
```

In Claude Code you can run `/launch-ai-consultant` directly; it is the same flow plus the before
and after audits.

### Way 3: build one for yourself

This project publishes no installer. The everyday way to use it is to build a release build
yourself and point a desktop shortcut at
`src-tauri\target\release\ai-consultant.exe` — see "Producing an executable" below.

## Ways to update

### Update the source (development environment)

```sh
git pull
pnpm install          # sync dependencies when the lockfile changed
pnpm build:injected   # required whenever the injected scripts changed
pnpm tauri dev
```

### Verify after updating

```sh
pnpm verify   # all in one: build:injected + typecheck + lint + test + agent:verify + adapter checks
```

> **Close the app before running `pnpm verify`.** The `launch dry-run` case inside `agent:verify`
> expects `would_start`; with the app running it gets `already_running`, and the whole
> `pnpm verify` exits non-zero. That is not a broken program, but it looks exactly like a real
> failure. Stop it with `node scripts/agent/stop.mjs --json` and run again.

For a quick check, run the parts separately:

```sh
pnpm typecheck
pnpm test
```

### Update a released version (installed build)

The app's built-in update check compares against the latest GitHub release, but this project
publishes no releases, so that path does nothing here. Updating means `git pull` followed by
another `pnpm build:local`; local settings and provider login profiles live in app data and are
unaffected by a rebuild.

## Producing an executable

### Local packaging (development environment)

```sh
pnpm build:local            # build + stamp (scripts/build-local.mjs)
pnpm build:local --close    # with the app open: ask it to close first, then build
pnpm build:local --stamp-only   # stamp only, valid as long as HEAD has not moved
```

Underneath it is still `pnpm tauri build` (tauri.conf's `beforeBuildCommand` builds the frontend
and the injected scripts first), but running that directly does not stamp; the next section says
why that matters.

Where the artifacts land:

- Bare executable: `src-tauri/target/release/*.exe`
- NSIS installer: `src-tauri/target/release/bundle/nsis/*-setup.exe`

The portable zip (carries the `PORTABLE` marker; the update check installs in place here —
`portable_update_start` downloads the release's portable zip, and a PowerShell script waits for the
app to exit, overwrites the folder and reopens it):

```sh
pnpm pack:portable    # package from src-tauri/target/release into dist/portable/
```

The zip filename carries the version, but **the folder inside is always named
`ai-consultant-windows-portable`** without a version — an update overwrites the same folder in
place, and a versioned folder name would turn every update into one more copy.

**Which folder the update writes into: the one the exe itself is in, regardless of its name.**
The target is the parent directory of `std::env::current_exe()` (`portable_update_start`), so a
user who unzipped to `D:\AI-Consultant-0.0.13-windows-portable\` still updates fine — that folder
keeps its original name and gets the new version inside; the program neither creates another folder
nor moves anything. **A folder name therefore cannot be used to tell the version**; read the
version on the settings page or in `build-info.json`.

Two consequences follow: the unzip location must be writable without administrator rights
(`Program Files` is not), because the app has to overwrite its own folder; and settings and logins
are not in that folder (they are in `%APPDATA%`), so an update leaves them alone — but moving the
folder to another computer does not carry them along. All of this is written in the
`README-portable.txt` inside the zip.

Note: a local build's version number is always `0.0.0`; the real version is injected by CI from the
git tag.

### Version tracking: which commit built this exe

The local setup is experimental. The desktop shortcut points at a self-built
`src-tauri\target\release\ai-consultant.exe`, with no official build installed. This is a
verification build, versions start at `0.0.0`, following the source project's practice: the repo
pins `0.0.0` and the real number is injected from the tag by the release flow. The consequence is
that a locally built exe also has FileVersion `0.0.0`, and there is no way to see which commit it
came from.

So `git describe --tags` is used as the local version instead, stamped at build time into a
`build-info.json` next to the exe. The stamped file lands in `target/` (already ignored by line 3
of the repo's `.gitignore`), so it can never reach a commit, a PR or a release:

```powershell
pnpm build:local     # build + stamp (scripts/build-local.mjs)
pnpm build:local --close   # with the app open: ask it to close first, then build
```

The fields in `build-info.json`: `describe` / `commit` / `branch` / `dirty` / `builtAt` /
`stampedAt`. A true `dirty` means the working tree had uncommitted changes at build time, and
`describe` then understates what that exe actually contains.

> **Always build through `pnpm build:local`.** Running `pnpm tauri build` directly does not stamp,
> and the version is then lost — which happened on 2026-08-06: the build ran while on the
> `fix/collect-late-response-text` branch, and main was checked back out four minutes later. The
> exe in everyday use was therefore stuck at `v1.8.3-4-ga008c83`, missing v1.8.4's `webviews.rs`
> (+610 lines) and the response-integrity fix, and the only way to find out was reconstructing it
> from the timestamps in `.git/logs/HEAD`.
> After a manual build you can stamp afterwards with `pnpm build:local --stamp-only`, as long as
> HEAD has not moved.

> **You cannot build while the app is open** — a running exe locks itself, the failure only comes
> at the link stage, the error message never mentions the real reason, and the previous few minutes
> of compilation are wasted. `build:local` therefore checks with `tasklist` before it starts, and
> stops with an explanation if it finds one running.
> Only `--close` closes it for you (with `taskkill` without `/F`, equivalent to pressing the
> window's close button, so settings are still saved), waiting at most 10 seconds. **It never
> closes anything by default**: that window may be in the middle of a conversation round, and
> killing it for a build is worse than typing one more argument.

### Official release (three platforms, through CI)

Pushing a `v*` tag triggers the release workflow. CI produces the Windows `.exe` / `.zip`, the
macOS `.dmg` and the Linux `.AppImage`, attaches them to a **draft** release, and only a human
review leads to Publish. CI never creates a tag and never publishes.
The version comes from the tag; the repo always keeps `0.0.0`, and releasing requires no file
edits.

Check the current tags with `git tag -l`. Full steps, how to void a build and the pre-release
checklist are in [RELEASE.md](./RELEASE.md).

## The phantom changes under `src-tauri/permissions/autogenerated/`

`git status` permanently shows 29 `.toml` files under this directory as modified while `git diff`
is empty — that is a CRLF line-ending difference with identical content. **Do not stage them.**

## Replaying records (snapshot replay)

> Checked line by line against `src/ui/ReplayPanel.tsx`, `src/workflow/snapshot/replay.ts`,
> `src/workflow/snapshot/types.ts` and `src/App.tsx` on 2026-08-12 (baseline commit `5f77ed5`).
> This section can go stale when those files change.

The "Replay records" toggle button in the title bar (`replay.historyToggle`) expands the
`#replay-history-panel` drawer, which contains `ReplayPanel`. It takes the snapshot left by a run
and **runs it again** along the normal workflow path; it is not a playback of the old screen — it
really ends up calling `executeGraph`, and the AI answers afresh.

A snapshot stores the graph id, the graph version, the role → provider mapping, the original
question, and each step's input and output (`ExecutionSnapshot`).

### Two sources

- **Replay the last run**: `getLastSnapshot()` in memory, gone after a restart.
- **Saved snapshots**: only persisted when durable snapshots are enabled; the list is sorted newest
  to oldest by creation time, and each entry can be replayed or deleted.

There is a third entry point: if a session checkpoint is detected at startup,
`SessionCheckpointNotice` offers a "Replay" button for the matching snapshot.

### Five checks before it re-runs (`planReplay` / `replaySnapshot`)

| Situation | `ReplayBlockReason` | Behaviour |
|---|---|---|
| The snapshot cannot be read (deleted, or wrong id) | `not-found` | Reports the error directly |
| The graph no longer exists | `unknown-graph` | Blocked outright, showing the graphId |
| The graph version differs from the original | `graph-version-mismatch` | Blocked first, showing both versions; continues only after "Replay with the current graph" |
| The original question was not kept | `question-required` | Asks for it manually; the criterion is `userQuestion.kind === 'inline'`, and the `metadata-only` and `hashes` tiers do not keep it |
| Preflight failed | `preflight` | Lists each unavailable provider with an "Open sign-in" button, and separately lists the aliased roles |

### Easy things to get wrong

- **A replay produces a new snapshot**, it does not overwrite the old one; on success it returns
  `newSnapshotId` and refreshes the list automatically.
- **The replay targets are not guaranteed to match the original**: for free-style graphs the
  targets are intersected with "the connections that can send right now" (`replayTargets` +
  `isSendable`), so a provider that was present then but is signed out now is skipped.
- **The response-language policy is restored**: it is reconstructed from each step's prompt in the
  snapshot (graphVersion ≥ 2 only), falling back to the current setting when absent.
- **There are four redaction tiers**: `metadata-only` / `hashes` / `prompt-text` / `full-local`,
  deciding how much is kept in a snapshot.

### What it is for

Running the same question again under different conditions for comparison (`full-local` keeps the
original text and `hashes` keeps SHA-256; both feed the `priorOutputs` / `priorHashes` used for
comparison), and reproducing a past flow while debugging.

## Custom action buttons

You can add your own buttons to the conversation toolbar: **Settings → Advanced and diagnostics →
Custom action buttons**. One button = one PowerShell script, and pressing it passes the current
execution record (`-SnapshotId`), the current conversation's `.md` (`-MarkdownPath`), or nothing at
all.

Ready-to-use examples and the full explanation (including two ways to hand the `.md` to VS Code)
are in [`examples/custom-actions/`](../examples/custom-actions/README.md).

## Debugging invisible host-side state (Grok trace)

> Written 2026-08-17. The cause: Grok stuck at "state stale" took a very long time to diagnose,
> because the tracing detail was never recorded during testing, so every round was
> "guess a cause → reproduce → guess wrong". With tracing added, **one** reproduction settled it.

### Why it is needed

Grok's readiness verdict depends on three host-side states that are **completely invisible**:
the document epoch, the app-title signal, and why each of the three drive paths (`load-finished`,
the 5-second watchdog, a card click) refused. On screen, stuck and very slow look identical — both
say "Confirming this AI session…", and both keep saying it. Without tracing there is only
reasoning, and reasoning got it wrong three times in a row here:

1. Assumed inline `<code>` was collapsing newlines → in fact `<pre>` goes through `textContent`
2. Assumed the title did not match the `Grok` prefix pattern → it did match
3. Assumed a reload returned to an older titled conversation → also no

The real cause is a **title-signal race**: the engine uses `document.title` as its return channel,
and the title keeps flipping between `Grok` and an encoded frame. If the title happens to sit at
`Grok` during navigation and the new document's title is also `Grok`, the two are identical →
`on_document_title_changed` does not fire → that epoch never gets its grant → all three paths die
at once.

## Common commands

| Command | Purpose |
|---|---|
| `pnpm tauri dev` | Run in development mode |
| `pnpm build` | Build the frontend (vite) |
| `pnpm build:injected` | Build the injected scripts |
| `pnpm verify` | Full verification (recommended before committing) |
| `pnpm test` | Run the vitest tests |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm lint` | ESLint |
| `pnpm build:local` | Build the release build and stamp the commit (the everyday local one) |
| `pnpm tauri build` | The underlying release build, without stamping |
| `pnpm pack:portable` | Package the portable zip |

**English** | [繁體中文](./RELEASE.zh-TW.md)

# Release procedure

> **Published versions start at `v0.0.1` (2026-08-21).** Run `git tag -l` to see the current latest
> before tagging a new one; this document is not updated per version.

Releasing is **tag driven**: you push a `v*` tag, CI builds three platforms, and a **draft** release
is opened with the artifacts attached. You review it and press Publish yourself. **CI never creates
a tag and never publishes** — nothing happens before the tag is pushed, and nothing is public
before the draft is published.

## One release

### 1. Stop the running app

```sh
node scripts/agent/stop.mjs --json
```

> `pnpm verify` fails while the app is open. The `launch dry-run` case in
> `scripts/agent/tests/commands.test.mjs` expects `would_start`, but with the app running it gets
> `already_running`. That is not a broken program, it is an unclean environment — but it makes
> `pnpm verify` exit non-zero and look like a real failure.

### 2. Verify locally

```sh
pnpm verify                                  # build:injected + typecheck + lint + vitest + agent:verify + adapter checks
cd src-tauri
cargo test
cargo fmt -- --check
cargo clippy --all-targets -- -D warnings
```

All four must pass. The detailed pre-release checks are in the list below.

### 3. Confirm main is pushed

```sh
git push origin main
```

The tag must point at a commit `origin` already has, or CI cannot check it out.

### 4. Tag and push

```sh
git tag -a v0.1.0 -m "v0.1.0: say what this version did"
git push origin v0.1.0
```

### 5. Wait for CI, review the draft, publish

After the push, wait **10–20 minutes** (three platforms building separately). Open the draft at
<https://github.com/DaveTseng2019/AI-Consultant/releases>:

- Confirm the Windows `.exe` / `.zip`, the macOS `.dmg` and the Linux `.AppImage` are all attached
- Download at least the Windows artifact and actually run it once
- Check the auto-generated release notes

If it is fine, press **Publish release**.

### 6. Rebuild the local executable

```sh
pnpm build:local
```

A CI release does **not** touch `src-tauri/target/release/ai-consultant.exe`, which is what the
local desktop shortcut points at. Without a rebuild, the one you use every day is still the old
pre-release executable. `build:local` writes the commit into the neighbouring `build-info.json`, so
that the version in your hand can be identified later. An open app locks the exe and makes linking
fail; add `--close` to let it close the app itself.

### Voiding a build

Delete the draft release, then delete the tag:

```sh
git push origin :refs/tags/v0.1.0
git tag -d v0.1.0
```

Nothing is public before publishing.

## The version comes from the tag

The release workflow only triggers on a `v*` tag. It strips the leading `v`, injects the version
into `package.json` and `src-tauri/tauri.conf.json` inside the CI checkout, and only then runs
`pnpm tauri build`.

**The version in the repo is always `0.0.0`**; releasing requires no file edits.

A tag name containing `-pre` is marked as a prerelease (for example `v0.2.0-pre.1`).

## What CI produces

| Platform | Artifact |
|---|---|
| Windows | NSIS installer `.exe` + portable `AI-Consultant-<version>-windows-portable.zip` |
| macOS | An ad-hoc signed `.dmg`; CI mounts it and strictly verifies the embedded `.app` signature |
| Linux | `.AppImage` |

The portable `.exe` sits next to a `PORTABLE` marker file. Portable mode **hides the in-app update
check**, and portable users fetch new versions from GitHub Releases themselves. Installed users can
use "Settings → check for updates" to detect a new version and open the download page — the app
never downloads or installs anything by itself.

## Pre-release checklist

- `pnpm verify` (including `pnpm agent:verify`), the Rust tests, `cargo fmt -- --check` and
  `cargo clippy --all-targets -- -D warnings` all pass.
- `agent-release.json` validates against the schema; the two Skill bodies are in sync and stay
  explicit-invocation-only; `node scripts/agent/launch.mjs --dry-run --json` writes nothing. The
  source lane installs no host prerequisites and builds no release artifacts.
- The default capability points only at `webviews:["main"]`, with no `windows` or `remote` entries;
  the packaged control pane can still check for updates and export under the production CSP.
- The remote adapter tests allow selector and timing changes within the URL scope already built in,
  and refuse to widen provider / login / match / SSO.
- Update [`COMPATIBILITY.md`](./COMPATIBILITY.md) with **evidence actually observed**. A successful
  CI package is not a successful user launch.
- Test the Windows artifact for real before releasing. On Apple Silicon, confirm the first launch
  and sign-in on all four providers, specifically requiring Grok to pass the Cloudflare
  verification. Linux stays CI-only until there is a real-device report.

## Frozen release policy

- The final identifier is `tw.micasa.aiconsultant`.
- GitHub Releases is the only update channel. The app may check whether a new version exists and
  open its page, but it **never downloads or installs an update by itself**.
- A release tag also carries the Agent-Ready Source Release manifest and Skills, but they only
  start `tauri dev` from a trusted checkout. That is not a packaged artifact, a container, an
  updater, or a host-tool installer. See
  [`AGENT-READY-SOURCE-RELEASE.md`](./AGENT-READY-SOURCE-RELEASE.md).
- Windows Authenticode signing, macOS Developer ID / notarisation, an updater manifest, and
  separate package-manager distribution are all **closed scope**, not to-dos. The macOS ad-hoc
  signature is a packaging-integrity floor, not an identity scheme.
- Every release tag must pass `pnpm verify`, cross-platform
  `cargo clippy -- -D warnings`, and the three-platform build workflow before the draft is
  published.

## What users will run into

- **The Windows artifacts are unsigned.** SmartScreen warns, and the user must press
  "More info → Run anyway".
- **The portable build needs the Microsoft Edge WebView2 Evergreen Runtime.** Windows 10/11
  usually has it already.
- **The macOS artifact is ad-hoc signed and not notarised.** After the first launch is blocked, the
  user must go to "System Settings → Privacy & Security → Security" and press "Open Anyway". That
  option usually only appears for about an hour.

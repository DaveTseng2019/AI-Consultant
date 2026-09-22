# Changelog

[繁體中文](CHANGELOG.zh-TW.md)

The full notes for each version are on [GitHub releases](https://github.com/DaveTseng2019/AI-Consultant/releases).
Dates are the release date (UTC). The repo pins `0.0.0` on purpose; the real number is injected by
the release CI from the tag.

## [v0.0.22](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.22) — 2026-09-22

- The answer is captured when ChatGPT collapses a long question into an expandable block. That step
  used to come back with no text.
- The preset details panel is larger, cost label included.
- The off-scale font sizes scattered through the sidebar, focus pane, settings, process trace and
  composer are folded into the scale, so all of them track the interface font size setting.
- Conversation timestamps keep their layer through colour rather than a 1px size difference.
- The app logo no longer scales with the font size. It is artwork, not text.
- Every provider mark is one size, defined in one place.
- Coding mode's description is rewritten: "tests" read as if something is executed, when that step
  reasons through test cases and runs nothing; the ending changed from "a concrete answer" to the
  finished code and notes on using it. All four locales.
- BASICS documents pasted images: how to paste, the limits, and that serial modes send them too,
  once per provider.

## [v0.0.21](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.21) — 2026-09-22

- A "System default" theme that follows the Windows light/dark setting, including a switch made
  while the app is open.
- "Scale together" − / ＋ in settings: the interface font size and the main panel text size change
  by 1 together.
- A "Defaults" button that restores the theme, both font sizes and the monospace setting, and
  nothing else.
- The centred provider collapses to its title row and hands the room to the process trace and the
  connection strip. The real page goes with it.
- The "⋯" menu shows on the text view only. On the real page it is HTML under a native page, so it
  opened behind the site and read as dead.
- After a question has been asked, Expand may take the "Send to selected AI" strip too.

## [v0.0.20](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.20) — 2026-09-21

- Fixed ChatGPT refusing to send with errors such as `composer changed before send`. The prompt
  reached the composer twice: a paste takes a moment to arrive, the app checked before it did, read
  an empty composer, and pasted again.
- Fixed the follow-on where every later send failed. The ruined draft stayed in the composer and
  each new prompt piled on top; only clearing it by hand recovered it, and New conversation did not.
  A leftover draft is now cleared first, and each write is judged after the editor settles.
- An injection failure reports what did not match and which steps ran.

## [v0.0.19](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.19) — 2026-09-17

- New **Export .html** button.
- The HTML export turns text that only looks like a table back into one: a terminal's box-drawn
  table, a markdown table flattened onto one line, and a standalone run of "key: value" lines. A
  cell the terminal wrapped over several lines is rejoined.
- Both exports are named `YYYY-MM-DD <conversation title>`, dated the day the conversation started,
  so exporting twice rewrites one file.
- Grok's mark is Grok's own logo. It used to be X's.
- The Grok and ChatGPT marks are redrawn to fill their tiles, so the four read as one set.

## [v0.0.18](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.18) — 2026-09-16

No notes were written for this one, only the
[generated commit list](https://github.com/DaveTseng2019/AI-Consultant/compare/v0.0.17...v0.0.18).

## [v0.0.17](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.17) — 2026-09-06

- The Linux build gets the layout every other platform already has. The provider panes used to be
  stacked into horizontal bands, leaving the app's own UI a 78px sliver with the connection strip,
  composer and transcript off screen.
- The cause: the bounds the app asked for were discarded on Linux, because each webview was packed
  into a container that only stacks and has no coordinates. The inside of the window is rebuilt as a
  layer that does have coordinates.
- Linux only. Windows and macOS keep the existing path.
- Verified on a real Linux desktop: typing and clicking inside a provider, four providers answering
  one question with three parked, and positions following a window resize.

## [v0.0.16](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.16) — 2026-09-02

- Diagrams survive an export again. Each provider lost them differently: ChatGPT renders the block
  as an image and leaves the menu button's label behind, Grok draws straight into the answer with no
  code block, Gemini names no language, and Claude keeps the answer in a file beside the
  conversation. All four are handled; 121 of 133 diagrams render in a captured run.
- The download button inside a provider pane does something. The file is saved where the browser
  would have put it, and a notice names the path.
- A text file that arrives this way is read back and filed under "<provider> - <filename>" (512 KB
  cap, valid UTF-8 only); an image or archive is reported by path alone.
- Fixed a duplicate capture introduced in the same round: Claude's response element already holds
  the document, so the code that fetched it again from the side panel captured everything twice.

## [v0.0.15](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.15) — 2026-09-01

- New conversation works mid-run. The button used to be disabled while a workflow ran. It now stops
  the running question and opens a clean conversation in one step.
- Cancelling no longer leaves `Error: Workflow cancelled by user` behind. That message arrived after
  the transcript was cleared and landed in the new, unrelated conversation.
- Provider panes clear on the spot instead of at the next send. Sending while they are still
  reloading waits for them rather than dropping them from the run.

## [v0.0.14](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.14) — 2026-09-01

- The Replay button beside an interrupted-run notice no longer runs the wrong thing. It pointed at
  the last completed run of the same workflow, and a run closed outright leaves no recording at all.
  The button is offered only when a recording exists.
- The window title says what the app is doing: connecting, the running step, or the app name when
  idle.
- Settings gains **Start maximized**. It is read before the window is painted, so it takes effect at
  the next launch.
- A development build and a release build can run at the same time; the development build carries a
  `DEV` suffix. This also fixes launching a development build raising the release window and
  quitting.

## [v0.0.13](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.13) — 2026-08-31

- The portable build updates itself: it closes, downloads, replaces its own folder and reopens. A
  failed update restores the previous version and opens `update-log.txt`.
- The folder inside the zip drops the version and is always `ai-consultant-windows-portable`. A
  per-version name meant an update left a copy beside the old one instead of replacing it.
- **Anyone on the v0.0.12 portable build still has to update by hand once**; one-click starts here.
- New conversation no longer resets the mode to free mode.

## [v0.0.12](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.12) — 2026-08-31

- The conversation sidebar can be dragged wider, 160–400 px, always leaving 240 px for the stage.
  The width is remembered.
- The mode cards live only while the transcript is empty. The badge in the conversation header keeps
  saying which mode is running.
- Pressing a provider expands it over the mode row; pressing again restores.
- Fixed `cargo clippy` being red on all three CI platforms since v0.0.11, and aligned the local Rust
  toolchain with CI. No behaviour change.

## [v0.0.11](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.11) — 2026-08-31

- A new conversation now uses each site's own control instead of reconnecting the page. Login state
  and the bridge survive, so the second send can start straight away.
- The old reload is the fallback, used only when the control is missing or the URL has not changed
  within three seconds.

## [v0.0.10](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.10) — 2026-08-30

No notes were written for this one, only the
[generated commit list](https://github.com/DaveTseng2019/AI-Consultant/compare/v0.0.9...v0.0.10).

## [v0.0.9](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.9) — 2026-08-29

- Expand collapses the mode picker and gives the room to the provider, instead of covering it with a
  native pane the mode cards were still under.
- Only your own press gives that room up. The automatic expand while a provider is signed out, and a
  checkpoint mid-run, both keep the picker.
- A line under the composer says insert-file takes text files and an image is pasted with Ctrl + V
  or Alt + V. This used to surface only after picking the wrong file, worded as if images were
  unsupported. All four locales.

## [v0.0.8](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.8) — 2026-08-29

- The custom toolbar button becomes a list of any length. Each row has a name, a `.ps1` path, a
  note, what to pass, and a confirm-before-running flag. Order is set with ↑ ↓, and an existing
  setting migrates into the first row.
- What is passed is your choice: nothing, `-SnapshotId <id>`, or `-MarkdownPath <file>`. Which
  program opens the `.md` is the script's decision — Windows has no default for it.
- `examples/custom-actions/` ships two working scripts and the full explanation.
- Settings gains a single-instance option, on by default. Two copies share one set of provider
  logins and one settings file and overwrite each other.
- The settings button moves to the bottom left beside the connection strip, where it exists from the
  first frame. It used to live in a column that is hidden at startup.
- Section headings in settings are a size larger in the brightest text colour; custom action buttons
  get their own section.
- The mode picker now hides only while a question is being processed.
- **Upgrade note: running v0.0.7 or older afterwards clears the custom buttons**, because the older
  build does not know that field.

## [v0.0.7](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.7) — 2026-08-29

- The run-script button no longer needs persisted snapshots. Pressing it writes a temporary
  full-local snapshot for the script to read and deletes it afterwards. Snapshots already on disk
  are untouched.
- Every provider name carries its mark: answers in the conversation, provider headers, the
  diagnostics cards and event log, and the access panel. Under a role the header shows the role
  name, so the mark is the only thing left saying which AI wrote it.
- The mode picker's hiding rules narrow to two: a question in progress, and an expanded provider.
- The access panel collapses from four copies into one. The four were word-for-word identical — the
  same engine is injected into all four webviews.

## [v0.0.6](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.6) — 2026-08-28

- An image on the clipboard can be pasted straight into the question. It rides the provider's own
  upload path.
- Limits: 4 images per question, 4 MB each. The `.md` export and the transcript do not carry them.
- "Send to selected AI" shows in every mode. It used to appear in free mode only, so a session
  restored into a role-driven mode said nothing about who would be asked. Where roles decide, the
  same chips show ticked and frozen.

## [v0.0.5](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.5) — 2026-08-28

- A slow Grok answer no longer leaves only its opening line. The cause was not a short timeout but
  no signal that Grok was still generating: no `data-testid` on the stop button, a translated
  aria-label, no `data-streaming`, and a thinking block in the interface language. The per-answer
  action row is used instead — copy/share/rate appear only once the answer is finished.
- Code blocks get a border in dark mode, where their background matched the message card.
- Clicking a connection chip expands that provider. Not while an answer is in flight, where it only
  centres and scrolls.
- Settings shows the current version without pressing Check for updates. A local build shows its
  build stamp, so the commit behind it is visible.

## [v0.0.4](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.4) — 2026-08-26

- The send targets and the status message no longer vanish at startup. They lived in two containers
  that are both collapsed then; they are their own row now.
- A provider that has not reported yet shows "Opening…" instead of "Status stale", which read as a
  fault.
- The status strip tells "still connecting" apart from "please connect".
- New conversation no longer piles up a second blank conversation.
- Collapsing the sidebar on New conversation becomes an option, off by default.
- The portable build can check for updates, and the download link points at that version's portable
  zip rather than a page of installers.

## [v0.0.3](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.3) — 2026-08-25

No notes were written for this one, only the
[generated commit list](https://github.com/DaveTseng2019/AI-Consultant/compare/v0.0.2...v0.0.3).

## [v0.0.2](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.2) — 2026-08-21

- A question typed into a provider's own composer reaches the transcript. The composer being cleared
  counts as a send, and the app takes over the round once the provider starts answering.
- Settings gains a monospace option, saved on tick.
- The release documentation gains the "rebuild the local executable afterwards" step.

## [v0.0.1](https://github.com/DaveTseng2019/AI-Consultant/releases/tag/v0.0.1) — 2026-08-21

The first release. No notes were written, only the
[generated commit list](https://github.com/DaveTseng2019/AI-Consultant/commits/v0.0.1).

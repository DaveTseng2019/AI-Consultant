# Vendored wry

## Source

crates.io `wry` 0.55.1, copied unchanged from the cargo registry, then patched in one place.
The version in `Cargo.toml` stays at 0.55.1. The root `src-tauri/Cargo.toml` redirects to this
copy with `[patch.crates-io]`.

## Why it is patched

The app checks every navigation against a domain allowlist (`on_navigation` in
`src-tauri/src/webviews.rs`). A navigation outside the list is cancelled and opened in the system
browser.

WebView2 (Windows) calls this handler only for main-frame navigations. On macOS, wry's
`navigation_policy` calls the handler for every navigation, including iframes. As a result, iframes
such as `sentinel.openai.com` (ChatGPT) and `newassets.hcaptcha.com` (Claude) were cancelled and
opened in the system browser, and sign-in got stuck.

## The only change

File: `src/wkwebview/navigation.rs`, function `navigation_policy`.
In the `else` branch (not a download), before the call to `navigation_policy_function`, a
navigation whose `targetFrame()` exists and is not the main frame is allowed directly. The handler
is not asked. When `targetFrame()` is `None` (a new window), the original flow runs unchanged.
The change is marked with a `notes:` comment.

## When you upgrade tauri or wry

1. Copy the new wry version from the cargo registry over this directory (keep the LICENSE files).
2. Apply the change from "The only change" again.
3. Check that the wry version in `src-tauri/Cargo.lock` matches the version that
   `tauri-runtime-wry` requires.
4. If upstream wry already filters subframes, delete this `vendor/wry` directory and the
   `[patch.crates-io]` section in `src-tauri/Cargo.toml`.

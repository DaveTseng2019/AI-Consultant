use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
const DEFAULT_LANGUAGE: &str = "system";
const LANGUAGES: &[&str] = &["system", "en", "zh-TW", "ja", "de"];
const DEFAULT_RESPONSE_LANGUAGE: &str = "auto";
const RESPONSE_LANGUAGES: &[&str] = &["auto", "en", "zh-TW", "ja", "de"];
const DEFAULT_LAYOUT_MODE: &str = "focus";
const DEFAULT_FOCUS_PANE_WIDTH: f64 = 620.0;
const MIN_FOCUS_PANE_WIDTH: f64 = 420.0;
const MIN_CONTROL_PANE_WIDTH: f64 = 520.0;
const RESIZER_WIDTH: f64 = 6.0;
const SETTINGS_NORMALIZATION_CONTAINER_WIDTH: f64 = 1400.0;
const DEFAULT_SNAPSHOT_REDACTION_TIER: &str = "metadata-only";
const SNAPSHOT_REDACTION_TIERS: &[&str] = &["metadata-only", "hashes", "prompt-text", "full-local"];
const ARCHIVE_LABEL_MAX_CHARS: usize = 16;
const ACTION_ID_MAX_CHARS: usize = 64;
const CUSTOM_ACTION_PAYLOADS: &[&str] = &["none", "run", "markdown"];
const ACTION_NOTE_MAX_CHARS: usize = 200;
const PROVIDERS: &[&str] = &["chatgpt", "claude", "gemini", "grok"];
const PRESENTATION_STATES: &[&str] = &["chip", "side", "center"];

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json"))
}

fn portable_marker_exists() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("PORTABLE")))
        .is_some_and(|path| path.exists())
}

/// What to print as the version. The repo pins 0.0.0 and only CI injects a real one from the tag,
/// so on a locally built exe the package version says nothing about which build is in hand.
/// build-local.mjs stamps `describe` beside the exe for exactly this, and it wins when present.
fn build_stamp_from_json(content: &str) -> Option<String> {
    let value: Value = serde_json::from_str(content).ok()?;
    let describe = value.get("describe")?.as_str()?.trim();
    (!describe.is_empty()).then(|| describe.to_string())
}

fn local_build_stamp() -> Option<String> {
    let path = std::env::current_exe()
        .ok()?
        .parent()?
        .join("build-info.json");
    build_stamp_from_json(&std::fs::read_to_string(path).ok()?)
}

#[tauri::command]
pub async fn app_version_label(app: AppHandle) -> String {
    local_build_stamp().unwrap_or_else(|| app.package_info().version.to_string())
}

pub fn read_settings(path: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(content) if content.trim().is_empty() => Ok(Value::Object(Map::new())),
        Ok(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(error.to_string()),
    }
}

pub fn write_settings(path: &Path, settings: &Value) -> Result<(), String> {
    let mut persisted = settings.clone();
    if let Value::Object(map) = &mut persisted {
        map.remove("portable");
    }

    let bytes = serde_json::to_vec_pretty(&persisted).map_err(|error| error.to_string())?;
    write_atomic(path, &bytes)
}

pub fn normalize_settings_value(settings: Value) -> Value {
    let mut settings = match settings {
        Value::Object(map) => Value::Object(map),
        _ => Value::Object(Map::new()),
    };
    if let Value::Object(map) = &mut settings {
        let language = map
            .get("language")
            .and_then(|value| value.as_str())
            .filter(|value| LANGUAGES.contains(value))
            .unwrap_or(DEFAULT_LANGUAGE);
        map.insert("language".to_string(), Value::String(language.to_string()));

        let response_language = map
            .get("responseLanguage")
            .and_then(|value| value.as_str())
            .filter(|value| RESPONSE_LANGUAGES.contains(value))
            .unwrap_or(DEFAULT_RESPONSE_LANGUAGE);
        map.insert(
            "responseLanguage".to_string(),
            Value::String(response_language.to_string()),
        );

        map.insert(
            "layoutMode".to_string(),
            Value::String(DEFAULT_LAYOUT_MODE.to_string()),
        );
        let focus_pane_width = map
            .get("focusPaneWidth")
            .and_then(|value| value.as_f64())
            .or_else(|| {
                map.get("columnWidths")
                    .and_then(|value| value.as_object())
                    .and_then(|object| object.get("left"))
                    .and_then(|value| value.as_f64())
            })
            .unwrap_or(DEFAULT_FOCUS_PANE_WIDTH);
        map.insert(
            "focusPaneWidth".to_string(),
            number_value(clamp_focus_pane_width(
                focus_pane_width,
                SETTINGS_NORMALIZATION_CONTAINER_WIDTH,
            )),
        );

        let snapshot_persistence = map
            .get("snapshotPersistence")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        map.insert(
            "snapshotPersistence".to_string(),
            Value::Bool(snapshot_persistence),
        );

        let tier = map
            .get("snapshotRedactionTier")
            .and_then(|value| value.as_str())
            .filter(|value| SNAPSHOT_REDACTION_TIERS.contains(value))
            .unwrap_or(DEFAULT_SNAPSHOT_REDACTION_TIER);
        map.insert(
            "snapshotRedactionTier".to_string(),
            Value::String(tier.to_string()),
        );

        // The toolbar's user-defined buttons. Only the shape of each script path is checked here;
        // run_custom_action re-checks existence, because a file can vanish after it was set.
        let actions = normalize_custom_actions(map.get("customActions"));
        map.insert("customActions".to_string(), actions);
        // Superseded by customActions, which normalization above seeds from them. Removed so the
        // file cannot end up describing one button in two places that disagree.
        map.remove("archiveScript");
        map.remove("archiveLabel");
        map.remove("archiveConfirm");

        // Defaults to ON: two copies of this app fight over the same provider profiles and the
        // same settings file, and nobody asked for that by double-clicking a shortcut twice.
        let single_instance = map
            .get("singleInstance")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        map.insert("singleInstance".to_string(), Value::Bool(single_instance));

        let presentation = normalize_presentation_value(map.get("presentation"));
        map.insert("presentation".to_string(), presentation);
    }
    settings
}

/// Reduces a suggested file name to a plain `<stem>.md`. The name arrives from the frontend, and
/// this path is joined onto a directory: a separator or a `..` in it would place the file somewhere
/// nobody asked for.
fn safe_export_name(suggested: &str) -> String {
    let stem: String = suggested
        .trim_end_matches(".md")
        .chars()
        .map(|character| {
            if character.is_control() || r#"\/:*?"<>|"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .take(120)
        .collect();
    let stem = stem.trim_matches(['.', ' ', '-']).to_string();
    if stem.is_empty() {
        "conversation.md".to_string()
    } else {
        format!("{stem}.md")
    }
}

/// Keeps the entries that name an absolute `.ps1` and drops the rest, because an entry whose script
/// cannot run is a toolbar button that can only fail. Captions are capped and stripped of control
/// characters: they land in a toolbar that already has to wrap at narrow widths.
///
/// Both flags default to ON. `passRun` matches the one button this list replaced, and `confirm` is
/// the safer answer for something that starts a child process -- an unasked first click is a worse
/// surprise than one extra dialog.
fn normalize_custom_actions(value: Option<&Value>) -> Value {
    let Some(actions) = value.and_then(|value| value.as_array()) else {
        return Value::Array(Vec::new());
    };

    let normalized = actions
        .iter()
        .enumerate()
        .filter_map(|(index, action)| {
            let action = action.as_object()?;
            let script = action.get("script").and_then(|value| value.as_str())?;
            if !is_archive_script_path(script) {
                return None;
            }
            let text = |key: &str, limit: usize| {
                action
                    .get(key)
                    .and_then(|value| value.as_str())
                    .map(|value| {
                        value
                            .chars()
                            .filter(|character| !character.is_control())
                            .take(limit)
                            .collect::<String>()
                            .trim()
                            .to_string()
                    })
                    .unwrap_or_default()
            };
            let flag = |key: &str| {
                action
                    .get(key)
                    .and_then(|value| value.as_bool())
                    .unwrap_or(true)
            };
            // `passRun` is what the first version of the list stored: true meant the run, false
            // meant nothing at all.
            let payload = action
                .get("payload")
                .and_then(|value| value.as_str())
                .filter(|value| CUSTOM_ACTION_PAYLOADS.contains(value))
                .map(|value| value.to_string())
                .unwrap_or_else(|| {
                    if action.get("passRun").and_then(|value| value.as_bool()) == Some(false) {
                        "none".to_string()
                    } else {
                        "run".to_string()
                    }
                });
            let id = match text("id", ACTION_ID_MAX_CHARS) {
                id if id.is_empty() => format!("action-{index}"),
                id => id,
            };

            let mut entry = Map::new();
            entry.insert("id".to_string(), Value::String(id));
            entry.insert(
                "name".to_string(),
                Value::String(text("name", ARCHIVE_LABEL_MAX_CHARS)),
            );
            entry.insert("script".to_string(), Value::String(script.to_string()));
            entry.insert(
                "note".to_string(),
                Value::String(text("note", ACTION_NOTE_MAX_CHARS)),
            );
            entry.insert("payload".to_string(), Value::String(payload));
            entry.insert("confirm".to_string(), Value::Bool(flag("confirm")));
            Some(Value::Object(entry))
        })
        .collect::<Vec<_>>();

    Value::Array(normalized)
}

/// The script path of one entry of `customActions`, or empty when the id is not in the list.
fn custom_action_script(settings: &Value, action_id: &str) -> String {
    settings
        .get("customActions")
        .and_then(|value| value.as_array())
        .and_then(|actions| {
            actions
                .iter()
                .find(|action| action.get("id").and_then(|value| value.as_str()) == Some(action_id))
        })
        .and_then(|action| action.get("script"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

/// Reads the single-instance preference before Tauri exists. A second process has to decide
/// whether to exit while it is still building its `Builder`, which is before any `AppHandle` -- and
/// therefore before `settings_path` -- is available.
///
/// notes: this re-derives the directory that `settings_path` gets from `app_data_dir()`, so the
///        two can drift. They agree as long as the bundle identifier below matches
///        `tauri.conf.json` and Tauri keeps its platform conventions. An unreadable file means ON,
///        which is the same answer as a fresh install.
/// Read straight from the file rather than from the frontend: the window has to be maximised
/// before it is first painted, which is well before the UI has loaded its settings.
pub fn start_maximized_preference(app: &AppHandle) -> bool {
    settings_path(app)
        .ok()
        .and_then(|path| read_settings(&path).ok())
        .and_then(|settings| {
            settings
                .get("startMaximized")
                .and_then(|value| value.as_bool())
        })
        .unwrap_or(false)
}

pub fn single_instance_preference() -> bool {
    const IDENTIFIER: &str = "tw.micasa.aiconsultant";

    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
    };
    let Some(base) = base else { return true };

    read_settings(&base.join(IDENTIFIER).join("settings.json"))
        .ok()
        .and_then(|settings| {
            settings
                .get("singleInstance")
                .and_then(|value| value.as_bool())
        })
        .unwrap_or(true)
}

/// An absolute path to a `.ps1`. Absolute because the app's working directory is not somewhere the
/// user can reason about, so a relative path would resolve somewhere they did not mean.
fn is_archive_script_path(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
}

fn clamp_focus_pane_width(width: f64, container_width: f64) -> f64 {
    let max_width =
        (container_width - MIN_CONTROL_PANE_WIDTH - RESIZER_WIDTH).max(MIN_FOCUS_PANE_WIDTH);
    width.round().clamp(MIN_FOCUS_PANE_WIDTH, max_width)
}

fn number_value(value: f64) -> Value {
    Value::Number(serde_json::Number::from(value as i64))
}

fn normalize_presentation_value(value: Option<&Value>) -> Value {
    let input = value.and_then(|value| value.as_object());
    let mut map = Map::new();
    let mut center_seen = false;

    for provider in PROVIDERS {
        let candidate = input
            .and_then(|object| object.get(*provider))
            .and_then(|value| value.as_str())
            .filter(|value| PRESENTATION_STATES.contains(value))
            .unwrap_or_else(|| default_presentation(provider));
        let normalized = if candidate == "center" {
            if center_seen {
                "side"
            } else {
                center_seen = true;
                "center"
            }
        } else {
            candidate
        };
        map.insert(
            (*provider).to_string(),
            Value::String(normalized.to_string()),
        );
    }

    Value::Object(map)
}

fn default_presentation(_provider: &str) -> &'static str {
    "side"
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp_path = path.with_file_name(format!(
        "{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("adapter.json"),
        std::process::id(),
        seq
    ));
    if let Err(error) = std::fs::write(&tmp_path, bytes) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error.to_string());
    }
    if let Err(error) = replace_file(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(tmp_path: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let src: Vec<u16> = tmp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let dst: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(src.as_ptr()),
            PCWSTR(dst.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
fn replace_file(tmp_path: &Path, path: &Path) -> Result<(), String> {
    std::fs::rename(tmp_path, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    let mut settings = normalize_settings_value(read_settings(&path)?);
    if let Value::Object(map) = &mut settings {
        map.insert(
            "portable".to_string(),
            Value::Bool(portable_marker_exists()),
        );
    }
    Ok(settings)
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let previous = read_settings(&path).unwrap_or_else(|_| Value::Object(Map::new()));
    let settings = normalize_settings_value(settings);
    write_settings(&path, &settings)?;
    let changed = |key: &str| {
        previous.get(key).and_then(|value| value.as_str())
            != settings.get(key).and_then(|value| value.as_str())
    };
    if changed("adapterBaseUrl") || changed("adapterChannel") {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::adapters::refresh_all_adapters(handle, true).await;
        });
    }
    Ok(())
}

pub(crate) fn adapter_base_url(app: &AppHandle) -> Result<Option<String>, String> {
    let settings = read_settings(&settings_path(app)?)?;
    Ok(settings
        .get("adapterBaseUrl")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

#[tauri::command]
pub async fn export_markdown(
    app: AppHandle,
    webview: tauri::Webview,
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    crate::webviews::ensure_control_webview(&webview)?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Markdown", &["md"]);
    // Opens where the last export went, so both export buttons keep filing into one folder. A
    // default only: the dialog still saves anywhere else that is picked, and that becomes the new
    // remembered folder.
    if let Some(folder) = export_dir(&app) {
        dialog = dialog.set_directory(folder);
    }
    dialog.save_file(move |chosen| {
        let _ = tx.send(chosen);
    });

    match rx.await.map_err(|error| error.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|error| error.to_string())?;
            std::fs::write(&path, content).map_err(|error| error.to_string())?;
            remember_export_dir(&app, &path);
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

// Where exported conversations live: the folder the last export was saved to, or a default under
// Documents on the first run. The folder is created so both the dialog and the markdown handoff
// below can count on it. None only when neither that folder nor Documents can be made.
//
// notes: kept in a sidecar file rather than a settings.json key. settings_set rewrites settings.json
//        wholesale from what the frontend sends and neither normalizer knows this key, so a key put
//        there would be dropped the next time the Settings screen is saved.
fn export_dir(app: &AppHandle) -> Option<PathBuf> {
    let remembered = export_dir_marker(app)
        .and_then(|marker| std::fs::read_to_string(marker).ok())
        .map(|text| PathBuf::from(text.trim()))
        .filter(|path| path.is_dir());
    if remembered.is_some() {
        return remembered;
    }
    let folder = app.path().document_dir().ok()?.join("AI Consultant 匯出");
    std::fs::create_dir_all(&folder).ok()?;
    Some(folder)
}

fn export_dir_marker(app: &AppHandle) -> Option<PathBuf> {
    settings_path(app)
        .ok()
        .map(|path| path.with_file_name("last-export-dir.txt"))
}

fn remember_export_dir(app: &AppHandle, saved_file: &Path) {
    let (Some(marker), Some(folder)) = (export_dir_marker(app), saved_file.parent()) else {
        return;
    };
    // Best effort: failing to remember costs the next dialog its starting folder, nothing more.
    let _ = std::fs::write(marker, folder.to_string_lossy().as_bytes());
}

// Native picker for the archive script, so the path never has to be typed. Returns None when the
// dialog is dismissed. Nothing is saved here -- the caller puts the path in the settings draft, so
// the choice is still discarded if the user closes Settings without saving.
#[tauri::command]
pub async fn pick_archive_script(
    app: AppHandle,
    webview: tauri::Webview,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    crate::webviews::ensure_control_webview(&webview)?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("PowerShell", &["ps1"])
        .pick_file(move |chosen| {
            let _ = tx.send(chosen);
        });

    match rx.await.map_err(|error| error.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|error| error.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

// Run one of the user's toolbar scripts. The path comes from settings, looked up by the action id
// the frontend sends, and is never assembled from anything the app received over the network. The
// snapshot id, when there is one, is the only argument and is checked against the same shape
// snapshot_save enforces for file names.
//
// Reachable from the control pane only (provider webviews are granted no permissions), so the
// pages loaded from chatgpt.com and friends cannot invoke this.
//
// `confirm` carries the already-translated prompt, or None to run straight away. The wording comes
// from the frontend because that is where the i18n table lives; the decision to ask is the
// archiveConfirm setting. Returns Ok(None) when the user answers no.
#[tauri::command]
pub async fn run_custom_action(
    app: AppHandle,
    webview: tauri::Webview,
    action_id: String,
    snapshot_id: Option<String>,
    markdown_name: Option<String>,
    markdown_content: Option<String>,
    confirm: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    crate::webviews::ensure_control_webview(&webview)?;
    if let Some(id) = &snapshot_id {
        crate::snapshots::validate_snapshot_id(id)?;
    }

    let settings = read_settings(&settings_path(&app)?)?;
    let script = custom_action_script(&settings, &action_id);
    if script.is_empty() || !is_archive_script_path(&script) {
        return Err(format!("no script configured for action: {action_id}"));
    }
    if !Path::new(&script).is_file() {
        return Err(format!("script not found: {script}"));
    }

    // Asked after the checks, so a misconfigured path fails with the real reason instead of making
    // the user approve a run that was never going to start.
    if let Some(message) = confirm {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog()
            .message(message)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .show(move |approved| {
                let _ = tx.send(approved);
            });
        if !rx.await.map_err(|error| error.to_string())? {
            return Ok(None);
        }
    }

    // Written before the script starts and left there: the script hands the file to whatever the
    // user opens .md with, and deleting it out from under that program is how you get an empty
    // window.
    //
    // It goes to the export folder, not to temp: the file name is keyed to the conversation, so
    // pressing this twice rewrites one file in the same place the "export .md" dialog saves to,
    // rather than scattering a fresh copy through a directory that is swept behind your back.
    // Rewritten rather than skipped when it is already there -- a conversation that has grown since
    // the last press should open showing what it says now.
    let markdown_path = match (markdown_name, markdown_content) {
        (Some(name), Some(content)) => {
            let folder = export_dir(&app).unwrap_or_else(std::env::temp_dir);
            let path = folder.join(safe_export_name(&name));
            std::fs::write(&path, content).map_err(|error| error.to_string())?;
            Some(path.to_string_lossy().into_owned())
        }
        _ => None,
    };

    let output = tauri::async_runtime::spawn_blocking(move || {
        run_in_powershell(&script, snapshot_id.as_deref(), markdown_path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;

    // The script's own last words, not a generic "failed" -- when an unattended-looking button goes
    // wrong the reason has to reach the user, and stderr is where PowerShell puts it.
    //
    // UTF-8 or nothing. A script whose stdout is redirected with no console attached gets encoded in
    // the system ANSI codepage unless it says otherwise, and lossy-decoding that paints the notice
    // with replacement characters. Empty instead: the caller then falls back to the snapshot id,
    // which at least names the run.
    let tail = |bytes: &[u8]| {
        std::str::from_utf8(bytes)
            .unwrap_or("")
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    if output.status.success() {
        Ok(Some(tail(&output.stdout)))
    } else {
        let reason = tail(&output.stderr);
        let reason = if reason.is_empty() {
            tail(&output.stdout)
        } else {
            reason
        };
        Err(format!(
            "exit {}: {reason}",
            output.status.code().unwrap_or(-1)
        ))
    }
}

/// pwsh (PowerShell 7) first, powershell.exe only if it is missing.
///
/// Windows PowerShell 5.1 decodes a `.ps1` that carries no UTF-8 BOM using the ANSI codepage, so a
/// script holding any non-ASCII -- a path, a message -- arrives as mojibake and normally dies as a
/// parser error rather than anything that names encoding. pwsh reads UTF-8 whether or not there is a
/// BOM. Preferring it means the user's script does not have to be saved a particular way.
#[cfg(windows)]
fn run_in_powershell(
    script: &str,
    snapshot_id: Option<&str>,
    markdown_path: Option<&str>,
) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut missing = None;
    for shell in ["pwsh.exe", "powershell.exe"] {
        let mut command = std::process::Command::new(shell);
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
        ]);
        // Omitted, not passed empty: a script that declares no -SnapshotId parameter fails on an
        // unknown argument, and one that does declare it can then default it itself.
        if let Some(id) = snapshot_id {
            command.args(["-SnapshotId", id]);
        }
        if let Some(path) = markdown_path {
            command.args(["-MarkdownPath", path]);
        }
        let attempt = command
            // Without this a console window flashes up on every click.
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        match attempt {
            // Only "this shell is not installed" is worth falling through on. A script that ran and
            // failed is an answer, and retrying it in the other shell would run it twice.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing = Some(error),
            settled => return settled,
        }
    }
    Err(missing.expect("loop records the last NotFound before falling through"))
}

// notes: pwsh only off Windows -- Windows PowerShell does not exist there. Untested; this build
//        target has no user for the feature yet. Drop the arm if that stays true.
#[cfg(not(windows))]
fn run_in_powershell(
    script: &str,
    snapshot_id: Option<&str>,
    markdown_path: Option<&str>,
) -> std::io::Result<std::process::Output> {
    let mut command = std::process::Command::new("pwsh");
    command.args(["-NoProfile", "-NonInteractive", "-File", script]);
    if let Some(id) = snapshot_id {
        command.args(["-SnapshotId", id]);
    }
    if let Some(path) = markdown_path {
        command.args(["-MarkdownPath", path]);
    }
    command.output()
}

// Open an external URL in the OS default browser from the control pane. Tauri does not route
// `<a target="_blank">` clicks to the OS browser, so the frontend calls this instead. https-only.
#[tauri::command]
pub async fn open_external_url(
    app: AppHandle,
    webview: tauri::Webview,
    url: String,
) -> Result<(), String> {
    crate::webviews::ensure_control_webview(&webview)?;
    if !url.starts_with("https://") {
        return Err("only https URLs may be opened".to_string());
    }
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// The self-update swap for portable builds, as a script rather than in-process work: the files it
/// replaces include this very exe, so whoever does the copying cannot be this process.
///
/// Windows PowerShell 5.1 is the floor, so no `-UseBasicParsing` extras and no Zip64 concerns --
/// `Expand-Archive` ships from 5.0 on. ASCII only: a `.ps1` with no BOM is decoded in the ANSI
/// codepage by 5.1, so anything non-ASCII here would arrive as mojibake.
///
/// The folder it writes into is wherever this exe already lives, whatever it is called -- a user
/// who unpacked the zip into a version-named folder keeps that name and gets the new build inside
/// it.
///
/// notes: copy-over, not sync. A file the old build had and the new one dropped stays behind. Every
///        release so far ships the same file list, so nothing is stranded yet; mirror the folder
///        (or delete what the manifest no longer names) the first time a release removes a file.
#[cfg(windows)]
const PORTABLE_UPDATE_SCRIPT: &str = r#"param([int]$AppPid, [string]$Url, [string]$Dest, [string]$Exe)
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest on 5.1 spends most of a download repainting its progress bar.
$ProgressPreference = 'SilentlyContinue'
$log = Join-Path $Dest 'update-log.txt'
$app = Join-Path $Dest $Exe
function Write-Step($message) {
  "{0} {1}" -f (Get-Date -Format s), $message | Add-Content -LiteralPath $log -Encoding UTF8
}
try {
  Write-Step "waiting for pid $AppPid to exit"
  try { Wait-Process -Id $AppPid -Timeout 120 } catch {}
  $work = Join-Path $env:TEMP "ai-consultant-update-$AppPid"
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
  New-Item -ItemType Directory -Path $work | Out-Null
  $zip = Join-Path $work 'update.zip'
  Write-Step "downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $zip
  $unpacked = Join-Path $work 'unpacked'
  Write-Step "extracting"
  Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
  # The zip carries one top-level folder; tolerate a flat one in case that ever changes.
  $source = $unpacked
  if (-not (Test-Path -LiteralPath (Join-Path $source $Exe))) {
    $inner = Get-ChildItem -LiteralPath $source -Directory | Select-Object -First 1
    if ($inner) { $source = $inner.FullName }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $source $Exe))) { throw "$Exe is not in the downloaded package" }
  Write-Step "copying into $Dest"
  Copy-Item -Path (Join-Path $source '*') -Destination $Dest -Recurse -Force
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Step "done"
  Start-Process -FilePath $app
} catch {
  # The app is already gone by now, so a silent failure would look like the update worked. Put the
  # old build back and push the log in the user's face.
  Write-Step ("failed: " + $_.Exception.Message)
  Start-Process -FilePath $app
  Start-Process -FilePath notepad.exe -ArgumentList $log
}
"#;

/// Release assets only. The URL reaches us from the GitHub API response, but this is what the app
/// is about to download and run as itself, so it gets checked here rather than trusted.
fn is_release_asset_url(url: &str) -> bool {
    url.starts_with("https://github.com/") && url.contains("/releases/download/")
}

/// Download the portable zip, unpack it over this folder, and come back up on the new build.
/// Returns only on refusal -- on success the app exits and the script takes over.
#[tauri::command]
pub async fn portable_update_start(
    app: AppHandle,
    webview: tauri::Webview,
    url: String,
    confirm: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    crate::webviews::ensure_control_webview(&webview)?;
    if !portable_marker_exists() {
        return Err("this build is not portable".to_string());
    }
    if !is_release_asset_url(&url) {
        return Err("only a GitHub release asset may be installed".to_string());
    }

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let dest = exe
        .parent()
        .ok_or("cannot resolve the app folder")?
        .to_path_buf();
    let exe_name = exe
        .file_name()
        .ok_or("cannot resolve the app executable")?
        .to_string_lossy()
        .into_owned();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(confirm)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |approved| {
            let _ = tx.send(approved);
        });
    if !rx.await.map_err(|error| error.to_string())? {
        return Ok(());
    }

    start_portable_update(&url, &dest, &exe_name)?;
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn start_portable_update(url: &str, dest: &Path, exe_name: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let script =
        std::env::temp_dir().join(format!("ai-consultant-update-{}.ps1", std::process::id()));
    std::fs::write(&script, PORTABLE_UPDATE_SCRIPT).map_err(|error| error.to_string())?;

    let mut missing = None;
    for shell in ["pwsh.exe", "powershell.exe"] {
        let attempt = std::process::Command::new(shell)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .args(["-AppPid", &std::process::id().to_string()])
            .args(["-Url", url])
            .arg("-Dest")
            .arg(dest)
            .args(["-Exe", exe_name])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
        match attempt {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing = Some(error),
            Err(error) => return Err(error.to_string()),
            Ok(_) => return Ok(()),
        }
    }
    Err(missing
        .expect("loop records the last NotFound before falling through")
        .to_string())
}

// notes: Windows-only. The portable zip is a Windows artifact; the mac/linux lanes ship a DMG and
//        an AppImage, which update through their own installers.
#[cfg(not(windows))]
fn start_portable_update(_url: &str, _dest: &Path, _exe_name: &str) -> Result<(), String> {
    Err("the portable updater runs on Windows only".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_stamp_from_json, is_release_asset_url, normalize_settings_value, read_settings,
        write_settings, ARCHIVE_LABEL_MAX_CHARS,
    };
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn build_stamp_is_read_only_from_a_describe_that_says_something() {
        assert_eq!(
            build_stamp_from_json(r#"{"describe":"v0.0.5-1-g951ebd5"}"#),
            Some("v0.0.5-1-g951ebd5".to_string())
        );
        assert_eq!(build_stamp_from_json(r#"{"describe":"  "}"#), None);
        assert_eq!(build_stamp_from_json(r#"{"commit":"abc"}"#), None);
        assert_eq!(build_stamp_from_json("not json"), None);
    }

    fn unique_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-consultant-settings-{}-{}-{}.json",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::SeqCst),
            name
        ))
    }

    #[test]
    fn write_then_read_round_trips_non_trivial_blob() {
        let path = unique_path("roundtrip");
        let blob = json!({
            "adapterBaseUrl": "https://example.test/adapters",
            "columnWidths": { "left": 280, "right": 340 },
            "slotAssignment": ["chatgpt", "claude", "gemini", "grok"],
            "portable": true
        });

        write_settings(&path, &blob).expect("write settings");
        let read = read_settings(&path).expect("read settings");

        assert_eq!(
            read,
            json!({
                "adapterBaseUrl": "https://example.test/adapters",
                "columnWidths": { "left": 280, "right": 340 },
                "slotAssignment": ["chatgpt", "claude", "gemini", "grok"]
            })
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_file_reads_as_empty_object() {
        let path = unique_path("missing");

        assert_eq!(
            read_settings(&path).expect("read missing settings"),
            json!({})
        );
    }

    #[test]
    fn atomic_write_removes_tmp_and_overwrites_cleanly() {
        let path = unique_path("overwrite");

        write_settings(&path, &json!({ "value": 1 })).expect("first write");
        write_settings(&path, &json!({ "value": 2 })).expect("second write");

        assert_eq!(
            read_settings(&path).expect("read overwritten settings"),
            json!({ "value": 2 })
        );

        // No leftover temp file for this target. write_atomic uses a unique
        // `<name>.<pid>.<seq>.tmp` scheme, so scan for any `.tmp` sibling of this base
        // rather than a fixed name (robust to the temp-naming scheme).
        let base = path.file_name().and_then(|name| name.to_str()).unwrap();
        let dir = path.parent().expect("temp parent");
        let leftover: Vec<_> = std::fs::read_dir(dir)
            .expect("read temp dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(base) && name.ends_with(".tmp"))
            })
            .map(|entry| entry.path())
            .collect();
        assert!(leftover.is_empty(), "temp files left behind: {leftover:?}");

        let _ = std::fs::remove_file(path);
    }

    // Each entry hands its path to a child process, so anything but an absolute .ps1 has to be
    // dropped at normalization -- a relative path resolves against the app's cwd, which is not
    // anywhere the user chose, and a non-.ps1 means the field was filled in by mistake. A dropped
    // entry is better than a toolbar button that can only fail.
    #[test]
    fn custom_actions_keep_only_absolute_ps1_paths() {
        let script = if cfg!(windows) {
            "C:\\Users\\me\\archive.ps1"
        } else {
            "/home/me/archive.ps1"
        };
        let actions = |value: Value| {
            normalize_settings_value(json!({ "customActions": value }))
                .get("customActions")
                .unwrap()
                .as_array()
                .unwrap()
                .clone()
        };

        let kept = actions(json!([{ "id": "a", "script": script }]));
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].get("script").unwrap(), script);
        // Defaults: the run, because that is what the one button this list replaced always passed,
        // and confirm ON, because the entry starts a child process.
        assert_eq!(kept[0].get("payload").unwrap(), "run");
        assert_eq!(kept[0].get("confirm").unwrap(), true);

        for rejected in [
            "archive.ps1",           // relative
            "..\\archive.ps1",       // relative, climbing
            "C:\\tools\\archive.js", // not a script we run
            "C:\\tools\\archive",    // no extension
            "",
        ] {
            let dropped = actions(json!([{ "id": "a", "script": rejected }]));
            assert!(dropped.is_empty(), "should have been rejected: {rejected}");
        }
    }

    // The caption goes straight into the toolbar, so a pasted paragraph or a newline would either
    // break the row or smuggle a line break into a flex item.
    #[test]
    fn custom_action_name_is_trimmed_stripped_of_control_chars_and_capped() {
        let script = if cfg!(windows) {
            "C:\\Users\\me\\archive.ps1"
        } else {
            "/home/me/archive.ps1"
        };
        let name = |value: &str| {
            normalize_settings_value(json!({
                "customActions": [{ "id": "a", "script": script, "name": value }]
            }))
            .get("customActions")
            .unwrap()[0]
                .get("name")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            name("  \u{5b58}\u{5230} Obsidian  "),
            "\u{5b58}\u{5230} Obsidian"
        );
        assert_eq!(
            name("\u{5b58}\u{5230}\nObsidian"),
            "\u{5b58}\u{5230}Obsidian"
        );
        assert_eq!(name(&"x".repeat(40)), "x".repeat(ARCHIVE_LABEL_MAX_CHARS));
        assert_eq!(name(""), "");
    }

    // A settings.json written before the list still describes a button the user configured, so it
    // is carried over rather than dropped on the floor.
    #[test]
    fn legacy_archive_fields_are_dropped_from_the_saved_settings() {
        let script = if cfg!(windows) {
            "C:\\Users\\me\\archive.ps1"
        } else {
            "/home/me/archive.ps1"
        };
        let normalized = normalize_settings_value(json!({
            "archiveScript": script,
            "archiveLabel": "Archive",
            "archiveConfirm": false,
        }));
        assert!(normalized.get("archiveScript").is_none());
        assert!(normalized.get("archiveLabel").is_none());
        assert!(normalized.get("archiveConfirm").is_none());
    }

    #[test]
    fn normalizes_snapshot_settings_to_opt_in_safe_defaults() {
        assert_eq!(
            normalize_settings_value(json!({})),
            json!({
                "language": "system",
                "responseLanguage": "auto",
                "layoutMode": "focus",
                "focusPaneWidth": 620,
                "snapshotPersistence": false,
                "snapshotRedactionTier": "metadata-only",
                "customActions": [],
                "singleInstance": true,
                "presentation": {
                    "chatgpt": "side",
                    "claude": "side",
                    "gemini": "side",
                    "grok": "side"
                }
            })
        );
        assert_eq!(
            normalize_settings_value(json!({
                "snapshotPersistence": true,
                "snapshotRedactionTier": "full-local",
                "customActions": [],
                "presentation": {
                    "chatgpt": "chip",
                    "claude": "center",
                    "gemini": "side",
                    "grok": "side"
                }
            })),
            json!({
                "language": "system",
                "responseLanguage": "auto",
                "layoutMode": "focus",
                "focusPaneWidth": 620,
                "snapshotPersistence": true,
                "snapshotRedactionTier": "full-local",
                "customActions": [],
                "singleInstance": true,
                "presentation": {
                    "chatgpt": "chip",
                    "claude": "center",
                    "gemini": "side",
                    "grok": "side"
                }
            })
        );
        assert_eq!(
            normalize_settings_value(json!({
                "snapshotPersistence": "true",
                "snapshotRedactionTier": "unknown",
                "presentation": {
                    "chatgpt": "center",
                    "claude": "center",
                    "gemini": "bad",
                    "removed-provider": "bad",
                    "unknown": "chip"
                }
            })),
            json!({
                "language": "system",
                "responseLanguage": "auto",
                "layoutMode": "focus",
                "focusPaneWidth": 620,
                "snapshotPersistence": false,
                "snapshotRedactionTier": "metadata-only",
                "customActions": [],
                "singleInstance": true,
                "presentation": {
                    "chatgpt": "center",
                    "claude": "side",
                    "gemini": "side",
                    "grok": "side"
                }
            })
        );
    }

    #[test]
    fn normalizes_language_setting_to_supported_values() {
        assert_eq!(
            normalize_settings_value(json!({ "language": "en" })).get("language"),
            Some(&json!("en"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "language": "zh-TW" })).get("language"),
            Some(&json!("zh-TW"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "language": "ja" })).get("language"),
            Some(&json!("ja"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "language": "de" })).get("language"),
            Some(&json!("de"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "language": "fr" })).get("language"),
            Some(&json!("system"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "language": 123 })).get("language"),
            Some(&json!("system"))
        );
    }

    #[test]
    fn normalizes_response_language_setting_to_supported_values() {
        for language in ["auto", "en", "zh-TW", "ja", "de"] {
            assert_eq!(
                normalize_settings_value(json!({ "responseLanguage": language }))
                    .get("responseLanguage"),
                Some(&json!(language))
            );
        }
        assert_eq!(
            normalize_settings_value(json!({ "responseLanguage": "fr" })).get("responseLanguage"),
            Some(&json!("auto"))
        );
        assert_eq!(
            normalize_settings_value(json!({ "responseLanguage": 123 })).get("responseLanguage"),
            Some(&json!("auto"))
        );
    }

    #[test]
    fn normalizes_focus_layout_settings_and_migrates_legacy_width() {
        let normalized = normalize_settings_value(json!({
            "layoutMode": "quadrant",
            "focusPaneWidth": 700
        }));
        assert_eq!(normalized.get("layoutMode"), Some(&json!("focus")));
        assert_eq!(normalized.get("focusPaneWidth"), Some(&json!(700)));

        assert_eq!(
            normalize_settings_value(json!({ "focusPaneWidth": 250 })).get("focusPaneWidth"),
            Some(&json!(420))
        );
        assert_eq!(
            normalize_settings_value(json!({ "columnWidths": { "left": 500, "right": 320 } }))
                .get("focusPaneWidth"),
            Some(&json!(500))
        );
        assert_eq!(
            normalize_settings_value(
                json!({ "focusPaneWidth": "wide", "columnWidths": { "left": 1200 } })
            )
            .get("focusPaneWidth"),
            Some(&json!(874))
        );
    }

    /// The updater downloads this URL and runs what comes out of it as the app itself, so anything
    /// that is not a release asset on github.com has to be refused, redirects included.
    #[test]
    fn only_github_release_assets_may_be_installed() {
        assert!(is_release_asset_url(
            "https://github.com/DaveTseng2019/AI-Consultant/releases/download/v0.0.12/ai-consultant-0.0.12-windows-portable.zip"
        ));
        assert!(!is_release_asset_url(
            "http://github.com/DaveTseng2019/AI-Consultant/releases/download/v0.0.12/x.zip"
        ));
        assert!(!is_release_asset_url(
            "https://github.com.evil.example/releases/download/v1/x.zip"
        ));
        assert!(!is_release_asset_url(
            "https://example.com/releases/download/v1/x.zip"
        ));
        assert!(!is_release_asset_url(
            "https://github.com/DaveTseng2019/AI-Consultant/raw/main/x.zip"
        ));
    }
}

mod adapters;
mod bridge;
mod session_checkpoint;
mod settings;
mod snapshots;
mod webviews;

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Registered only when the preference asks for it, because the plugin's whole job is to end
    // the second process -- once it is in, there is no later point at which to change our mind.
    // The callback runs in the FIRST instance: raise the window that is already there, so a second
    // double-click reads as "here it is" rather than as nothing happening at all.
    if settings::single_instance_preference() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The feature-frozen edition intentionally uses GitHub Releases instead of a self-updater.
        .setup(|app| {
            // Hot-update: refresh adapters at startup and every 6h (best-effort, off the UI thread).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                adapters::refresh_all_adapters(handle.clone(), false).await;
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
                interval.tick().await; // consume the immediate first tick (startup run already done)
                loop {
                    interval.tick().await;
                    adapters::refresh_all_adapters(handle.clone(), false).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            webviews::provider_open,
            webviews::provider_close,
            webviews::provider_show,
            webviews::provider_hide,
            webviews::provider_set_bounds,
            webviews::provider_eval,
            webviews::provider_eval_with_callback,
            webviews::provider_open_login,
            webviews::provider_open_login_external,
            webviews::provider_reload,
            webviews::provider_new_session,
            webviews::connections_get,
            webviews::dev_log,
            adapters::adapter_push,
            adapters::report_broken,
            adapters::open_adapter_issue,
            settings::app_version_label,
            settings::settings_get,
            settings::settings_set,
            settings::export_markdown,
            settings::run_custom_action,
            settings::pick_archive_script,
            settings::open_external_url,
            settings::portable_update_start,
            snapshots::snapshot_save,
            snapshots::snapshot_list,
            snapshots::snapshot_load,
            snapshots::snapshot_delete,
            session_checkpoint::session_checkpoint_save,
            session_checkpoint::session_checkpoint_load,
            session_checkpoint::session_checkpoint_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

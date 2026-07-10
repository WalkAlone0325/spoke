pub mod commands;
pub mod ssh;

use tauri::Manager;
use ssh::SessionManager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,russh=warn")),
        )
        .try_init()
        .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, _event| {
            let accel = format!("{}", shortcut);
            if accel == "CommandOrControl+Shift+T" {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }).build())
        .setup(|app| {
            app.global_shortcut().register("CommandOrControl+Shift+T")?;
            Ok(())
        })
        .manage(SessionManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::terminal::ssh_test_connect,
            commands::terminal::ssh_connect,
            commands::terminal::ssh_send_data,
            commands::terminal::ssh_resize,
            commands::terminal::ssh_disconnect,
            commands::filesystem::sftp_list,
            commands::filesystem::sftp_home,
            commands::filesystem::sftp_stat,
            commands::filesystem::sftp_mkdir,
            commands::filesystem::sftp_remove,
            commands::filesystem::sftp_rename,
            commands::filesystem::sftp_upload,
            commands::filesystem::sftp_upload_dir,
            commands::filesystem::sftp_download,
            commands::filesystem::local_list,
            commands::filesystem::local_home,
            commands::filesystem::local_is_dir,
            commands::filesystem::local_stat,
            commands::filesystem::edit_temp_path,
            commands::filesystem::edit_open_file,
            commands::filesystem::sftp_cancel_transfer,
            commands::secrets::secret_save,
            commands::secrets::secret_get,
            commands::secrets::secret_delete,
            commands::ssh_config::import_ssh_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

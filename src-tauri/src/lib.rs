pub mod commands;
pub mod ssh;

use ssh::SessionManager;

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
        .manage(SessionManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::terminal::ssh_test_connect,
            commands::terminal::ssh_connect,
            commands::terminal::ssh_send_data,
            commands::terminal::ssh_resize,
            commands::terminal::ssh_disconnect,
            commands::filesystem::sftp_list,
            commands::filesystem::sftp_home,
            commands::filesystem::sftp_mkdir,
            commands::filesystem::sftp_remove,
            commands::filesystem::sftp_rename,
            commands::filesystem::sftp_upload,
            commands::filesystem::sftp_download,
            commands::filesystem::local_list,
            commands::filesystem::local_home,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

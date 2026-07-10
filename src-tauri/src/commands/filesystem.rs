use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::fs::File as TokioFile;
use tokio::io::{AsyncWriteExt, BufReader};

use crate::ssh::{RemoteEntry, SessionId, SessionManager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub kind: LocalEntryKind,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalEntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub transferred: u64,
    pub total: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPayload {
    pub session_id: SessionId,
    pub local_path: String,
    pub remote_path: String,
    pub transfer_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPayload {
    pub session_id: SessionId,
    pub remote_path: String,
    pub local_path: String,
    pub transfer_id: String,
}

#[tauri::command]
pub async fn sftp_list(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.list(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_home(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
) -> Result<String, String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.canonicalize(".").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    path: String,
) -> Result<(), String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.make_dir(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_remove(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    path: String,
) -> Result<(), String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.remove(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    from: String,
    to: String,
) -> Result<(), String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.rename(&from, &to).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    payload: UploadPayload,
) -> Result<u64, String> {
    let sftp = manager
        .sftp(&payload.session_id)
        .await
        .map_err(|e| e.to_string())?;
    let file = TokioFile::open(&payload.local_path)
        .await
        .map_err(|e| format!("打开本地失败: {e}"))?;
    let total_size = file
        .metadata()
        .await
        .ok()
        .map(|m| m.len());
    let reader = BufReader::new(file);
    let transfer_id = payload.transfer_id.clone();
    let app_handle = app.clone();
    let emitted = AtomicU64::new(0);
    let n = sftp
        .upload(&payload.remote_path, reader, |transferred| {
            let last = emitted.load(Ordering::Relaxed);
            if transferred - last >= 64 * 1024 || transferred == total_size.unwrap_or(0) {
                emitted.store(transferred, Ordering::Relaxed);
                let _ = app_handle.emit(
                    "sftp://progress",
                    TransferProgress {
                        transfer_id: transfer_id.clone(),
                        transferred,
                        total: total_size,
                    },
                );
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit(
        "sftp://progress",
        TransferProgress {
            transfer_id: payload.transfer_id,
            transferred: n,
            total: total_size,
        },
    );
    Ok(n)
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    payload: DownloadPayload,
) -> Result<u64, String> {
    let sftp = manager
        .sftp(&payload.session_id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(parent) = PathBuf::from(&payload.local_path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
    }
    let mut file = TokioFile::create(&payload.local_path)
        .await
        .map_err(|e| format!("创建本地失败: {e}"))?;
    let transfer_id = payload.transfer_id.clone();
    let app_handle = app.clone();
    let last_emit = AtomicU64::new(0);
    let total = sftp
        .download(&payload.remote_path, &mut file, |written| {
            let last = last_emit.load(Ordering::Relaxed);
            if written - last >= 64 * 1024 {
                last_emit.store(written, Ordering::Relaxed);
                let _ = app_handle.emit(
                    "sftp://progress",
                    TransferProgress {
                        transfer_id: transfer_id.clone(),
                        transferred: written,
                        total: None,
                    },
                );
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    file.flush()
        .await
        .map_err(|e| format!("刷新本地失败: {e}"))?;
    let _ = app.emit(
        "sftp://progress",
        TransferProgress {
            transfer_id: payload.transfer_id,
            transferred: total,
            total: Some(total),
        },
    );
    Ok(total)
}

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<LocalEntry>, String> {
    let resolved: PathBuf = if path == "~" || path.is_empty() {
        dirs_local()
    } else {
        PathBuf::from(&path)
    };
    let mut rd = tokio::fs::read_dir(&resolved)
        .await
        .map_err(|e| format!("读取本地目录失败: {e}"))?;
    let mut items = Vec::new();
    while let Some(entry) = rd.next_entry().await.map_err(|e| e.to_string())? {
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let ft = entry.file_type().await.map_err(|e| e.to_string())?;
        let kind = if ft.is_dir() {
            LocalEntryKind::Dir
        } else if ft.is_symlink() {
            LocalEntryKind::Symlink
        } else if ft.is_file() {
            LocalEntryKind::File
        } else {
            LocalEntryKind::Other
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        items.push(LocalEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            kind,
            size: meta.len(),
            modified,
        });
    }
    items.sort_by(|a, b| match (&a.kind, &b.kind) {
        (LocalEntryKind::Dir, LocalEntryKind::Dir) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        (LocalEntryKind::Dir, _) => std::cmp::Ordering::Less,
        (_, LocalEntryKind::Dir) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

#[tauri::command]
pub fn local_home() -> Result<String, String> {
    Ok(dirs_local().to_string_lossy().to_string())
}

fn dirs_local() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home);
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(profile);
    }
    PathBuf::from("/")
}

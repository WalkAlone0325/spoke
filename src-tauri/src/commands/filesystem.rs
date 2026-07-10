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
pub struct UploadDirPayload {
    pub session_id: SessionId,
    pub local_dir: String,
    pub remote_dir: String,
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
pub async fn sftp_stat(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    path: String,
) -> Result<crate::ssh::RemoteEntry, String> {
    let sftp = manager.sftp(&session_id).await.map_err(|e| e.to_string())?;
    sftp.stat(&path).await.map_err(|e| e.to_string())
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
    let cancel = manager.register_transfer(transfer_id.clone()).await;
    let result = sftp
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
        }, cancel)
        .await;
    manager.remove_transfer(&transfer_id).await;
    let n = result.map_err(|e| e.to_string())?;
    let _ = app.emit(
        "sftp://progress",
        TransferProgress {
            transfer_id,
            transferred: n,
            total: total_size,
        },
    );
    Ok(n)
}

#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    payload: UploadDirPayload,
) -> Result<u64, String> {
    let sftp = manager
        .sftp(&payload.session_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut total_size: u64 = 0;
    collect_dir(
        &PathBuf::from(&payload.local_dir),
        &payload.remote_dir,
        &mut files,
        &mut dirs,
        &mut total_size,
    )
    .await
    .map_err(|e| format!("扫描本地目录失败: {e}"))?;

    for dir in &dirs {
        sftp.ensure_dir(dir).await.map_err(|e| e.to_string())?;
    }

    let transfer_id = payload.transfer_id.clone();
    let app_handle = app.clone();
    let emitted = AtomicU64::new(0);
    let mut transferred: u64 = 0;
    let cancel = manager.register_transfer(transfer_id.clone()).await;

    let result = async {
        for (local, remote) in &files {
            let file = TokioFile::open(local)
                .await
                .map_err(|e| format!("打开 {}: {e}", local.display()))?;
            let reader = BufReader::new(file);
            let start = transferred;
            let n = sftp
                .upload(remote, reader, |cur| {
                    let total_now = start + cur;
                    let last = emitted.load(Ordering::Relaxed);
                    if total_now - last >= 64 * 1024 {
                        emitted.store(total_now, Ordering::Relaxed);
                        let _ = app_handle.emit(
                            "sftp://progress",
                            TransferProgress {
                                transfer_id: transfer_id.clone(),
                                transferred: total_now,
                                total: Some(total_size),
                            },
                        );
                    }
                }, cancel.clone())
                .await
                .map_err(|e| e.to_string())?;
            transferred += n;
        }
        Ok::<u64, String>(transferred)
    }.await;

    manager.remove_transfer(&transfer_id).await;
    let transferred = result?;
    let _ = app.emit(
        "sftp://progress",
        TransferProgress {
            transfer_id: payload.transfer_id,
            transferred,
            total: Some(total_size.max(transferred)),
        },
    );
    Ok(transferred)
}

async fn collect_dir(
    local: &PathBuf,
    remote: &str,
    files: &mut Vec<(PathBuf, String)>,
    dirs: &mut Vec<String>,
    total_size: &mut u64,
) -> std::io::Result<()> {
    dirs.push(remote.to_string());
    let mut rd = tokio::fs::read_dir(local).await?;
    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    while let Some(entry) = rd.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        let child_local = entry.path();
        let child_remote = if remote.ends_with('/') {
            format!("{remote}{name}")
        } else {
            format!("{remote}/{name}")
        };
        let ft = entry.file_type().await?;
        if ft.is_dir() {
            subdirs.push((child_local, child_remote));
        } else if ft.is_file() {
            let meta = entry.metadata().await?;
            *total_size += meta.len();
            files.push((child_local, child_remote));
        }
    }
    for (l, r) in subdirs {
        Box::pin(collect_dir(&l, &r, files, dirs, total_size)).await?;
    }
    Ok(())
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
    let cancel = manager.register_transfer(transfer_id.clone()).await;
    let result = sftp
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
        }, cancel)
        .await;
    manager.remove_transfer(&transfer_id).await;
    let total = result.map_err(|e| e.to_string())?;
    file.flush()
        .await
        .map_err(|e| format!("刷新本地失败: {e}"))?;
    let _ = app.emit(
        "sftp://progress",
        TransferProgress {
            transfer_id,
            transferred: total,
            total: Some(total),
        },
    );
    Ok(total)
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    manager: State<'_, SessionManager>,
    transfer_id: String,
) -> Result<bool, String> {
    Ok(manager.cancel_transfer(&transfer_id).await)
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

#[tauri::command]
pub async fn local_is_dir(path: String) -> Result<bool, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(meta.is_dir())
}

#[tauri::command]
pub fn edit_temp_path(filename: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("spoke-edit");
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.join(filename).to_string_lossy().to_string())
}

#[tauri::command]
pub fn edit_open_file(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("打开文件失败: {e}"))
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<Option<LocalEntry>, String> {
    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    Ok(Some(LocalEntry {
        name: path.rsplit('/').next().unwrap_or(&path).to_string(),
        path,
        kind: if meta.is_dir() { LocalEntryKind::Dir } else if meta.is_symlink() { LocalEntryKind::Symlink } else { LocalEntryKind::File },
        size: meta.len(),
        modified,
    }))
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

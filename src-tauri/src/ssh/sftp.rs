use std::sync::Arc;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use super::{SshError, SshResult, SshSession};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

pub struct SftpClient {
    inner: Arc<Mutex<SftpSession>>,
}

impl SftpClient {
    pub async fn from_session(session: &SshSession) -> SshResult<Self> {
        let handle = session.handle();
        let guard = handle.lock().await;
        let channel = guard
            .channel_open_session()
            .await
            .map_err(SshError::Russh)?;
        drop(guard);
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(SshError::Russh)?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| SshError::Msg(format!("初始化 SFTP 失败: {e}")))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(sftp)),
        })
    }

    pub async fn list(&self, path: &str) -> SshResult<Vec<RemoteEntry>> {
        let guard = self.inner.lock().await;
        let read_dir = guard
            .read_dir(path.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("读取目录失败: {e}")))?;
        let mut items = Vec::new();
        for entry in read_dir {
            let meta = entry.metadata();
            let kind = if meta.is_dir() {
                EntryKind::Dir
            } else if meta.is_symlink() {
                EntryKind::Symlink
            } else if meta.is_regular() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let full = join_path(path, &entry.file_name());
            items.push(RemoteEntry {
                name: entry.file_name(),
                path: full,
                kind,
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.map(|t| t as i64),
                permissions: meta.permissions,
                is_symlink: meta.is_symlink(),
            });
        }
        items.sort_by(|a, b| match (a.kind, b.kind) {
            (EntryKind::Dir, EntryKind::Dir) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            (EntryKind::Dir, _) => std::cmp::Ordering::Less,
            (_, EntryKind::Dir) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(items)
    }

    pub async fn canonicalize(&self, path: &str) -> SshResult<String> {
        let guard = self.inner.lock().await;
        guard
            .canonicalize(path.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("解析路径失败: {e}")))
    }

    pub async fn stat(&self, path: &str) -> SshResult<RemoteEntry> {
        let guard = self.inner.lock().await;
        let meta = guard
            .metadata(path.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("查询元数据失败: {e}")))?;
        let kind = if meta.is_dir() {
            EntryKind::Dir
        } else if meta.is_symlink() {
            EntryKind::Symlink
        } else if meta.is_regular() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        let name = path
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(path)
            .to_string();
        Ok(RemoteEntry {
            name,
            path: path.to_string(),
            kind,
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|t| t as i64),
            permissions: meta.permissions,
            is_symlink: meta.is_symlink(),
        })
    }

    pub async fn make_dir(&self, path: &str) -> SshResult<()> {
        let guard = self.inner.lock().await;
        guard
            .create_dir(path.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("创建目录失败: {e}")))
    }

    pub async fn remove(&self, path: &str) -> SshResult<()> {
        let guard = self.inner.lock().await;
        let meta = guard
            .metadata(path.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("查询元数据失败: {e}")))?;
        if meta.is_dir() {
            guard
                .remove_dir(path.to_string())
                .await
                .map_err(|e| SshError::Msg(format!("删除目录失败: {e}")))
        } else {
            guard
                .remove_file(path.to_string())
                .await
                .map_err(|e| SshError::Msg(format!("删除文件失败: {e}")))
        }
    }

    pub async fn rename(&self, from: &str, to: &str) -> SshResult<()> {
        let guard = self.inner.lock().await;
        guard
            .rename(from.to_string(), to.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("重命名失败: {e}")))
    }

    pub async fn download<W, F>(&self, remote: &str, writer: &mut W, mut on_progress: F) -> SshResult<u64>
    where
        W: AsyncWriteExt + Unpin,
        F: FnMut(u64),
    {
        let guard = self.inner.lock().await;
        let mut file = guard
            .open(remote.to_string())
            .await
            .map_err(|e| SshError::Msg(format!("打开远程文件失败: {e}")))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = file
                .read(&mut buf)
                .await
                .map_err(|e| SshError::Msg(format!("读取远程失败: {e}")))?;
            if n == 0 {
                break;
            }
            writer
                .write_all(&buf[..n])
                .await
                .map_err(|e| SshError::Msg(format!("写入本地失败: {e}")))?;
            total += n as u64;
            on_progress(total);
        }
        Ok(total)
    }

    pub async fn upload<R, F>(&self, remote: &str, mut reader: R, mut on_progress: F) -> SshResult<u64>
    where
        R: AsyncReadExt + Unpin,
        F: FnMut(u64),
    {
        let guard = self.inner.lock().await;
        let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        let mut file = guard
            .open_with_flags(remote.to_string(), flags)
            .await
            .map_err(|e| SshError::Msg(format!("创建远程文件失败: {e}")))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = reader
                .read(&mut buf)
                .await
                .map_err(|e| SshError::Msg(format!("读取本地失败: {e}")))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .await
                .map_err(|e| SshError::Msg(format!("写入远程失败: {e}")))?;
            total += n as u64;
            on_progress(total);
        }
        file.flush()
            .await
            .map_err(|e| SshError::Msg(format!("刷新失败: {e}")))?;
        file.shutdown()
            .await
            .map_err(|e| SshError::Msg(format!("关闭失败: {e}")))?;
        Ok(total)
    }
}

fn join_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        return name.to_string();
    }
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

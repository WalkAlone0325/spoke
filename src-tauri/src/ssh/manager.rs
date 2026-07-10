use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{ConnectParams, SftpClient, SshResult, SshSession};

pub type SessionId = String;

#[derive(Debug, Clone)]
pub enum SessionEvent {
    Data(Vec<u8>),
    Exit(u32),
    Closed,
    Error(String),
}

#[derive(Default)]
pub struct SessionManager {
    inner: Arc<Mutex<HashMap<SessionId, Arc<SshSession>>>>,
    sftps: Arc<Mutex<HashMap<SessionId, Arc<SftpClient>>>>,
    transfers: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            sftps: Arc::new(Mutex::new(HashMap::new())),
            transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create(
        &self,
        params: ConnectParams,
    ) -> SshResult<(SessionId, mpsc::Receiver<SessionEvent>)> {
        let (tx, rx) = mpsc::channel::<SessionEvent>(256);
        let session = SshSession::connect(params, tx).await?;
        let id = Uuid::new_v4().to_string();
        self.inner
            .lock()
            .await
            .insert(id.clone(), Arc::new(session));
        Ok((id, rx))
    }

    pub async fn get(&self, id: &SessionId) -> Option<Arc<SshSession>> {
        self.inner.lock().await.get(id).cloned()
    }

    pub async fn remove(&self, id: &SessionId) -> Option<Arc<SshSession>> {
        self.sftps.lock().await.remove(id);
        self.inner.lock().await.remove(id)
    }

    pub async fn register_transfer(&self, id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.transfers.lock().await.insert(id, token.clone());
        token
    }

    pub async fn cancel_transfer(&self, id: &str) -> bool {
        if let Some(token) = self.transfers.lock().await.remove(id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn remove_transfer(&self, id: &str) {
        self.transfers.lock().await.remove(id);
    }

    pub async fn sftp(&self, id: &SessionId) -> SshResult<Arc<SftpClient>> {
        if let Some(existing) = self.sftps.lock().await.get(id).cloned() {
            return Ok(existing);
        }
        let session = self
            .get(id)
            .await
            .ok_or_else(|| super::SshError::Msg("会话不存在".into()))?;
        let client = Arc::new(SftpClient::from_session(&session).await?);
        self.sftps
            .lock()
            .await
            .insert(id.clone(), client.clone());
        Ok(client)
    }
}

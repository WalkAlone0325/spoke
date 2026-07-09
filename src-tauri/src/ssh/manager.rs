use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;

use super::{ConnectParams, SshResult, SshSession};

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
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
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
        self.inner.lock().await.remove(id)
    }
}

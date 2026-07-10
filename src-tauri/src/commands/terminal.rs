use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::ssh::{AuthMethod, ConnectParams, SessionEvent, SessionId, SessionManager, SshSession};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthPayload {
    #[serde(rename_all = "camelCase")]
    Password { password: String },
    #[serde(rename_all = "camelCase")]
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    PrivateKeyText {
        pem: String,
        passphrase: Option<String>,
    },
}

impl From<AuthPayload> for AuthMethod {
    fn from(value: AuthPayload) -> Self {
        match value {
            AuthPayload::Password { password } => AuthMethod::Password(password),
            AuthPayload::PrivateKey { path, passphrase } => {
                AuthMethod::PrivateKey { path, passphrase }
            }
            AuthPayload::PrivateKeyText { pem, passphrase } => {
                AuthMethod::PrivateKeyText { pem, passphrase }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPayload {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: AuthPayload,
    #[serde(default = "default_term")]
    pub term: String,
    #[serde(default = "default_cols")]
    pub cols: u32,
    #[serde(default = "default_rows")]
    pub rows: u32,
}

fn default_port() -> u16 {
    22
}
fn default_term() -> String {
    "xterm-256color".to_string()
}
fn default_cols() -> u32 {
    80
}
fn default_rows() -> u32 {
    24
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: SessionId,
}

#[tauri::command]
pub async fn ssh_test_connect(payload: ConnectPayload) -> Result<String, String> {
    let params = ConnectParams {
        host: payload.host,
        port: payload.port,
        username: payload.username,
        auth: payload.auth.into(),
        term: payload.term,
        cols: payload.cols,
        rows: payload.rows,
    };
    SshSession::test_connect(&params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    payload: ConnectPayload,
) -> Result<ConnectResult, String> {
    let params = ConnectParams {
        host: payload.host,
        port: payload.port,
        username: payload.username,
        auth: payload.auth.into(),
        term: payload.term,
        cols: payload.cols,
        rows: payload.rows,
    };
    let (id, mut rx) = manager.create(params).await.map_err(|e| e.to_string())?;

    let event_id = id.clone();
    let app_handle = app.clone();
    tokio::spawn(async move {
        while let Some(evt) = rx.recv().await {
            match evt {
                SessionEvent::Data(bytes) => {
                    let _ = app_handle.emit(
                        &format!("ssh://data/{event_id}"),
                        String::from_utf8_lossy(&bytes).to_string(),
                    );
                }
                SessionEvent::Exit(code) => {
                    let _ = app_handle.emit(&format!("ssh://exit/{event_id}"), code);
                }
                SessionEvent::Closed => {
                    let _ = app_handle.emit(&format!("ssh://closed/{event_id}"), ());
                    break;
                }
                SessionEvent::Error(msg) => {
                    let _ = app_handle.emit(&format!("ssh://error/{event_id}"), msg);
                }
            }
        }
    });

    Ok(ConnectResult { session_id: id })
}

#[tauri::command]
pub async fn ssh_send_data(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    data: String,
) -> Result<(), String> {
    let session = manager
        .get(&session_id)
        .await
        .ok_or_else(|| "session not found".to_string())?;
    session
        .send_data(data.into_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let session = manager
        .get(&session_id)
        .await
        .ok_or_else(|| "session not found".to_string())?;
    session.resize(cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(
    manager: State<'_, SessionManager>,
    session_id: SessionId,
) -> Result<(), String> {
    if let Some(session) = manager.remove(&session_id).await {
        let _ = session.disconnect().await;
    }
    Ok(())
}

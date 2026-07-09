use std::sync::Arc;

use russh::client::{self, Config, Handle, Handler};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, load_secret_key};
use russh::{ChannelMsg, Disconnect};
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, mpsc};
use tokio::task::JoinHandle;
use tokio::time::{Duration, interval};

use super::SessionEvent;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("russh 错误: {0}")]
    Russh(#[from] russh::Error),
    #[error("私钥错误: {0}")]
    Key(#[from] russh::keys::Error),
    #[error("认证失败")]
    AuthFailed,
    #[error("会话已关闭")]
    Closed,
    #[error("{0}")]
    Msg(String),
}

pub type SshResult<T> = Result<T, SshError>;

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub term: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone)]
pub enum AuthMethod {
    Password(String),
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
    PrivateKeyText {
        pem: String,
        passphrase: Option<String>,
    },
}

pub struct ClientHandler;

impl Handler for ClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }
}

pub struct SshSession {
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    input_tx: mpsc::Sender<InputMsg>,
    _reader_task: JoinHandle<()>,
    _keepalive_task: JoinHandle<()>,
}

enum InputMsg {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

impl SshSession {
    pub async fn connect(
        params: ConnectParams,
        event_tx: mpsc::Sender<SessionEvent>,
    ) -> SshResult<Self> {
        let config = Arc::new(Config {
            inactivity_timeout: Some(Duration::from_secs(3600)),
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            ..Config::default()
        });

        let addr = format!("{}:{}", params.host, params.port);
        let mut handle = client::connect(config, addr.as_str(), ClientHandler)
            .await
            .map_err(SshError::Russh)?;

        let authed = match &params.auth {
            AuthMethod::Password(pwd) => handle
                .authenticate_password(params.username.clone(), pwd.clone())
                .await
                .map(|r| r.success())
                .map_err(SshError::Russh)?,
            AuthMethod::PrivateKey { path, passphrase } => {
                let key = load_secret_key(path, passphrase.as_deref())
                    .map_err(SshError::Key)?;
                Self::auth_key(&mut handle, &params.username, key).await?
            }
            AuthMethod::PrivateKeyText { pem, passphrase } => {
                let key = PrivateKey::from_openssh(pem.as_bytes())
                    .map_err(|e| SshError::Msg(format!("解析私钥失败: {e}")))?;
                let key = if let Some(pp) = passphrase {
                    key.decrypt(pp.as_bytes())
                        .map_err(|e| SshError::Msg(format!("私钥解密失败: {e}")))?
                } else {
                    key
                };
                Self::auth_key(&mut handle, &params.username, key).await?
            }
        };
        if !authed {
            return Err(SshError::AuthFailed);
        }

        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(SshError::Russh)?;
        channel
            .request_pty(
                false,
                &params.term,
                params.cols,
                params.rows,
                0,
                0,
                &[],
            )
            .await
            .map_err(SshError::Russh)?;
        channel.request_shell(false).await.map_err(SshError::Russh)?;

        let (input_tx, mut input_rx) = mpsc::channel::<InputMsg>(64);
        let event_tx_reader = event_tx.clone();

        let reader_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(msg) = input_rx.recv() => match msg {
                        InputMsg::Data(bytes) => {
                            if let Err(e) = channel.data(&bytes[..]).await {
                                let _ = event_tx_reader
                                    .send(SessionEvent::Error(format!("写入失败: {e}")))
                                    .await;
                                break;
                            }
                        }
                        InputMsg::Resize { cols, rows } => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        InputMsg::Close => {
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            break;
                        }
                    },
                    Some(msg) = channel.wait() => match msg {
                        ChannelMsg::Data { data } => {
                            let _ = event_tx_reader
                                .send(SessionEvent::Data(data.to_vec()))
                                .await;
                        }
                        ChannelMsg::ExtendedData { data, .. } => {
                            let _ = event_tx_reader
                                .send(SessionEvent::Data(data.to_vec()))
                                .await;
                        }
                        ChannelMsg::ExitStatus { exit_status } => {
                            let _ = event_tx_reader
                                .send(SessionEvent::Exit(exit_status))
                                .await;
                        }
                        ChannelMsg::Close | ChannelMsg::Eof => {
                            let _ = event_tx_reader.send(SessionEvent::Closed).await;
                            break;
                        }
                        _ => {}
                    },
                    else => break,
                }
            }
        });

        let handle = Arc::new(Mutex::new(handle));
        let handle_ka = handle.clone();
        let event_tx_ka = event_tx.clone();
        let keepalive_task = tokio::spawn(async move {
            let mut tick = interval(Duration::from_secs(30));
            tick.tick().await;
            loop {
                tick.tick().await;
                let guard = handle_ka.lock().await;
                if let Err(e) = guard
                    .send_keepalive(false)
                    .await
                {
                    let _ = event_tx_ka
                        .send(SessionEvent::Error(format!("keepalive: {e}")))
                        .await;
                    break;
                }
            }
        });

        Ok(Self {
            handle,
            input_tx,
            _reader_task: reader_task,
            _keepalive_task: keepalive_task,
        })
    }

    async fn auth_key(
        handle: &mut Handle<ClientHandler>,
        user: &str,
        key: PrivateKey,
    ) -> SshResult<bool> {
        let hash = hash_alg_for(&key);
        let with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
        Ok(handle
            .authenticate_publickey(user.to_string(), with_alg)
            .await
            .map_err(SshError::Russh)?
            .success())
    }

    pub async fn send_data(&self, data: Vec<u8>) -> SshResult<()> {
        self.input_tx
            .send(InputMsg::Data(data))
            .await
            .map_err(|_| SshError::Closed)
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> SshResult<()> {
        self.input_tx
            .send(InputMsg::Resize { cols, rows })
            .await
            .map_err(|_| SshError::Closed)
    }

    pub async fn disconnect(&self) -> SshResult<()> {
        let _ = self.input_tx.send(InputMsg::Close).await;
        let guard = self.handle.lock().await;
        let _ = guard
            .disconnect(Disconnect::ByApplication, "bye", "en-US")
            .await;
        Ok(())
    }

    pub fn handle(&self) -> Arc<Mutex<Handle<ClientHandler>>> {
        self.handle.clone()
    }
}

#[allow(dead_code)]
async fn drain<R: AsyncReadExt + Unpin>(mut r: R) {
    let mut buf = [0u8; 1024];
    let _ = r.read(&mut buf).await;
}

fn hash_alg_for(key: &PrivateKey) -> Option<HashAlg> {
    use russh::keys::Algorithm;
    match key.algorithm() {
        Algorithm::Rsa { .. } => Some(HashAlg::Sha256),
        _ => None,
    }
}

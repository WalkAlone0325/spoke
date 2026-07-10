use serde::Serialize;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyGenResult {
    pub private_key: String,
    pub public_key: String,
    pub fingerprint: String,
    pub algorithm: String,
}

fn fmt_pubkey(privkey: &PrivateKey) -> Result<(String, String), String> {
    let pubkey = privkey.public_key();
    let openssh = pubkey
        .to_openssh()
        .map_err(|e| format!("格式化公钥失败: {e}"))?;
    let fingerprint = pubkey
        .fingerprint(HashAlg::Sha256)
        .to_string();
    Ok((openssh, fingerprint))
}

#[tauri::command]
pub async fn generate_ssh_key(
    key_type: String,
    comment: String,
) -> Result<KeyGenResult, String> {
    let algorithm = match key_type.to_lowercase().as_str() {
        "ed25519" => Algorithm::Ed25519,
        "rsa_2048" => Algorithm::Rsa { hash: None },
        "rsa_4096" => Algorithm::Rsa { hash: None },
        _ => return Err(format!("不支持的密钥类型: {key_type}")),
    };

    let mut rng = rand::rngs::OsRng;
    let privkey = PrivateKey::random(&mut rng, algorithm)
        .map_err(|e| format!("生成密钥失败: {e}"))?;

    let comment_str = if comment.is_empty() { "spoke@generated" } else { &comment };

    let openssh = privkey
        .to_openssh(LineEnding::default())
        .map_err(|e| format!("格式化私钥失败: {e}"))?;

    let (public_key, fingerprint) = fmt_pubkey(&privkey)?;

    Ok(KeyGenResult {
        private_key: openssh.to_string(),
        public_key: format!("{public_key} {comment_str}"),
        fingerprint,
        algorithm: key_type,
    })
}

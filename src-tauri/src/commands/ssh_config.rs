use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigEntry {
    pub host: String,
    pub host_name: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

#[tauri::command]
pub fn import_ssh_config() -> Result<Vec<SshConfigEntry>, String> {
    let ssh_dir = dirs::home_dir()
        .map(|p| p.join(".ssh"))
        .ok_or_else(|| "无法获取 home 目录".to_string())?;
    let config_path = ssh_dir.join("config");

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取 ~/.ssh/config 失败: {e}"))?;

    let entries = parse_ssh_config(&content);
    Ok(entries)
}

fn parse_ssh_config(content: &str) -> Vec<SshConfigEntry> {
    let mut entries = Vec::new();
    let mut lines = content.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if !trimmed.to_uppercase().starts_with("HOST ") && !trimmed.to_uppercase().starts_with("HOST *") {
            continue;
        }

        let host = trimmed[5..].trim().to_string();
        if host == "*" || host.starts_with('!') {
            continue;
        }

        let mut host_name = host.clone();
        let mut port: u16 = 22;
        let mut user = "root".to_string();
        let mut identity_file: Option<String> = None;
        let mut proxy_jump: Option<String> = None;

        while let Some(next) = lines.peek() {
            let next_trimmed = next.trim();
            if next_trimmed.to_uppercase().starts_with("HOST ") {
                break;
            }

            let lower = next_trimmed.to_lowercase();
            if lower.starts_with("hostname ") {
                host_name = next_trimmed[9..].trim().to_string();
            } else if let Some(val) = lower.strip_prefix("port ") {
                port = val.trim().parse().unwrap_or(22);
            } else if lower.starts_with("user ") {
                user = next_trimmed[5..].trim().to_string();
            } else if lower.starts_with("identityfile ") {
                let path = expand_path(next_trimmed[13..].trim());
                identity_file = Some(path);
            } else if let Some(val) = lower.strip_prefix("proxyjump ") {
                proxy_jump = Some(val.trim().to_string());
            }

            lines.next();
        }

        entries.push(SshConfigEntry {
            host,
            host_name,
            port,
            user,
            identity_file,
            proxy_jump,
        });
    }

    entries
}

fn expand_path(path: &str) -> String {
    let trimmed = path.trim_matches('"');
    if trimmed.starts_with("~/") || trimmed == "~" {
        if let Some(home) = dirs::home_dir() {
            return trimmed.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    trimmed.to_string()
}

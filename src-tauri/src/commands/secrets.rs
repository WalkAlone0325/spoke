use keyring::Entry;

const SERVICE_NAME: &str = "spoke";

#[tauri::command]
pub async fn secret_save(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("创建密钥条目失败: {e}"))?;
    entry.set_password(&value).map_err(|e| format!("保存密钥失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn secret_get(key: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("创建密钥条目失败: {e}"))?;
    entry.get_password().map_err(|e| format!("读取密钥失败: {e}"))
}

#[tauri::command]
pub async fn secret_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| format!("创建密钥条目失败: {e}"))?;
    entry.delete_password().map_err(|e| format!("删除密钥失败: {e}"))
}

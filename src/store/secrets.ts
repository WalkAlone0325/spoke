import { invoke } from "@tauri-apps/api/core";

export async function saveSecret(key: string, value: string): Promise<void> {
  await invoke("secret_save", { key, value });
}

export async function getSecret(key: string): Promise<string> {
  return await invoke<string>("secret_get", { key });
}

export async function deleteSecret(key: string): Promise<void> {
  await invoke("secret_delete", { key });
}

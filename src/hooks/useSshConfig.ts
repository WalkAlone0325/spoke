import { invoke } from "@tauri-apps/api/core";

export interface SshConfigEntry {
  host: string;
  hostName: string;
  port: number;
  user: string;
  identityFile?: string;
  proxyJump?: string;
}

export async function importSshConfig(): Promise<SshConfigEntry[]> {
  return await invoke<SshConfigEntry[]>("import_ssh_config");
}

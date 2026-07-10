import { invoke } from "@tauri-apps/api/core";

export type RemoteEntryKind = "dir" | "file" | "symlink" | "other";

export interface RemoteEntry {
  name: string;
  path: string;
  kind: RemoteEntryKind;
  size: number;
  modified?: number | null;
  permissions?: number | null;
  isSymlink: boolean;
}

export type LocalEntryKind = "dir" | "file" | "symlink" | "other";

export interface LocalEntry {
  name: string;
  path: string;
  kind: LocalEntryKind;
  size: number;
  modified?: number | null;
}

export interface TransferProgress {
  transferId: string;
  transferred: number;
  total?: number | null;
}

export async function sftpList(sessionId: string, path: string): Promise<RemoteEntry[]> {
  return await invoke<RemoteEntry[]>("sftp_list", { sessionId, path });
}

export async function sftpHome(sessionId: string): Promise<string> {
  return await invoke<string>("sftp_home", { sessionId });
}

export async function sftpStat(sessionId: string, path: string): Promise<RemoteEntry> {
  return await invoke<RemoteEntry>("sftp_stat", { sessionId, path });
}

export async function sftpMkdir(sessionId: string, path: string): Promise<void> {
  await invoke("sftp_mkdir", { sessionId, path });
}

export async function sftpRemove(sessionId: string, path: string): Promise<void> {
  await invoke("sftp_remove", { sessionId, path });
}

export async function sftpRename(sessionId: string, from: string, to: string): Promise<void> {
  await invoke("sftp_rename", { sessionId, from, to });
}

export async function sftpUpload(
  sessionId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
): Promise<number> {
  return await invoke<number>("sftp_upload", {
    payload: { sessionId, localPath, remotePath, transferId },
  });
}

export async function sftpUploadDir(
  sessionId: string,
  localDir: string,
  remoteDir: string,
  transferId: string,
): Promise<number> {
  return await invoke<number>("sftp_upload_dir", {
    payload: { sessionId, localDir, remoteDir, transferId },
  });
}

export async function sftpDownload(
  sessionId: string,
  remotePath: string,
  localPath: string,
  transferId: string,
): Promise<number> {
  return await invoke<number>("sftp_download", {
    payload: { sessionId, remotePath, localPath, transferId },
  });
}

export async function localList(path: string): Promise<LocalEntry[]> {
  return await invoke<LocalEntry[]>("local_list", { path });
}

export async function localHome(): Promise<string> {
  return await invoke<string>("local_home");
}

export async function localIsDir(path: string): Promise<boolean> {
  return await invoke<boolean>("local_is_dir", { path });
}

export async function localStat(path: string): Promise<LocalEntry | null> {
  return await invoke<LocalEntry | null>("local_stat", { path });
}

export async function editTempPath(filename: string): Promise<string> {
  return await invoke<string>("edit_temp_path", { filename });
}

export async function editOpenFile(path: string): Promise<void> {
  await invoke("edit_open_file", { path });
}

export function joinRemote(dir: string, name: string): string {
  if (name === "..") return parentRemote(dir);
  if (name === ".") return dir;
  if (!dir || dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function parentRemote(dir: string): string {
  if (!dir || dir === "/") return "/";
  const trimmed = dir.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export function joinLocal(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  if (name === "..") return parentLocal(dir);
  if (name === ".") return dir;
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export function parentLocal(dir: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(new RegExp(`${sep === "\\" ? "\\\\" : "/"}+$`), "");
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) return sep;
  return trimmed.slice(0, idx);
}

import { load, type Store } from "@tauri-apps/plugin-store";

export interface StoredGroup {
  id: string;
  name: string;
}

export interface ProxyJumpConfig {
  host: string;
  port: number;
  username: string;
  auth: StoredAuth;
  passwordRef?: string;
  passphraseRef?: string;
}

export interface HttpProxyConfig {
  kind: "http";
  host: string;
  port: number;
}

export interface Socks5ProxyConfig {
  kind: "socks5";
  host: string;
  port: number;
}

export type ProxyKindConfig = HttpProxyConfig | Socks5ProxyConfig;

export interface StoredServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  groupId?: string;
  auth: StoredAuth;
  /** Keychain reference for password auth (replaces plaintext) */
  passwordRef?: string;
  /** Keychain reference for private key passphrase (replaces plaintext) */
  passphraseRef?: string;
  proxyJump?: ProxyJumpConfig;
  proxy?: ProxyKindConfig;
  createdAt: number;
  updatedAt: number;
}

export type StoredAuth =
  | { kind: "password"; password?: string }
  | { kind: "privateKey"; path: string; passphrase?: string }
  | { kind: "privateKeyText"; pem: string; passphrase?: string };

const STORE_FILE = "settings.json";
const SERVERS_KEY = "servers";
const GROUPS_KEY = "groups";

let cached: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!cached)
    cached = load(STORE_FILE, {
      autoSave: true,
      defaults: { [SERVERS_KEY]: [] },
    });
  return cached;
}

export async function loadServers(): Promise<StoredServer[]> {
  const s = await store();
  return (await s.get<StoredServer[]>(SERVERS_KEY)) ?? [];
}

export async function saveServer(server: StoredServer): Promise<StoredServer[]> {
  const s = await store();
  const list = (await s.get<StoredServer[]>(SERVERS_KEY)) ?? [];
  const idx = list.findIndex((x) => x.id === server.id);
  const now = Date.now();
  const next = { ...server, updatedAt: now, createdAt: server.createdAt || now };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  await s.set(SERVERS_KEY, list);
  await s.save();
  return list;
}

export async function deleteServer(id: string): Promise<StoredServer[]> {
  const s = await store();
  const list = ((await s.get<StoredServer[]>(SERVERS_KEY)) ?? []).filter(
    (x) => x.id !== id,
  );
  await s.set(SERVERS_KEY, list);
  await s.save();
  return list;
}

export async function loadGroups(): Promise<StoredGroup[]> {
  const s = await store();
  return (await s.get<StoredGroup[]>(GROUPS_KEY)) ?? [];
}

export async function saveAllGroups(groups: StoredGroup[]): Promise<void> {
  const s = await store();
  await s.set(GROUPS_KEY, groups);
  await s.save();
}

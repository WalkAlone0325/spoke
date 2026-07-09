import { load, type Store } from "@tauri-apps/plugin-store";

export interface StoredServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  groupId?: string;
  auth: StoredAuth;
  createdAt: number;
  updatedAt: number;
}

export type StoredAuth =
  | { kind: "password"; password: string }
  | { kind: "privateKey"; path: string; passphrase?: string }
  | { kind: "privateKeyText"; pem: string; passphrase?: string };

const STORE_FILE = "settings.json";
const SERVERS_KEY = "servers";

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

import { useMemo, useState, useCallback } from "react";
import { useAppStore, type ServerGroup, type TerminalTab } from "../store/appStore";
import { sshConnect, type AuthPayload, type ConnectPayload } from "../hooks/useSshSession";
import { saveServer, loadServers, deleteServer, saveAllGroups, type StoredServer } from "../store/settings";
import { getSecret, deleteSecret } from "../store/secrets";
import { importSshConfig } from "../hooks/useSshConfig";
import { ConfirmDialog } from "./ConfirmDialog";

async function quickConnect(server: StoredServer) {
  const store = useAppStore.getState();
  const tabId = crypto.randomUUID();
  const tab: TerminalTab = {
    id: tabId,
    title: server.name,
    serverId: server.id,
    connected: false,
  };
  store.addTab(tab);

  let password = "";
  let passphrase: string | undefined;

  try {
    if (server.auth.kind === "password") {
      if (server.passwordRef) {
        password = await getSecret(server.passwordRef);
      } else if (server.auth.password) {
        password = server.auth.password;
      }
    }

    if (server.auth.kind === "privateKey") {
      if (server.passphraseRef) {
        passphrase = await getSecret(server.passphraseRef);
      } else if (server.auth.passphrase) {
        passphrase = server.auth.passphrase;
      }
    }

    let proxyJump: ConnectPayload["proxyJump"];
    if (server.proxyJump) {
      let jpwd = "";
      let jpp: string | undefined;
      if (server.proxyJump.passwordRef) {
        try { jpwd = await getSecret(server.proxyJump.passwordRef); } catch { jpwd = ""; }
      } else if (server.proxyJump.auth.kind === "password" && server.proxyJump.auth.password) {
        jpwd = server.proxyJump.auth.password;
      }
      if (server.proxyJump.passphraseRef) {
        try { jpp = await getSecret(server.proxyJump.passphraseRef); } catch { jpp = undefined; }
      } else if (server.proxyJump.auth.kind === "privateKey" && server.proxyJump.auth.passphrase) {
        jpp = server.proxyJump.auth.passphrase;
      }
      const auth: AuthPayload = server.proxyJump.auth.kind === "password"
        ? { kind: "password", password: jpwd }
        : { kind: "privateKey", path: (server.proxyJump.auth as any).path, passphrase: jpp };
      proxyJump = {
        host: server.proxyJump.host,
        port: server.proxyJump.port,
        username: server.proxyJump.username,
        auth,
      };
    }

    const sessionId = await sshConnect({
      host: server.host,
      port: server.port,
      username: server.username,
      auth:
        server.auth.kind === "password"
          ? { kind: "password", password }
          : server.auth.kind === "privateKey"
          ? {
              kind: "privateKey",
              path: server.auth.path,
              passphrase,
            }
          : {
              kind: "privateKeyText",
              pem: server.auth.pem,
              passphrase,
            },
      proxyJump,
    });
    store.updateTab(tabId, { sessionId, connected: true });
  } catch (e) {
    store.updateTab(tabId, { title: `${server.name} (失败)`, connected: false });
    console.error(e);
  }
}

const DEFAULT_GROUP_IDS = new Set(["prod", "test"]);

export function Sidebar() {
  const groups = useAppStore((s) => s.groups);
  const servers = useAppStore((s) => s.servers);
  const tabs = useAppStore((s) => s.tabs);
  const openConnectDialog = useAppStore((s) => s.openConnectDialog);
  const setServers = useAppStore((s) => s.setServers);
  const setGroups = useAppStore((s) => s.setGroups);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "group" | "server";
    id: string;
    name: string;
    message: string;
    passwordRef?: string;
    passphraseRef?: string;
    proxyPasswordRef?: string;
    proxyPassphraseRef?: string;
  } | null>(null);

  const onStartEditGroup = (g: ServerGroup) => {
    if (DEFAULT_GROUP_IDS.has(g.id)) return;
    setEditingGroupId(g.id);
    setEditingGroupName(g.name);
  };

  const syncGroups = async (next: ServerGroup[]) => {
    setGroups(next);
    await saveAllGroups(next);
  };

  const onSaveGroup = async () => {
    if (!editingGroupId || !editingGroupName.trim() || DEFAULT_GROUP_IDS.has(editingGroupId)) return;
    const next = groups.map((g) =>
      g.id === editingGroupId ? { ...g, name: editingGroupName.trim() } : g,
    );
    await syncGroups(next);
    setEditingGroupId(null);
  };

  const onDeleteGroup = (id: string) => {
    if (DEFAULT_GROUP_IDS.has(id)) return;
    const groupName = groups.find((g) => g.id === id)?.name ?? "";
    const hasServers = servers.some((s) => (s.groupId ?? "prod") === id);
    setConfirmDelete({
      kind: "group",
      id,
      name: groupName,
      message: hasServers
        ? `该分组下有服务器，删除分组不会删除服务器，但服务器会失去分组归属。`
        : "",
    });
  };

  const handleConfirmDelete = async () => {
    const target = confirmDelete;
    if (!target) return;
    setConfirmDelete(null);
    if (target.kind === "group") {
      await syncGroups(groups.filter((g) => g.id !== target.id));
    } else {
      try { if (target.passwordRef) await deleteSecret(target.passwordRef); } catch {}
      try { if (target.passphraseRef) await deleteSecret(target.passphraseRef); } catch {}
      try { if (target.proxyPasswordRef) await deleteSecret(target.proxyPasswordRef); } catch {}
      try { if (target.proxyPassphraseRef) await deleteSecret(target.proxyPassphraseRef); } catch {}
      const updated = await deleteServer(target.id);
      setServers(updated);
    }
  };

  const onAddGroup = async () => {
    const id = `group_${crypto.randomUUID().slice(0, 8)}`;
    const next = [...groups, { id, name: "新分组" }];
    await syncGroups(next);
    setEditingGroupId(id);
    setEditingGroupName("新分组");
  };

  const onImportConfig = useCallback(async () => {
    setImporting(true);
    try {
      const entries = await importSshConfig();
      const existingHosts = new Set(servers.map((s) => s.host));
      let added = 0;
      for (const e of entries) {
        if (existingHosts.has(e.hostName)) continue;
        const now = Date.now();
        const server: StoredServer = {
          id: crypto.randomUUID(),
          name: e.host,
          host: e.hostName,
          port: e.port,
          username: e.user,
          groupId: "prod",
          auth: { kind: e.identityFile ? "privateKey" : "password", path: e.identityFile || "" },
          createdAt: now,
          updatedAt: now,
        };
        await saveServer(server);
        added++;
      }
      setServers(await loadServers());
      if (added > 0) {
        console.log(`已导入 ${added} 个服务器`);
      }
    } catch (e) {
      console.error("导入 SSH Config 失败:", e);
    } finally {
      setImporting(false);
    }
  }, [servers, setServers]);

  const activeServerIds = useMemo(
    () =>
      new Set(
        tabs
          .filter((t) => t.connected && t.serverId)
          .map((t) => t.serverId as string),
      ),
    [tabs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q),
    );
  }, [servers, query]);

  return (
    <aside className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-9 shrink-0" />
      <div data-tauri-drag-region className="px-4 pb-3">
        <div data-tauri-drag-region className="mb-3 flex items-center gap-2.5">
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-accent-500 shadow-[0_4px_12px_-2px_rgba(0,87,255,0.4)]">
            <div className="pointer-events-none absolute inset-0 rounded-xl bg-linear-to-b from-white/30 to-transparent" />
            <img src="/spoke-logo.svg" alt="" className="relative h-5 w-5 brightness-0 invert" />
          </div>
          <div data-tauri-drag-region className="min-w-0">
            <div data-tauri-drag-region className="text-[15px] font-semibold tracking-tight">
              Spoke
            </div>
            <div
              data-tauri-drag-region
              className="text-[10px] tracking-wide text-ink-500 dark:text-ink-400"
            >
              Connect · Command · Convey
            </div>
          </div>
        </div>
        <div className="relative">
          <svg
            viewBox="0 0 20 20"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500 dark:text-ink-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 4 4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索服务器"
            className="w-full rounded-xl border border-transparent bg-black/[0.04] py-1.5 pl-8 pr-2 text-sm outline-none transition-all placeholder:text-ink-500 hover:bg-black/[0.06] focus:border-brand-500/40 focus:bg-white focus:shadow-sm dark:bg-white/[0.06] dark:placeholder:text-ink-400 dark:hover:bg-white/[0.08] dark:focus:bg-ink-800"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const list = filtered.filter((s) => (s.groupId ?? "prod") === g.id);
          const isEditing = editingGroupId === g.id;
          return (
            <div key={g.id} className="mb-2">
              <div className="group flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                {isEditing ? (
                  <input
                    className="min-w-0 flex-1 rounded border border-brand-500/50 bg-transparent px-1 py-0.5 text-[10px] font-semibold uppercase outline-none"
                    value={editingGroupName}
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    onBlur={onSaveGroup}
                    onKeyDown={(e) => { if (e.key === "Enter") onSaveGroup(); if (e.key === "Escape") setEditingGroupId(null); }}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 truncate">{g.name}</span>
                )}
                <span className="rounded-full bg-black/5 px-1.5 py-[1px] text-[9px] font-medium dark:bg-white/10">
                  {list.length}
                </span>
                {!isEditing && !DEFAULT_GROUP_IDS.has(g.id) && (
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => onStartEditGroup(g)}
                      className="grid h-4 w-4 place-items-center rounded text-ink-500 hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M13 4l3 3-9 9H4v-3z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDeleteGroup(g.id)}
                      className="grid h-4 w-4 place-items-center rounded text-ink-500 hover:bg-red-500/10 hover:text-red-500"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M4 6h12M7 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
              {list.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-ink-500/70 dark:text-ink-400/70">
                  暂无服务器
                </div>
              ) : (
                list.map((s) => {
                  const online = activeServerIds.has(s.id);
                  return (
                    <div
                      key={s.id}
                      onDoubleClick={() => void quickConnect(s)}
                      className="group relative mx-0.5 mb-0.5 flex select-none items-center gap-2 rounded-xl px-2.5 py-2 transition-all hover:bg-black/[0.05] active:scale-[0.98] dark:hover:bg-white/[0.06]"
                      title={`双击连接 · ${s.username}@${s.host}:${s.port}`}
                    >
                      <span className="relative flex h-2 w-2 shrink-0">
                        {online && (
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-500 opacity-60" />
                        )}
                        <span
                          className={`relative inline-flex h-2 w-2 rounded-full ${
                            online ? "bg-accent-500" : "bg-ink-400/50 dark:bg-ink-500/60"
                          }`}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate text-[10px] text-ink-500 dark:text-ink-400">
                          {s.username}@{s.host}
                          {s.port !== 22 ? `:${s.port}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openConnectDialog(s.id);
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md text-ink-500 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 dark:text-ink-400 dark:hover:bg-white/10"
                        aria-label="编辑"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M13 4l3 3-9 9H4v-3z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({
                            kind: "server",
                            id: s.id,
                            name: s.name,
                            message: "",
                            passwordRef: s.passwordRef,
                            passphraseRef: s.passphraseRef,
                            proxyPasswordRef: s.proxyJump?.passwordRef,
                            proxyPassphraseRef: s.proxyJump?.passphraseRef,
                          });
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md text-ink-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 dark:text-ink-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
                        aria-label="删除"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 6h12M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2M5 6l1 10a1 1 0 001 1h6a1 1 0 001-1l1-10" />
                          <path d="M8 9v6M12 9v6" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
        <div className="px-2.5 pt-1">
          <button
            onClick={onAddGroup}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-ink-500 transition-colors hover:bg-black/[0.04] hover:text-ink-700 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
          >
            <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M10 4v12M4 10h12" />
            </svg>
            <span>新建分组</span>
          </button>
        </div>
      </nav>

      <div className="border-t border-black/[0.06] p-3 dark:border-white/[0.06]">
        <button
          onClick={() => openConnectDialog(null)}
          className="group relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-linear-to-r from-brand-500 to-accent-500 px-3 py-2 text-sm font-medium text-white shadow-[0_4px_12px_-2px_rgba(0,87,255,0.4)] transition-all hover:shadow-[0_6px_16px_-2px_rgba(0,87,255,0.5)] active:scale-[0.98]"
        >
          <div className="absolute inset-0 bg-linear-to-b from-white/20 to-transparent" />
          <svg
            viewBox="0 0 20 20"
            className="relative h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M10 4v12M4 10h12" />
          </svg>
          <span className="relative">新建连接</span>
        </button>
        <button
          onClick={onImportConfig}
          disabled={importing}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-ink-500 transition-colors hover:bg-black/[0.04] hover:text-ink-700 disabled:opacity-50 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3v12M5 10l5 5 5-5" />
            <path d="M3 16v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1" />
          </svg>
          <span>{importing ? "导入中…" : "导入 SSH Config"}</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `确认删除${confirmDelete.kind === "server" ? "服务器" : "分组"}` : ""}
        message={
          confirmDelete
            ? confirmDelete.kind === "group" && confirmDelete.message
              ? `${confirmDelete.message}`
              : `确定删除"${confirmDelete.name}"？此操作不可恢复。`
            : ""
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </aside>
  );
}

import { useMemo, useState, useCallback, useEffect } from "react";
import { useAppStore, type ServerGroup, type TerminalTab } from "../store/appStore";
import { sshConnect, type AuthPayload, type ConnectPayload } from "../hooks/useSshSession";
import { saveServer, loadServers, deleteServer, saveAllGroups, saveCollapsedGroups, type StoredServer } from "../store/settings";
import { getSecret, deleteSecret } from "../store/secrets";
import { importSshConfig } from "../hooks/useSshConfig";
import { readTextFile, writeTextFile } from "../hooks/useSftp";
import { ConfirmDialog } from "./ConfirmDialog";
import { FilePickerDialog, type FilePickerMode } from "./FilePickerDialog";

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
  const collapsedGroupIds = useAppStore((s) => s.collapsedGroupIds);
  const toggleGroupCollapse = useAppStore((s) => s.toggleGroupCollapse);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const setKeyGenOpen = useAppStore((s) => s.setKeyGenOpen);
  const [filePicker, setFilePicker] = useState<{
    mode: FilePickerMode;
    title: string;
    defaultPath?: string;
    onPick: (result: string | string[] | null) => void;
  } | null>(null);
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

  const handleExport = useCallback(() => {
    const data = { version: 1, exportedAt: new Date().toISOString(), servers, groups };
    const json = JSON.stringify(data, null, 2);
    setFilePicker({
      mode: "save-file",
      title: "导出服务器配置",
      defaultPath: `spoke-servers-${new Date().toISOString().slice(0, 10)}.json`,
      onPick: (result) => {
        if (!result || Array.isArray(result)) return;
        (async () => {
          try {
            await writeTextFile(result as string, json);
          } catch (e) {
            console.error("导出失败", e);
          }
        })();
      },
    });
  }, [servers, groups]);

  const handleImport = useCallback(() => {
    setFilePicker({
      mode: "open-file",
      title: "导入服务器配置",
      onPick: (result) => {
        if (!result || Array.isArray(result)) return;
        (async () => {
          try {
            const text = await readTextFile(result as string);
            const data = JSON.parse(text);
            if (!data.servers || !Array.isArray(data.servers)) {
              window.alert("无效的配置文件格式");
              return;
            }
            const existingIds = new Set(servers.map((s) => s.id));
            let added = 0;
            for (const s of data.servers) {
              if (existingIds.has(s.id)) continue;
              await saveServer(s);
              added++;
            }
            if (data.groups && Array.isArray(data.groups)) {
              const allGroups = [...groups];
              for (const g of data.groups) {
                if (!allGroups.find((x) => x.id === g.id)) {
                  allGroups.push(g);
                }
              }
              await saveAllGroups(allGroups);
              setGroups(allGroups);
            }
            setServers(await loadServers());
            if (added > 0) window.alert(`成功导入 ${added} 个服务器`);
            else window.alert("没有新服务器可导入");
          } catch (e) {
            window.alert(`导入失败: ${e}`);
          }
        })();
      },
    });
  }, [servers, groups, setServers, setGroups]);

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

  useEffect(() => {
    saveCollapsedGroups(collapsedGroupIds);
  }, [collapsedGroupIds]);

  return (
    <aside className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-9 shrink-0" />
      <div data-tauri-drag-region className="px-4 pb-4">
        <div data-tauri-drag-region className="mb-4 flex items-center gap-3">
          <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand-500 to-accent-500 shadow-[0_4px_12px_-2px_rgba(0,87,255,0.4)]">
            <div className="pointer-events-none absolute inset-0 rounded-lg bg-linear-to-b from-white/30 to-transparent" />
            <img src="/spoke-logo.svg" alt="" className="relative h-4 w-4 brightness-0 invert" />
          </div>
          <div data-tauri-drag-region className="min-w-0">
            <div data-tauri-drag-region className="text-sm font-semibold tracking-tight leading-tight">
              Spoke
            </div>
            <div
              data-tauri-drag-region
              className="text-[9px] tracking-wider text-ink-500/70 dark:text-ink-400/60"
            >
              Connect · Command · Convey
            </div>
          </div>
        </div>
        <div className="relative">
          <svg
            viewBox="0 0 20 20"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500/50 dark:text-ink-400/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
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
            className="w-full rounded-lg border border-black/[0.06] bg-black/[0.03] py-1.5 pl-8 pr-2 text-sm outline-none transition-all placeholder:text-ink-500/60 hover:border-black/[0.1] hover:bg-black/[0.05] focus:border-brand-500/40 focus:bg-white focus:shadow-xs dark:border-white/[0.08] dark:bg-white/[0.04] dark:placeholder:text-ink-400/50 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.06] dark:focus:bg-ink-800 dark:focus:shadow-xs"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const list = filtered.filter((s) => (s.groupId ?? "prod") === g.id);
          const isEditing = editingGroupId === g.id;
          const collapsed = collapsedGroupIds[g.id] ?? false;
          return (
                <div key={g.id}>
              <div className="group flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                <button
                  onClick={() => toggleGroupCollapse(g.id)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-ink-500/60 hover:bg-black/10 hover:text-ink-500 dark:text-ink-400/50 dark:hover:bg-white/10 dark:hover:text-ink-400"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className={`h-3 w-3 transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-0"}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
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
                <span className="rounded-md bg-black/[0.06] px-1.5 py-[1px] text-[9px] font-semibold dark:bg-white/[0.08]">
                  {list.length}
                </span>
                {!isEditing && !DEFAULT_GROUP_IDS.has(g.id) && (
                  <span className="flex items-center gap-0.5 opacity-0 transition-all duration-150 group-hover:opacity-100">
                    <button
                      onClick={() => onStartEditGroup(g)}
                      className="grid h-5 w-5 place-items-center rounded-md text-ink-500/60 hover:bg-black/10 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-ink-200"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M13 4l3 3-9 9H4v-3z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDeleteGroup(g.id)}
                      className="grid h-5 w-5 place-items-center rounded-md text-ink-500/60 hover:bg-red-500/10 hover:text-red-500"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M4 6h12M7 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
              {collapsed ? null : list.length === 0 ? (
                <div className="px-4 py-1.5 text-[11px] text-ink-500/50 dark:text-ink-400/40">
                  暂无服务器
                </div>
              ) : (
                <div className="ml-1.5 border-l border-black/[0.06] pl-1.5 dark:border-white/[0.06]">
                  {list.map((s) => {
                    const online = activeServerIds.has(s.id);
                    return (
                      <div
                        key={s.id}
                        onDoubleClick={() => void quickConnect(s)}
                        className="group relative mb-0.5 flex select-none items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all hover:bg-black/[0.04] active:scale-[0.98] dark:hover:bg-white/[0.05]"
                        title={`双击连接 · ${s.username}@${s.host}:${s.port}`}
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          {online && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-500/70" />
                          )}
                          <span
                            className={`relative inline-flex h-2 w-2 rounded-full ${
                              online ? "bg-accent-500" : "bg-ink-400/40 dark:bg-ink-500/50"
                            }`}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-snug group-hover:truncate">{s.name}</div>
                          <div className="text-[10px] text-ink-500/70 group-hover:truncate dark:text-ink-400/60">
                            {s.username}@{s.host}
                            {s.port !== 22 ? `:${s.port}` : ""}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openConnectDialog(s.id);
                          }}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-500/50 opacity-0 transition-all duration-150 hover:bg-black/10 hover:text-ink-700 group-hover:opacity-100 dark:text-ink-400/40 dark:hover:bg-white/10 dark:hover:text-ink-200"
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
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-500/50 opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 dark:text-ink-400/40 dark:hover:bg-red-500/20 dark:hover:text-red-400"
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
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="px-1.5 pt-0.5">
          <button
            onClick={onAddGroup}
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-500/70 transition-colors hover:bg-black/[0.04] hover:text-ink-700 dark:text-ink-400/60 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M10 4v12M4 10h12" stroke="currentColor" />
            </svg>
            <span>新建分组</span>
          </button>
        </div>
      </nav>

      <div className="border-t border-black/[0.06] px-2.5 py-2.5 dark:border-white/[0.06]">
        <button
          onClick={() => openConnectDialog(null)}
          className="group relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-linear-to-r from-brand-500 to-accent-500 px-3 py-2 text-sm font-medium text-white shadow-[0_4px_12px_-2px_rgba(0,87,255,0.35)] transition-all hover:shadow-[0_6px_18px_-2px_rgba(0,87,255,0.45)] active:scale-[0.97]"
        >
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-white/20 to-transparent" />
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
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-ink-500/60 transition-colors hover:bg-black/[0.04] hover:text-ink-700 disabled:opacity-40 dark:text-ink-400/50 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3v12M5 10l5 5 5-5" />
            <path d="M3 16v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1" />
          </svg>
          <span>{importing ? "导入中…" : "导入 SSH Config"}</span>
        </button>

        <div className="mb-1 mt-2 flex items-center gap-2">
          <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/[0.06]" />
          <span className="text-[9px] font-medium uppercase tracking-widest text-ink-400/60 dark:text-ink-500/50">
            工具
          </span>
          <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/[0.06]" />
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={() => setKeyGenOpen(true)}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-500/70 transition-colors hover:bg-black/[0.04] hover:text-ink-700 dark:text-ink-400/60 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-500/10 text-brand-500">
              <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="10" cy="8" r="3" /><path d="M5.5 13.5a7 7 0 0 1 9 0" /><path d="M3 17a10 10 0 0 1 14 0" />
              </svg>
            </span>
            <span>生成 SSH 密钥</span>
          </button>

          <div className="flex gap-1">
            <button
              onClick={handleExport}
              className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-500/70 transition-colors hover:bg-black/[0.04] hover:text-ink-700 dark:text-ink-400/60 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
            >
              <span className="grid h-5 w-5 place-items-center rounded-md bg-accent-500/10 text-accent-500">
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 17h12M10 3v10M7 9l3 3 3-3" />
                </svg>
              </span>
              <span>导出配置</span>
            </button>
            <button
              onClick={handleImport}
              className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-500/70 transition-colors hover:bg-black/[0.04] hover:text-ink-700 dark:text-ink-400/60 dark:hover:bg-white/[0.04] dark:hover:text-ink-200"
            >
              <span className="grid h-5 w-5 place-items-center rounded-md bg-accent-500/10 text-accent-500">
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 17h12M10 13V3M7 9l3-3 3 3" />
                </svg>
              </span>
              <span>导入配置</span>
            </button>
          </div>
        </div>
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

      {filePicker && (
        <FilePickerDialog
          open
          mode={filePicker.mode}
          title={filePicker.title}
          defaultPath={filePicker.defaultPath}
          onClose={(result) => {
            filePicker.onPick(result);
            setFilePicker(null);
          }}
        />
      )}
    </aside>
  );
}

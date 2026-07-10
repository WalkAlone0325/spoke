import { useMemo, useState } from "react";
import { useAppStore, type TerminalTab } from "../store/appStore";
import { sshConnect } from "../hooks/useSshSession";
import type { StoredServer } from "../store/settings";

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
  try {
    const sessionId = await sshConnect({
      host: server.host,
      port: server.port,
      username: server.username,
      auth:
        server.auth.kind === "password"
          ? { kind: "password", password: server.auth.password }
          : server.auth.kind === "privateKey"
          ? {
              kind: "privateKey",
              path: server.auth.path,
              passphrase: server.auth.passphrase,
            }
          : {
              kind: "privateKeyText",
              pem: server.auth.pem,
              passphrase: server.auth.passphrase,
            },
    });
    store.updateTab(tabId, { sessionId, connected: true });
  } catch (e) {
    store.updateTab(tabId, { title: `${server.name} (失败)`, connected: false });
    console.error(e);
  }
}

export function Sidebar() {
  const groups = useAppStore((s) => s.groups);
  const servers = useAppStore((s) => s.servers);
  const tabs = useAppStore((s) => s.tabs);
  const openConnectDialog = useAppStore((s) => s.openConnectDialog);
  const [query, setQuery] = useState("");

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
          return (
            <div key={g.id} className="mb-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                <span>{g.name}</span>
                <span className="rounded-full bg-black/5 px-1.5 py-[1px] text-[9px] font-medium dark:bg-white/10">
                  {list.length}
                </span>
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
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
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
      </div>
    </aside>
  );
}

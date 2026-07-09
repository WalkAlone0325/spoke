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
  const openConnectDialog = useAppStore((s) => s.openConnectDialog);

  return (
    <aside className="flex h-full flex-col border-r border-black/5 bg-white/60 backdrop-blur dark:border-white/5 dark:bg-ink-800/40">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 px-1 pb-3">
          <img src="/spoke-logo.svg" alt="Spoke" className="h-6 w-6" />
          <span className="font-semibold tracking-tight">Spoke</span>
        </div>
        <input
          type="search"
          placeholder="🔍  搜索服务器"
          className="w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-ink-600/60 focus:border-brand-500 dark:border-white/10 dark:bg-ink-700/60"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {groups.map((g) => {
          const list = servers.filter((s) => (s.groupId ?? "prod") === g.id);
          return (
            <div key={g.id} className="mb-3">
              <div className="px-2 py-1 text-xs font-medium text-ink-600 dark:text-ink-100/60">
                📁 {g.name}
              </div>
              {list.length === 0 ? (
                <div className="px-3 py-1 text-xs text-ink-600/50 dark:text-ink-100/30">
                  暂无服务器
                </div>
              ) : (
                list.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <button
                      onDoubleClick={() => void quickConnect(s)}
                      onClick={() => void quickConnect(s)}
                      className="flex flex-1 items-center gap-2 text-left text-sm"
                      title={`${s.username}@${s.host}:${s.port}`}
                    >
                      <span className="h-2 w-2 rounded-full bg-ink-600/50" />
                      <span className="truncate">🖥️ {s.name}</span>
                    </button>
                    <button
                      onClick={() => openConnectDialog(s.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-70"
                      aria-label="编辑"
                    >
                      ⚙︎
                    </button>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-black/5 p-2 dark:border-white/5">
        <button
          onClick={() => openConnectDialog(null)}
          className="w-full rounded-md bg-linear-to-r from-brand-500 to-accent-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          + 新建连接
        </button>
      </div>
    </aside>
  );
}

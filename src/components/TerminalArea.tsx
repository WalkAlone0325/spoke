import { useAppStore } from "../store/appStore";
import { TerminalView } from "./TerminalView";

export function TerminalArea() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-ink-50 dark:bg-ink-900">
      <div className="flex items-center gap-1 border-b border-black/5 bg-white/60 px-2 py-1 dark:border-white/5 dark:bg-ink-800/40">
        {tabs.length === 0 ? (
          <span className="px-2 py-1 text-xs text-ink-600/60 dark:text-ink-100/40">
            尚未打开任何终端
          </span>
        ) : (
          tabs.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                activeTabId === t.id
                  ? "bg-brand-500/10 text-brand-500"
                  : "text-ink-600 hover:bg-black/5 dark:text-ink-100/70 dark:hover:bg-white/5"
              }`}
            >
              <button
                onClick={() => setActiveTab(t.id)}
                className="flex items-center gap-1"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    t.connected ? "bg-accent-500" : "bg-ink-600/50"
                  }`}
                />
                <span>{t.title}</span>
              </button>
              <button
                onClick={() => closeTab(t.id)}
                className="opacity-40 hover:opacity-100"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden font-mono text-sm">
        {activeTab && activeTab.sessionId ? (
          <TerminalView tab={activeTab} />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-black text-ink-100/70">
            <div className="flex flex-col items-center gap-3">
              <img src="/spoke-logo.svg" alt="" className="h-10 w-10 opacity-70" />
              <div className="text-xs tracking-wide text-ink-100/50">
                Connect. Command. Convey.
              </div>
              <div className="text-[11px] text-ink-100/30">
                选择左侧服务器建立 SSH 连接
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

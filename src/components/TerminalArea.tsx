import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { TerminalView } from "./TerminalView";
import { sshDisconnect } from "../hooks/useSshSession";

export function TerminalArea() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const openConnectDialog = useAppStore((s) => s.openConnectDialog);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const pendingTab = tabs.find((t) => t.id === pendingCloseId) ?? null;

  const requestClose = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.connected && tab.sessionId) {
      setPendingCloseId(id);
    } else {
      closeTab(id);
    }
  };

  const confirmClose = async () => {
    if (!pendingTab) return;
    const id = pendingTab.id;
    setPendingCloseId(null);
    if (pendingTab.sessionId) {
      try {
        await sshDisconnect(pendingTab.sessionId);
      } catch (e) {
        console.error("断开会话失败", e);
      }
    }
    closeTab(id);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div
        data-tauri-drag-region
        className="flex items-center gap-0.5 border-b border-black/[0.06] px-2 py-1.5 dark:border-white/[0.06]"
      >
        {tabs.length === 0 ? (
          <span className="px-2 py-1 text-xs text-ink-500 dark:text-ink-400">
            尚未打开任何终端
          </span>
        ) : (
          tabs.map((t) => {
            const active = activeTabId === t.id;
            return (
              <div
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`group flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all ${
                  active
                    ? "bg-white/80 text-ink-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:bg-white/10 dark:text-ink-100 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(255,255,255,0.08)]"
                    : "text-ink-500 hover:bg-black/[0.04] hover:text-ink-800 dark:text-ink-400 dark:hover:bg-white/[0.05] dark:hover:text-ink-100"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    t.connected
                      ? "bg-accent-500 shadow-[0_0_8px_rgba(0,200,160,0.7)]"
                      : "bg-ink-400/60 dark:bg-ink-500/60"
                  }`}
                />
                <span className="max-w-[160px] truncate">{t.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    requestClose(t.id);
                  }}
                  className={`grid h-4 w-4 place-items-center rounded-md transition-all hover:bg-black/10 dark:hover:bg-white/15 ${
                    active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60"
                  }`}
                  aria-label="关闭"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="m3 3 6 6M9 3l-6 6" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden font-mono text-sm">
        {activeTab && activeTab.sessionId ? (
          <TerminalView tab={activeTab} />
        ) : (
          <WelcomeScreen onNew={() => openConnectDialog(null)} />
        )}
      </div>

      {pendingTab && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-md"
          onClick={() => setPendingCloseId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[340px] rounded-2xl border border-black/5 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/95"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-red-500/10 text-red-500">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10 6v4M10 14h.01" />
                  <circle cx="10" cy="10" r="7.5" />
                </svg>
              </div>
              <div className="text-[15px] font-semibold text-ink-900 dark:text-ink-100">
                关闭连接？
              </div>
            </div>
            <div className="mb-5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              <span className="font-medium text-ink-800 dark:text-ink-200">{pendingTab.title}</span>{" "}
              仍处于连接状态，关闭后将断开 SSH 会话。
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingCloseId(null)}
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5"
              >
                取消
              </button>
              <button
                onClick={() => void confirmClose()}
                className="rounded-lg bg-red-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-600 hover:shadow-md active:scale-[0.98]"
              >
                断开并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function WelcomeScreen({ onNew }: { onNew: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-linear-to-br from-ink-950 via-ink-900 to-ink-850 text-ink-100/80">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(0,87,255,0.18) 0%, transparent 45%), radial-gradient(circle at 70% 80%, rgba(0,200,160,0.14) 0%, transparent 45%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-linear-to-br from-brand-500 to-accent-500 opacity-40 blur-xl" />
          <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-accent-500 shadow-lg">
            <img src="/spoke-logo.svg" alt="" className="h-8 w-8 brightness-0 invert" />
          </div>
        </div>
        <div className="text-center">
          <div className="mb-1 text-xl font-semibold tracking-tight text-white">
            Spoke
          </div>
          <div className="text-xs tracking-[0.2em] text-ink-100/40">
            CONNECT · COMMAND · CONVEY
          </div>
        </div>
        <button
          onClick={onNew}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/90 backdrop-blur transition-all hover:bg-white/10 hover:shadow-md"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 4v12M4 10h12" />
          </svg>
          新建连接
        </button>
        <div className="text-[11px] text-ink-100/30">
          或双击左侧服务器快速连接
        </div>
      </div>
    </div>
  );
}

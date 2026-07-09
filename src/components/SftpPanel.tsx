import { useAppStore } from "../store/appStore";

export function SftpPanel() {
  const collapsed = useAppStore((s) => s.sftpPanelCollapsed);
  const toggle = useAppStore((s) => s.toggleSftpPanel);

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-black/5 bg-white/70 backdrop-blur dark:border-white/5 dark:bg-ink-800/60">
      <div className="flex items-center justify-between border-b border-black/5 px-3 py-1.5 text-xs dark:border-white/5">
        <div className="flex items-center gap-2 font-medium text-ink-800 dark:text-ink-100">
          <span>📂 SFTP 文件管理器</span>
          <span className="text-ink-600/60 dark:text-ink-100/40">
            [本地] ~ / [远程] 未连接
          </span>
        </div>
        <button
          onClick={toggle}
          className="rounded px-2 py-0.5 text-ink-600 hover:bg-black/5 dark:text-ink-100/70 dark:hover:bg-white/5"
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {!collapsed && (
        <div className="grid flex-1 min-h-0 grid-cols-2 divide-x divide-black/5 dark:divide-white/5">
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-black/5 px-3 py-1 text-[11px] text-ink-600/70 dark:border-white/5 dark:text-ink-100/50">
              本地 · /Users/xxx/
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 text-xs text-ink-800/70 dark:text-ink-100/70">
              <div>├── src/</div>
              <div>├── package.json</div>
              <div>└── ...</div>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-black/5 px-3 py-1 text-[11px] text-ink-600/70 dark:border-white/5 dark:text-ink-100/50">
              远程 · 未连接
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 text-xs text-ink-600/50 dark:text-ink-100/40">
              建立 SSH 连接后自动加载
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

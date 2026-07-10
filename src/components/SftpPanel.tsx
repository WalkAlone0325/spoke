import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";
import {
  joinLocal,
  joinRemote,
  localHome,
  localList,
  parentLocal,
  parentRemote,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpUpload,
  type LocalEntry,
  type RemoteEntry,
  type TransferProgress,
} from "../hooks/useSftp";

type Transfer = {
  id: string;
  direction: "upload" | "download";
  name: string;
  transferred: number;
  total?: number | null;
  done: boolean;
  error?: string;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function EntryIcon({ kind }: { kind: string }) {
  if (kind === "dir")
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-brand-500" fill="currentColor">
        <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.379a1.5 1.5 0 0 1 1.06.44L9.5 5.5h7A1.5 1.5 0 0 1 18 7v7.5A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5z" />
      </svg>
    );
  if (kind === "symlink")
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-accent-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.83-2.83a3 3 0 0 0-4.24-4.24l-.71.71" />
        <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.83 2.83a3 3 0 0 0 4.24 4.24l.71-.71" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-ink-500 dark:text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h7l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M12 2v4h4" />
    </svg>
  );
}

export function SftpPanel() {
  const collapsed = useAppStore((s) => s.sftpPanelCollapsed);
  const toggle = useAppStore((s) => s.toggleSftpPanel);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const remoteCwdMap = useAppStore((s) => s.remoteCwd);
  const localCwd = useAppStore((s) => s.localCwd);
  const setRemoteCwd = useAppStore((s) => s.setRemoteCwd);
  const setLocalCwd = useAppStore((s) => s.setLocalCwd);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const sessionId = activeTab?.sessionId ?? null;
  const remoteCwd = sessionId ? remoteCwdMap[sessionId] ?? "" : "";

  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  useEffect(() => {
    if (!localCwd) {
      localHome().then(setLocalCwd).catch(() => setLocalCwd("/"));
    }
  }, [localCwd, setLocalCwd]);

  useEffect(() => {
    if (!localCwd) return;
    localList(localCwd)
      .then(setLocalEntries)
      .catch((e) => console.error("本地列表失败", e));
  }, [localCwd]);

  useEffect(() => {
    if (!sessionId) {
      setRemoteEntries([]);
      setRemoteError(null);
      return;
    }
    if (!remoteCwd) {
      sftpHome(sessionId)
        .then((home) => setRemoteCwd(sessionId, home || "/"))
        .catch((e) => setRemoteError(String(e)));
    }
  }, [sessionId, remoteCwd, setRemoteCwd]);

  const refreshRemote = useCallback(async () => {
    if (!sessionId || !remoteCwd) return;
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const list = await sftpList(sessionId, remoteCwd);
      setRemoteEntries(list);
    } catch (e) {
      setRemoteError(String(e));
      setRemoteEntries([]);
    } finally {
      setRemoteLoading(false);
    }
  }, [sessionId, remoteCwd]);

  useEffect(() => {
    void refreshRemote();
  }, [refreshRemote]);

  useEffect(() => {
    let un: UnlistenFn | null = null;
    listen<TransferProgress>("sftp://progress", (e) => {
      const { transferId, transferred, total } = e.payload;
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? { ...t, transferred, total: total ?? t.total }
            : t,
        ),
      );
    }).then((u) => (un = u));
    return () => {
      un?.();
    };
  }, []);

  const enterRemote = (entry: RemoteEntry) => {
    if (!sessionId) return;
    if (entry.kind === "dir" || entry.kind === "symlink") {
      setRemoteCwd(sessionId, joinRemote(remoteCwd, entry.name));
    }
  };

  const upRemote = () => {
    if (!sessionId || !remoteCwd) return;
    setRemoteCwd(sessionId, parentRemote(remoteCwd));
  };

  const enterLocal = (entry: LocalEntry) => {
    if (entry.kind === "dir" || entry.kind === "symlink") {
      setLocalCwd(joinLocal(localCwd, entry.name));
    }
  };

  const upLocal = () => setLocalCwd(parentLocal(localCwd));

  const handleUpload = async () => {
    if (!sessionId || !remoteCwd) return;
    const picked = await open({ multiple: true, directory: false });
    if (!picked) return;
    const files = Array.isArray(picked) ? picked : [picked];
    for (const file of files) {
      const name = file.split(/[\\/]/).pop() ?? "upload";
      const id = crypto.randomUUID();
      const remotePath = joinRemote(remoteCwd, name);
      setTransfers((prev) => [
        ...prev,
        { id, direction: "upload", name, transferred: 0, done: false },
      ]);
      try {
        const total = await sftpUpload(sessionId, file, remotePath, id);
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, transferred: total, total, done: true } : t,
          ),
        );
        void refreshRemote();
      } catch (e) {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, done: true, error: String(e) } : t,
          ),
        );
      }
    }
  };

  const handleDownload = async (entry: RemoteEntry) => {
    if (!sessionId) return;
    if (entry.kind !== "file") return;
    const target = await save({ defaultPath: joinLocal(localCwd, entry.name) });
    if (!target) return;
    const id = crypto.randomUUID();
    setTransfers((prev) => [
      ...prev,
      {
        id,
        direction: "download",
        name: entry.name,
        transferred: 0,
        total: entry.size,
        done: false,
      },
    ]);
    try {
      const total = await sftpDownload(sessionId, entry.path, target, id);
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, transferred: total, total, done: true } : t,
        ),
      );
      void localList(localCwd).then(setLocalEntries).catch(() => {});
    } catch (e) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, done: true, error: String(e) } : t,
        ),
      );
    }
  };

  const clearFinished = () =>
    setTransfers((prev) => prev.filter((t) => !t.done && !t.error));

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-black/[0.06] px-3 py-1.5 dark:border-white/[0.06]"
      >
        <div className="flex items-center gap-2 text-xs">
          <div className="grid h-5 w-5 place-items-center rounded-md bg-linear-to-br from-brand-500/15 to-accent-500/15">
            <svg viewBox="0 0 20 20" className="h-3 w-3 text-brand-500" fill="currentColor">
              <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.379a1.5 1.5 0 0 1 1.06.44L9.5 5.5h7A1.5 1.5 0 0 1 18 7v7.5A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5z" />
            </svg>
          </div>
          <span className="font-medium text-ink-800 dark:text-ink-100">
            文件管理器
          </span>
          {sessionId ? (
            <span className="rounded-full bg-accent-500/10 px-2 py-[1px] text-[10px] font-medium text-accent-500">
              已连接
            </span>
          ) : (
            <span className="rounded-full bg-ink-500/10 px-2 py-[1px] text-[10px] font-medium text-ink-500 dark:text-ink-400">
              未连接
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={handleUpload}
            disabled={!sessionId}
            title="上传文件"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v10M5 8l5-5 5 5M4 17h12" />
            </svg>
          </IconButton>
          <IconButton
            onClick={() => void refreshRemote()}
            disabled={!sessionId}
            title="刷新"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10a7 7 0 0 1 12-4.9L17 7M17 3v4h-4M17 10a7 7 0 0 1-12 4.9L3 13M3 17v-4h4" />
            </svg>
          </IconButton>
          <div className="mx-1 h-4 w-px bg-black/[0.08] dark:bg-white/[0.1]" />
          <IconButton onClick={toggle} title={collapsed ? "展开" : "收起"}>
            <svg
              viewBox="0 0 20 20"
              className={`h-3.5 w-3.5 transition-transform ${
                collapsed ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 8 4 4 4-4" />
            </svg>
          </IconButton>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="grid flex-1 min-h-0 grid-cols-2 divide-x divide-black/5 dark:divide-white/5">
            <LocalColumn
              cwd={localCwd}
              entries={localEntries}
              onUp={upLocal}
              onEnter={enterLocal}
              onNav={setLocalCwd}
            />
            <RemoteColumn
              connected={!!sessionId}
              loading={remoteLoading}
              error={remoteError}
              cwd={remoteCwd}
              entries={remoteEntries}
              onUp={upRemote}
              onEnter={enterRemote}
              onDownload={handleDownload}
              onNav={(p) => sessionId && setRemoteCwd(sessionId, p)}
            />
          </div>

          {transfers.length > 0 && (
            <TransferBar transfers={transfers} onClear={clearFinished} />
          )}
        </>
      )}
    </section>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="grid h-6 w-6 place-items-center rounded-md text-ink-600 transition-colors hover:bg-black/5 hover:text-ink-900 disabled:opacity-40 disabled:hover:bg-transparent dark:text-ink-300 dark:hover:bg-white/10 dark:hover:text-ink-100"
    >
      {children}
    </button>
  );
}

function Breadcrumbs({
  cwd,
  isLocal,
  onNav,
}: {
  cwd: string;
  isLocal: boolean;
  onNav: (path: string) => void;
}) {
  const parts = useMemo(() => {
    if (!cwd) return [] as { name: string; path: string }[];
    if (isLocal) {
      const isWin = cwd.includes("\\") && !cwd.includes("/");
      const sep = isWin ? "\\" : "/";
      const clean = cwd.replace(/[\\/]+$/, "");
      const segments = clean.split(new RegExp(isWin ? "\\\\" : "/")).filter(Boolean);
      let acc = isWin ? "" : "/";
      return segments.map((seg) => {
        acc = isWin
          ? acc
            ? `${acc}${sep}${seg}`
            : seg
          : `${acc === "/" ? "" : acc}${sep}${seg}`;
        return { name: seg, path: acc };
      });
    }
    const segments = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
    let acc = "";
    return segments.map((seg) => {
      acc = `${acc}/${seg}`;
      return { name: seg, path: acc };
    });
  }, [cwd, isLocal]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[11px] text-ink-600 dark:text-ink-300">
      <button
        onClick={() => onNav(isLocal ? "/" : "/")}
        className="rounded px-1 hover:bg-black/5 dark:hover:bg-white/10"
      >
        {isLocal ? "~" : "/"}
      </button>
      {parts.map((p, i) => (
        <span key={p.path} className="flex items-center gap-0.5">
          <span className="text-ink-400 dark:text-ink-500">/</span>
          <button
            onClick={() => onNav(p.path)}
            className={`truncate rounded px-1 hover:bg-black/5 dark:hover:bg-white/10 ${
              i === parts.length - 1 ? "font-medium text-ink-900 dark:text-ink-100" : ""
            }`}
          >
            {p.name}
          </button>
        </span>
      ))}
    </div>
  );
}

function LocalColumn({
  cwd,
  entries,
  onUp,
  onEnter,
  onNav,
}: {
  cwd: string;
  entries: LocalEntry[];
  onUp: () => void;
  onEnter: (e: LocalEntry) => void;
  onNav: (p: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 12,
  });
  return (
    <div className="flex min-h-0 flex-col">
      <PathBar label="本地" cwd={cwd} onUp={onUp} onNav={onNav} isLocal />
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const item = entries[row.index];
            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${row.start}px)`,
                  height: row.size,
                }}
                onDoubleClick={() => onEnter(item)}
                className="group flex cursor-pointer items-center gap-2 px-3 text-xs transition-colors hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
              >
                <EntryIcon kind={item.kind} />
                <span className="flex-1 truncate">{item.name}</span>
                {item.kind === "file" && (
                  <span className="text-[10px] tabular-nums text-ink-500 dark:text-ink-400">
                    {formatSize(item.size)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RemoteColumn({
  connected,
  loading,
  error,
  cwd,
  entries,
  onUp,
  onEnter,
  onDownload,
  onNav,
}: {
  connected: boolean;
  loading: boolean;
  error: string | null;
  cwd: string;
  entries: RemoteEntry[];
  onUp: () => void;
  onEnter: (e: RemoteEntry) => void;
  onDownload: (e: RemoteEntry) => void;
  onNav: (p: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 12,
  });

  const body = useMemo(() => {
    if (!connected)
      return (
        <EmptyHint icon="🔌" text="建立 SSH 连接后自动加载" />
      );
    if (error)
      return (
        <div className="p-3 text-xs text-red-500 dark:text-red-400">{error}</div>
      );
    if (loading && entries.length === 0)
      return <EmptyHint icon="⏳" text="加载中…" />;
    if (entries.length === 0)
      return <EmptyHint icon="📭" text="空目录" />;
    return (
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const item = entries[row.index];
            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${row.start}px)`,
                  height: row.size,
                }}
                onDoubleClick={() => onEnter(item)}
                className="group flex cursor-pointer items-center gap-2 px-3 text-xs transition-colors hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
              >
                <EntryIcon kind={item.kind} />
                <span className="flex-1 truncate">{item.name}</span>
                {item.kind === "file" && (
                  <>
                    <span className="text-[10px] tabular-nums text-ink-500 dark:text-ink-400">
                      {formatSize(item.size)}
                    </span>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onDownload(item);
                      }}
                      className="grid h-5 w-5 place-items-center rounded text-ink-500 opacity-0 transition-opacity hover:bg-black/10 hover:text-brand-500 group-hover:opacity-100 dark:hover:bg-white/10"
                      title="下载"
                    >
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 3v10M5 12l5 5 5-5M4 17h12" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [connected, error, loading, entries, rowVirtualizer, onEnter, onDownload]);

  return (
    <div className="flex min-h-0 flex-col">
      <PathBar
        label="远程"
        cwd={cwd || "…"}
        onUp={onUp}
        onNav={onNav}
        disabled={!connected}
      />
      {body}
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-ink-500 dark:text-ink-400">
      <div className="text-2xl opacity-70">{icon}</div>
      <div className="text-xs">{text}</div>
    </div>
  );
}

function PathBar({
  label,
  cwd,
  onUp,
  onNav,
  disabled = false,
  isLocal = false,
}: {
  label: string;
  cwd: string;
  onUp: () => void;
  onNav: (p: string) => void;
  disabled?: boolean;
  isLocal?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-2 py-1 text-[11px] dark:border-white/[0.06]">
      <span className="rounded-md bg-black/[0.06] px-1.5 py-[1px] text-[10px] font-medium text-ink-600 dark:bg-white/[0.08] dark:text-ink-300">
        {label}
      </span>
      <button
        onClick={onUp}
        disabled={disabled}
        className="grid h-5 w-5 place-items-center rounded text-ink-500 transition-colors hover:bg-black/5 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
        title="上级目录"
      >
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5-5 5 5" />
        </svg>
      </button>
      <Breadcrumbs cwd={cwd} isLocal={isLocal} onNav={onNav} />
    </div>
  );
}

function TransferBar({
  transfers,
  onClear,
}: {
  transfers: Transfer[];
  onClear: () => void;
}) {
  return (
    <div className="max-h-32 overflow-auto border-t border-black/[0.06] px-3 py-1.5 text-[11px] dark:border-white/[0.06]">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 10h12M4 10l4-4M4 10l4 4M16 10l-4 4M16 10l-4-4" />
          </svg>
          <span>传输队列</span>
          <span className="rounded-full bg-black/5 px-1.5 py-[1px] text-[9px] dark:bg-white/10">
            {transfers.length}
          </span>
        </div>
        <button
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-black/5 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
        >
          清空已完成
        </button>
      </div>
      <div className="space-y-1">
        {transfers.map((t) => {
          const pct =
            t.total && t.total > 0
              ? Math.min(100, Math.round((t.transferred / t.total) * 100))
              : t.done
                ? 100
                : 0;
          return (
            <div key={t.id} className="flex items-center gap-2">
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded ${
                  t.direction === "upload"
                    ? "bg-brand-500/10 text-brand-500"
                    : "bg-accent-500/10 text-accent-500"
                }`}
              >
                <svg
                  viewBox="0 0 20 20"
                  className={`h-2.5 w-2.5 ${
                    t.direction === "download" ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                >
                  <path d="M10 4v12M5 9l5-5 5 5" />
                </svg>
              </span>
              <span className="flex-1 truncate" title={t.name}>
                {t.name}
              </span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div
                  className={`h-full transition-all duration-150 ${
                    t.error
                      ? "bg-red-500"
                      : t.done
                        ? "bg-accent-500"
                        : "bg-linear-to-r from-brand-500 to-accent-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={`w-14 text-right tabular-nums ${
                  t.error
                    ? "text-red-500"
                    : t.done
                      ? "text-accent-500"
                      : "text-ink-500 dark:text-ink-400"
                }`}
              >
                {t.error ? "失败" : t.done ? "完成" : `${pct}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

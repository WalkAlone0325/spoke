import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useAppStore } from "../store/appStore";
import { sshSendData } from "./../hooks/useSshSession";
import {
  joinLocal,
  joinRemote,
  localHome,
  localIsDir,
  localList,
  localStat,
  editTempPath,
  parentLocal,
  parentRemote,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpRemove,
  sftpUpload,
  sftpUploadDir,
  type LocalEntry,
  type RemoteEntry,
  type TransferProgress,
} from "../hooks/useSftp";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

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

function EntryIcon({ kind, name = "" }: { kind: string; name?: string }) {
  const hidden = name.startsWith(".");
  if (kind === "dir")
    return (
      <svg
        viewBox="0 0 20 20"
        className={`h-3.5 w-3.5 shrink-0 ${hidden ? "text-brand-500/40" : "text-brand-500"}`}
        fill="currentColor"
      >
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
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 ${hidden ? "text-ink-500/50 dark:text-ink-400/50" : "text-ink-500 dark:text-ink-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
  const sessionId = activeTab?.connected ? activeTab.sessionId ?? null : null;
  const remoteCwd = sessionId ? remoteCwdMap[sessionId] ?? "" : "";

  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());
  const [innerDragOver, setInnerDragOver] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingFiles, setEditingFiles] = useState<Record<string, { localPath: string; mtime: number }>>({});
  const [pendingUpload, setPendingUpload] = useState<{ remotePath: string; localPath: string; sessionId: string } | null>(null);

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

  const uploadFiles = useCallback(
    async (paths: string[]) => {
      if (!sessionId || !remoteCwd) return;
      for (const p of paths) {
        const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "upload";
        const id = crypto.randomUUID();
        const remotePath = joinRemote(remoteCwd, name);
        let isDir = false;
        try {
          isDir = await localIsDir(p);
        } catch {}
        setTransfers((prev) => [
          ...prev,
          {
            id,
            direction: "upload",
            name: isDir ? `${name}/` : name,
            transferred: 0,
            done: false,
          },
        ]);
        try {
          const total = isDir
            ? await sftpUploadDir(sessionId, p, remotePath, id)
            : await sftpUpload(sessionId, p, remotePath, id);
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
    },
    [sessionId, remoteCwd, refreshRemote],
  );

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

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    (async () => {
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const zone = dropZoneRef.current;
        if (!zone) return;
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          const { x, y } = payload.position;
          const rect = zone.getBoundingClientRect();
          const inside =
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          setDragOver(inside);
        } else if (payload.type === "drop") {
          const { x, y } = payload.position;
          const rect = zone.getBoundingClientRect();
          const inside =
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          setDragOver(false);
          if (inside && payload.paths.length > 0) {
            void uploadFiles(payload.paths);
          }
        } else {
          setDragOver(false);
        }
      });
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [uploadFiles]);

  useEffect(() => {
    if (Object.keys(editingFiles).length === 0) return;
    const timer = setInterval(async () => {
      for (const [remotePath, info] of Object.entries(editingFiles)) {
        try {
          const stat = await localStat(info.localPath);
          if (stat && stat.modified && stat.modified > info.mtime) {
            const tab = tabs.find((t) => t.connected && t.sessionId);
            if (tab?.sessionId) {
              setPendingUpload({ remotePath, localPath: info.localPath, sessionId: tab.sessionId });
            }
          }
        } catch {}
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [editingFiles, tabs]);

  const enterRemote = (entry: RemoteEntry) => {
    if (!sessionId) return;
    if (entry.kind === "dir" || entry.kind === "symlink") {
      setRemoteCwd(sessionId, joinRemote(remoteCwd, entry.name));
      setRemoteSelected(new Set());
    }
  };

  const upRemote = () => {
    if (!sessionId || !remoteCwd) return;
    setRemoteCwd(sessionId, parentRemote(remoteCwd));
    setRemoteSelected(new Set());
  };

  const enterLocal = (entry: LocalEntry) => {
    if (entry.kind === "dir" || entry.kind === "symlink") {
      setLocalCwd(joinLocal(localCwd, entry.name));
      setLocalSelected(new Set());
    }
  };

  const upLocal = () => setLocalCwd(parentLocal(localCwd));

  const handleUpload = async () => {
    if (!sessionId || !remoteCwd) return;
    const picked = await open({ multiple: true, directory: false });
    if (!picked) return;
    const files = Array.isArray(picked) ? picked : [picked];
    await uploadFiles(files);
  };

  const handleUploadDir = async () => {
    if (!sessionId || !remoteCwd) return;
    const picked = await open({ multiple: false, directory: true });
    if (!picked) return;
    await uploadFiles([picked as string]);
  };

  const openUploadMenu = (e: React.MouseEvent) => {
    if (!sessionId || !remoteCwd) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        {
          label: "选择文件…",
          onClick: () => void handleUpload(),
        },
        {
          label: "选择目录…",
          onClick: () => void handleUploadDir(),
        },
      ],
    });
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

  const openRemoteMenu = (e: React.MouseEvent, entry: RemoteEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sessionId) return;
    let targets: RemoteEntry[];
    if (remoteSelected.has(entry.path) && remoteSelected.size > 1) {
      const set = remoteSelected;
      targets = remoteEntries.filter((r) => set.has(r.path));
    } else {
      targets = [entry];
      setRemoteSelected(new Set([entry.path]));
    }
    const multi = targets.length > 1;
    const items: ContextMenuItem[] = [];
    if (!multi) {
      if (entry.kind === "dir") {
        items.push({
          label: "打开",
          onClick: () => enterRemote(entry),
        });
        items.push({
          label: "在终端打开 (cd)",
          onClick: () => {
            void sshSendData(sessionId, `cd ${quoteShell(entry.path)}\n`);
          },
        });
      } else if (entry.kind === "file") {
        items.push({
          label: "下载…",
          onClick: () => void handleDownload(entry),
        });
        items.push({
          label: "在编辑器中打开",
          onClick: () => void handleEditInEditor(entry),
        });
      }
      items.push({
        label: "复制路径",
        onClick: () => void writeText(entry.path),
        separatorAfter: true,
      });
      items.push({
        label: "删除",
        danger: true,
        onClick: () => void handleRemove(entry),
      });
    } else {
      const paths = targets.map((t) => t.path);
      const fileCount = targets.filter((t) => t.kind === "file").length;
      items.push({
        label: `下载 ${fileCount} 个文件…`,
        disabled: fileCount === 0,
        onClick: () => void handleDownloadMany(targets),
      });
      items.push({
        label: "复制路径",
        onClick: () => void writeText(paths.join("\n")),
        separatorAfter: true,
      });
      items.push({
        label: `删除 ${paths.length} 项`,
        danger: true,
        onClick: () => void handleRemoveMany(paths),
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onRemoteRowClick = (e: React.MouseEvent, entry: RemoteEntry) => {
    if (e.metaKey || e.ctrlKey) {
      setRemoteSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
    } else if (e.shiftKey && remoteSelected.size > 0) {
      const last = [...remoteSelected].pop();
      const idxA = remoteEntries.findIndex((x) => x.path === last);
      const idxB = remoteEntries.findIndex((x) => x.path === entry.path);
      if (idxA >= 0 && idxB >= 0) {
        const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        setRemoteSelected(
          new Set(remoteEntries.slice(lo, hi + 1).map((x) => x.path)),
        );
      }
    } else {
      setRemoteSelected(new Set([entry.path]));
    }
  };

  const openRemoteBlankMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!sessionId || !remoteCwd) return;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "上传文件…",
          onClick: () => void handleUpload(),
        },
        {
          label: "上传目录…",
          onClick: () => void handleUploadDir(),
          separatorAfter: true,
        },
        {
          label: "刷新",
          onClick: () => void refreshRemote(),
        },
        {
          label: "复制当前路径",
          onClick: () => void writeText(remoteCwd),
        },
      ],
    });
  };

  const handleRemove = async (entry: RemoteEntry) => {
    if (!sessionId) return;
    if (!window.confirm(`确定删除「${entry.name}」？此操作不可恢复。`)) return;
    try {
      await sftpRemove(sessionId, entry.path);
      void refreshRemote();
    } catch (e) {
      console.error("删除失败", e);
    }
  };

  const handleRemoveMany = async (paths: string[]) => {
    if (!sessionId || paths.length === 0) return;
    if (
      !window.confirm(
        `确定删除选中的 ${paths.length} 项？此操作不可恢复。`,
      )
    )
      return;
    for (const p of paths) {
      try {
        await sftpRemove(sessionId, p);
      } catch (e) {
        console.error("删除失败", p, e);
      }
    }
    setRemoteSelected(new Set());
    void refreshRemote();
  };

  const handleEditInEditor = async (entry: RemoteEntry) => {
    if (!sessionId || entry.kind !== "file") return;
    try {
      const localPath = await editTempPath(entry.name);
      const id = crypto.randomUUID();
      await sftpDownload(sessionId, entry.path, localPath, id);
      const stat = await localStat(localPath);
      if (!stat?.modified) { setEditError("文件下载后无法获取修改时间"); return; }
      setEditingFiles((prev) => ({ ...prev, [entry.path]: { localPath, mtime: stat.modified! } }));
      await openPath(localPath);
    } catch (e) {
      setEditError(String(e));
    }
  };

  const handleConfirmUpload = async () => {
    if (!pendingUpload) return;
    const { remotePath, localPath, sessionId: sid } = pendingUpload;
    setPendingUpload(null);
    const id = crypto.randomUUID();
    try {
      await sftpUpload(sid, localPath, remotePath, id);
      const stat = await localStat(localPath);
      setEditingFiles((prev) => {
        const next = { ...prev };
        if (stat?.modified) {
          next[remotePath] = { localPath, mtime: stat.modified };
        } else {
          delete next[remotePath];
        }
        return next;
      });
    } catch (e) {
      console.error("上传失败", e);
    }
  };

  const handleDownloadMany = async (entries: RemoteEntry[]) => {
    if (!sessionId) return;
    const files = entries.filter((e) => e.kind === "file");
    const skipped = entries.length - files.length;
    if (files.length === 0) {
      if (skipped > 0) window.alert("目录批量下载暂未支持");
      return;
    }
    const dir = await open({ directory: true, multiple: false });
    if (!dir) return;
    for (const entry of files) {
      const id = crypto.randomUUID();
      const target = joinLocal(dir as string, entry.name);
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
      } catch (e) {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, done: true, error: String(e) } : t,
          ),
        );
      }
    }
    void localList(localCwd).then(setLocalEntries).catch(() => {});
    if (skipped > 0) window.alert(`已跳过 ${skipped} 个目录（暂未支持递归下载）`);
  };

  const uploadSelected = () => {
    if (!sessionId || localSelected.size === 0) return;
    void uploadFiles(Array.from(localSelected));
  };

  const openLocalMenu = (e: React.MouseEvent, entry: LocalEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const isSelected = localSelected.has(entry.path);
    let targets: string[];
    if (isSelected && localSelected.size > 1) {
      targets = Array.from(localSelected);
    } else {
      targets = [entry.path];
      setLocalSelected(new Set([entry.path]));
    }
    const label =
      targets.length > 1 ? `上传 ${targets.length} 项到远程` : `上传到远程`;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label,
          disabled: !sessionId,
          onClick: () => void uploadFiles(targets),
        },
        {
          label: "复制路径",
          onClick: () => void writeText(targets.join("\n")),
        },
      ],
    });
  };

  const onLocalRowClick = (e: React.MouseEvent, entry: LocalEntry) => {
    if (e.metaKey || e.ctrlKey) {
      setLocalSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
    } else if (e.shiftKey && localSelected.size > 0) {
      const last = [...localSelected].pop();
      const idxA = localEntries.findIndex((x) => x.path === last);
      const idxB = localEntries.findIndex((x) => x.path === entry.path);
      if (idxA >= 0 && idxB >= 0) {
        const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        setLocalSelected(
          new Set(localEntries.slice(lo, hi + 1).map((x) => x.path)),
        );
      }
    } else {
      setLocalSelected(new Set([entry.path]));
    }
  };

  const onLocalDragStart = (e: React.DragEvent, entry: LocalEntry) => {
    let paths: string[];
    if (localSelected.has(entry.path) && localSelected.size > 1) {
      paths = Array.from(localSelected);
    } else {
      paths = [entry.path];
      setLocalSelected(new Set([entry.path]));
    }
    e.dataTransfer.setData("application/x-spoke-local", JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "copy";
  };

  const onRemoteDragOver = (e: React.DragEvent) => {
    if (!sessionId) return;
    if (!e.dataTransfer.types.includes("application/x-spoke-local")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!innerDragOver) setInnerDragOver(true);
  };

  const onRemoteDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setInnerDragOver(false);
  };

  const onRemoteDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-spoke-local");
    setInnerDragOver(false);
    if (!raw || !sessionId) return;
    e.preventDefault();
    try {
      const paths = JSON.parse(raw) as string[];
      if (Array.isArray(paths) && paths.length > 0) {
        void uploadFiles(paths);
      }
    } catch {}
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-black/[0.06] px-3 py-1.5 dark:border-white/[0.06]"
      >
        <div className="flex items-center gap-2 text-sm">
          <div className="grid h-5 w-5 place-items-center rounded-md bg-linear-to-br from-brand-500/15 to-accent-500/15">
            <svg viewBox="0 0 20 20" className="h-3 w-3 text-brand-500" fill="currentColor">
              <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.379a1.5 1.5 0 0 1 1.06.44L9.5 5.5h7A1.5 1.5 0 0 1 18 7v7.5A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5z" />
            </svg>
          </div>
          <span className="font-medium text-ink-800 dark:text-ink-100">
            文件管理器
          </span>
          {sessionId ? (
            <span className="rounded-full bg-accent-500/10 px-2 py-[1px] text-[11px] font-medium text-accent-500">
              已连接
            </span>
          ) : (
            <span className="rounded-full bg-ink-500/10 px-2 py-[1px] text-[11px] font-medium text-ink-500 dark:text-ink-400">
              未连接
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={openUploadMenu}
            disabled={!sessionId}
            title="上传（文件或目录）"
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
              selected={localSelected}
              onRowClick={onLocalRowClick}
              onRowContextMenu={openLocalMenu}
              onDragStart={onLocalDragStart}
              connected={!!sessionId}
              uploadSelected={uploadSelected}
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
              onEntryContextMenu={openRemoteMenu}
              onBlankContextMenu={openRemoteBlankMenu}
              dropRef={dropZoneRef}
              dragOver={dragOver}
              innerDragOver={innerDragOver}
              onInnerDragOver={onRemoteDragOver}
              onInnerDragLeave={onRemoteDragLeave}
              onInnerDrop={onRemoteDrop}
              selected={remoteSelected}
              onRowClick={onRemoteRowClick}
              onBatchDownload={() =>
                void handleDownloadMany(
                  remoteEntries.filter((r) => remoteSelected.has(r.path)),
                )
              }
              onBatchRemove={() =>
                void handleRemoveMany(Array.from(remoteSelected))
              }
            />
          </div>

          {transfers.length > 0 && (
            <TransferBar transfers={transfers} onClear={clearFinished} />
          )}
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}

      {editError && (
        <div className="absolute bottom-2 right-2 z-50 max-w-xs rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600 shadow-lg backdrop-blur dark:text-red-400">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">✕</span>
            <span className="break-all">{editError}</span>
            <button onClick={() => setEditError(null)} className="shrink-0 ml-2 text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      {pendingUpload && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-md"
          onClick={() => setPendingUpload(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[360px] rounded-2xl border border-black/5 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/95"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-accent-500/10 text-accent-500">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 3v10M5 8l5-5 5 5M4 17h12" />
                </svg>
              </div>
              <div className="text-[15px] font-semibold text-ink-900 dark:text-ink-100">
                文件已修改
              </div>
            </div>
            <div className="mb-5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              <span className="break-all font-medium text-ink-800 dark:text-ink-200">
                {pendingUpload.remotePath}
              </span>
              <br />
              检测到本地修改，是否上传到远程服务器？
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingUpload(null)}
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5"
              >
                不上传
              </button>
              <button
                onClick={() => void handleConfirmUpload()}
                className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-md active:scale-[0.98]"
              >
                上传
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function quoteShell(path: string): string {
  if (!/[\s"'`\\$&|;()<>*?]/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
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
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs text-ink-600 dark:text-ink-300">
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
  selected,
  onRowClick,
  onRowContextMenu,
  onDragStart,
  connected,
  uploadSelected,
}: {
  cwd: string;
  entries: LocalEntry[];
  onUp: () => void;
  onEnter: (e: LocalEntry) => void;
  onNav: (p: string) => void;
  selected: Set<string>;
  onRowClick: (e: React.MouseEvent, entry: LocalEntry) => void;
  onRowContextMenu: (e: React.MouseEvent, entry: LocalEntry) => void;
  onDragStart: (e: React.DragEvent, entry: LocalEntry) => void;
  connected: boolean;
  uploadSelected: () => void;
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
      <PathBar
        label="本地"
        cwd={cwd}
        onUp={onUp}
        onNav={onNav}
        isLocal
        extra={
          selected.size > 0 && connected ? (
            <button
              onClick={uploadSelected}
              className="ml-auto flex items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-[1px] text-[11px] font-medium text-brand-500 transition-colors hover:bg-brand-500/20"
            >
              <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M10 3v10M5 8l5-5 5 5" />
              </svg>
              上传 ({selected.size})
            </button>
          ) : null
        }
      />
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const item = entries[row.index];
            const isSel = selected.has(item.path);
            return (
              <div
                key={row.key}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${row.start}px)`,
                  height: row.size,
                }}
                onClick={(e) => onRowClick(e, item)}
                onDoubleClick={() => onEnter(item)}
                onContextMenu={(e) => onRowContextMenu(e, item)}
                className={`group flex cursor-pointer select-none items-center gap-2 px-3 text-sm transition-colors ${
                  isSel
                    ? "bg-brand-500/15 text-brand-500 dark:bg-brand-500/20"
                    : "hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
                }`}
              >
                <EntryIcon kind={item.kind} name={item.name} />
                <span className="flex-1 truncate">{item.name}</span>
                {item.kind === "file" && (
                  <span className="text-[11px] tabular-nums text-ink-500 dark:text-ink-400">
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
  onEntryContextMenu,
  onBlankContextMenu,
  dropRef,
  dragOver,
  innerDragOver,
  onInnerDragOver,
  onInnerDragLeave,
  onInnerDrop,
  selected,
  onRowClick,
  onBatchDownload,
  onBatchRemove,
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
  onEntryContextMenu: (e: React.MouseEvent, entry: RemoteEntry) => void;
  onBlankContextMenu: (e: React.MouseEvent) => void;
  dropRef: React.RefObject<HTMLDivElement | null>;
  dragOver: boolean;
  innerDragOver: boolean;
  onInnerDragOver: (e: React.DragEvent) => void;
  onInnerDragLeave: (e: React.DragEvent) => void;
  onInnerDrop: (e: React.DragEvent) => void;
  selected: Set<string>;
  onRowClick: (e: React.MouseEvent, entry: RemoteEntry) => void;
  onBatchDownload: () => void;
  onBatchRemove: () => void;
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
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "DIV") {
            const isRow = (e.target as HTMLElement).closest("[data-remote-row]");
            if (!isRow) onBlankContextMenu(e);
          }
        }}
      >
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const item = entries[row.index];
            const isSel = selected.has(item.path);
            return (
              <div
                key={row.key}
                data-remote-row
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${row.start}px)`,
                  height: row.size,
                }}
                onClick={(e) => onRowClick(e, item)}
                onDoubleClick={() => onEnter(item)}
                onContextMenu={(e) => onEntryContextMenu(e, item)}
                className={`group flex cursor-pointer select-none items-center gap-2 px-3 text-sm transition-colors ${
                  isSel
                    ? "bg-brand-500/15 text-brand-500 dark:bg-brand-500/20"
                    : "hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
                }`}
              >
                <EntryIcon kind={item.kind} name={item.name} />
                <span className="flex-1 truncate">{item.name}</span>
                {item.kind === "file" && (
                  <>
                    <span className="text-[11px] tabular-nums text-ink-500 dark:text-ink-400">
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
  }, [connected, error, loading, entries, rowVirtualizer, onEnter, onDownload, onEntryContextMenu, onBlankContextMenu]);

  return (
    <div
      ref={dropRef}
      className="relative flex min-h-0 flex-col"
      onContextMenu={onBlankContextMenu}
      onDragOver={onInnerDragOver}
      onDragLeave={onInnerDragLeave}
      onDrop={onInnerDrop}
    >
      <PathBar
        label="远程"
        cwd={cwd || "…"}
        onUp={onUp}
        onNav={onNav}
        disabled={!connected}
        extra={
          selected.size > 0 && connected ? (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={onBatchDownload}
                className="flex items-center gap-1 rounded-md bg-accent-500/10 px-1.5 py-[1px] text-[11px] font-medium text-accent-500 transition-colors hover:bg-accent-500/20"
                title="下载选中"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10 3v10M5 12l5 5 5-5" />
                </svg>
                下载 ({selected.size})
              </button>
              <button
                onClick={onBatchRemove}
                className="flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-[1px] text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                title="删除选中"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h12M8 5V3h4v2M6 5v12h8V5" />
                </svg>
                删除
              </button>
            </div>
          ) : null
        }
      />
      {body}
      {(dragOver || innerDragOver) && connected && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-brand-500/10 backdrop-blur-sm ring-2 ring-inset ring-brand-500/50">
          <div className="rounded-xl bg-white/90 px-4 py-2 text-xs font-medium text-brand-500 shadow-lg dark:bg-ink-800/90">
            释放以上传到 {cwd || "远程"}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-ink-500 dark:text-ink-400">
      <div className="text-2xl opacity-70">{icon}</div>
      <div className="text-sm">{text}</div>
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
  extra,
}: {
  label: string;
  cwd: string;
  onUp: () => void;
  onNav: (p: string) => void;
  disabled?: boolean;
  isLocal?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-2 py-1 text-xs dark:border-white/[0.06]">
      <span className="rounded-md bg-black/[0.06] px-1.5 py-[1px] text-[11px] font-medium text-ink-600 dark:bg-white/[0.08] dark:text-ink-300">
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
      {extra}
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
    <div className="max-h-32 overflow-auto border-t border-black/[0.06] px-3 py-1.5 text-xs dark:border-white/[0.06]">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-ink-700 dark:text-ink-200">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 10h12M4 10l4-4M4 10l4 4M16 10l-4 4M16 10l-4-4" />
          </svg>
          <span>传输队列</span>
          <span className="rounded-full bg-black/5 px-1.5 py-[1px] text-[10px] dark:bg-white/10">
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { localHome, localList, type LocalEntry } from "../hooks/useSftp";

export type FilePickerMode = "open-file" | "open-multi" | "open-dir" | "save-file";

export interface FilePickerDialogProps {
  open: boolean;
  mode: FilePickerMode;
  title?: string;
  defaultPath?: string;
  onClose: (result: string | string[] | null) => void;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function parentLocal(dir: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.replace(new RegExp(`${sep === "\\" ? "\\\\" : "/"}+$`), "");
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) return sep;
  return trimmed.slice(0, idx);
}

function joinLocal(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  if (name === "..") return parentLocal(dir);
  if (name === ".") return dir;
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function EntryIcon({ kind, name = "" }: { kind: string; name?: string }) {
  const hidden = name.startsWith(".");
  if (kind === "dir")
    return (
      <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 shrink-0 ${hidden ? "text-brand-500/40" : "text-brand-500"}`} fill="currentColor">
        <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.379a1.5 1.5 0 0 1 1.06.44L9.5 5.5h7A1.5 1.5 0 0 1 18 7v7.5A1.5 1.5 0 0 1 16.5 16h-13A1.5 1.5 0 0 1 2 14.5z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 shrink-0 ${hidden ? "text-ink-500/50 dark:text-ink-400/50" : "text-ink-500 dark:text-ink-400"}`} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h7l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M12 2v4h4" />
    </svg>
  );
}

export function FilePickerDialog({ open, mode, title, defaultPath, onClose }: FilePickerDialogProps) {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const home = await localHome();
      const initial = defaultPath ? parentLocal(defaultPath) : home;
      setCwd(initial);
      if (mode === "save-file" && defaultPath) {
        setSaveName(defaultPath.split(/[/\\]/).pop() || "");
      }
      setSelected(new Set());
    })();
  }, [open, mode, defaultPath]);

  useEffect(() => {
    if (!cwd) return;
    localList(cwd).then(setEntries).catch(() => setEntries([]));
  }, [cwd]);

  const canSelectDir = mode === "open-dir";
  const canSelectFile = mode !== "open-dir";
  const multi = mode === "open-multi";
  const isSave = mode === "save-file";
  const canConfirm = isSave
    ? saveName.trim().length > 0
    : canSelectDir
      ? selected.size > 0
      : selected.size > 0;

  const handleEnter = (entry: LocalEntry) => {
    if (entry.kind === "dir") {
      setCwd(joinLocal(cwd, entry.name));
      setSelected(new Set());
    }
  };

  const handleUp = () => {
    setCwd(parentLocal(cwd));
    setSelected(new Set());
  };

  const handleRowClick = (entry: LocalEntry) => {
    if (entry.kind === "dir") {
      if (canSelectDir && !multi) {
        setSelected(new Set([entry.path]));
      } else {
        handleEnter(entry);
      }
    } else if (canSelectFile) {
      if (multi) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        });
      } else {
        setSelected(new Set([entry.path]));
      }
    }
  };

  const handleConfirm = () => {
    if (isSave) {
      onClose(joinLocal(cwd, saveName.trim()));
    } else if (canSelectDir && selected.size > 0) {
      onClose(Array.from(selected));
    } else if (multi && selected.size > 0) {
      onClose(Array.from(selected));
    } else if (selected.size > 0) {
      onClose(Array.from(selected)[0]);
    }
    setSelected(new Set());
  };

  const handleCancel = () => {
    onClose(null);
    setSelected(new Set());
  };

  const rowVirtualizer = useVirtualizer({
    count: entries.length + 1,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 12,
  });

  const parts = useMemo(() => {
    if (!cwd) return [] as { name: string; path: string }[];
    const isWin = cwd.includes("\\") && !cwd.includes("/");
    const sep = isWin ? "\\" : "/";
    const clean = cwd.replace(/[\\/]+$/, "");
    const segments = clean.split(new RegExp(isWin ? "\\\\" : "/")).filter(Boolean);
    let acc = isWin ? "" : "/";
    return segments.map((seg) => {
      acc = isWin ? (acc ? `${acc}${sep}${seg}` : seg) : `${acc === "/" ? "" : acc}${sep}${seg}`;
      return { name: seg, path: acc };
    });
  }, [cwd]);

  return (
    <Dialog open={open} onClose={handleCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex w-full max-w-lg flex-col rounded-xl border border-black/5 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800" style={{ height: "70vh", maxHeight: 600 }}>
          <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
            <DialogTitle className="text-sm font-semibold text-ink-900 dark:text-ink-100">
              {title || (isSave ? "保存文件" : canSelectDir ? "选择文件夹" : multi ? "选择文件" : "选择文件")}
            </DialogTitle>
            <button onClick={handleCancel} className="grid h-6 w-6 place-items-center rounded-md text-ink-500 hover:bg-black/5 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/10">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-1 border-b border-black/[0.06] px-3 py-1.5 text-xs dark:border-white/[0.06]">
            <button onClick={handleUp} className="grid h-5 w-5 place-items-center rounded text-ink-500 hover:bg-black/5 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/10" title="上级目录">
              <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5-5 5 5" />
              </svg>
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              <button onClick={() => setCwd("/")} className="shrink-0 rounded px-1 hover:bg-black/5 dark:hover:bg-white/10">~</button>
              {parts.map((p, i) => (
                <span key={p.path} className="flex items-center gap-0.5">
                  <span className="text-ink-400">/</span>
                  <button onClick={() => setCwd(p.path)} className={`truncate rounded px-1 hover:bg-black/5 dark:hover:bg-white/10 ${i === parts.length - 1 ? "font-medium text-ink-900 dark:text-ink-100" : ""}`}>{p.name}</button>
                </span>
              ))}
            </div>
          </div>

          <div ref={parentRef} className="flex-1 overflow-auto px-1 py-1">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((row) => {
                if (row.index === 0) {
                  return (
                    <div
                      key="up"
                      style={{ position: "absolute", top: 0, left: 0, right: 0, height: row.size, transform: `translateY(${row.start}px)` }}
                      onClick={handleUp}
                      className="flex cursor-pointer select-none items-center gap-2 rounded px-3 text-sm text-ink-500 hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5-5 5 5M5 4h10" />
                      </svg>
                      <span>.. (返回上级)</span>
                    </div>
                  );
                }
                const item = entries[row.index - 1];
                if (!item) return null;
                const isSel = selected.has(item.path);
                return (
                  <div
                    key={item.path}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, height: row.size, transform: `translateY(${row.start}px)` }}
                    onClick={() => handleRowClick(item)}
                    onDoubleClick={() => item.kind === "dir" && handleEnter(item)}
                    className={`flex cursor-pointer select-none items-center gap-2 rounded px-3 text-sm transition-colors ${
                      isSel ? "bg-brand-500/15 text-brand-500 dark:bg-brand-500/20" : "hover:bg-brand-500/5 dark:hover:bg-brand-500/10"
                    }`}
                  >
                    <EntryIcon kind={item.kind} name={item.name} />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.kind === "file" && (
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-500 dark:text-ink-400">{formatSize(item.size)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isSave && (
            <div className="flex items-center gap-2 border-t border-black/[0.06] px-4 py-2 dark:border-white/[0.06]">
              <span className="shrink-0 text-xs text-ink-600 dark:text-ink-300">文件名</span>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canConfirm && handleConfirm()}
                className="min-w-0 flex-1 rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-1 text-sm outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 dark:border-white/10 dark:bg-white/[0.05] dark:text-ink-100 dark:focus:border-brand-400/50"
                autoFocus
              />
            </div>
          )}

          {multi && selected.size > 0 && (
            <div className="border-t border-black/[0.06] px-4 py-1.5 text-xs text-ink-500 dark:border-white/[0.06] dark:text-ink-400">
              已选 {selected.size} 项
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
            <button onClick={handleCancel} className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5">
              取消
            </button>
            <button onClick={handleConfirm} disabled={!canConfirm} className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:hover:shadow-none">
              {isSave ? "保存" : canSelectDir ? "选择文件夹" : multi ? `选择 (${selected.size})` : "选择"}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

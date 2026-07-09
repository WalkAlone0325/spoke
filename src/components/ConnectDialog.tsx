import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { useEffect, useState } from "react";
import { useAppStore, type TerminalTab } from "../store/appStore";
import {
  loadServers,
  saveServer,
  type StoredAuth,
  type StoredServer,
} from "../store/settings";
import { sshConnect } from "../hooks/useSshSession";

type AuthKind = "password" | "privateKey";

interface FormState {
  name: string;
  host: string;
  port: number;
  username: string;
  groupId: string;
  authKind: AuthKind;
  password: string;
  keyPath: string;
  passphrase: string;
}

const empty: FormState = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  groupId: "prod",
  authKind: "password",
  password: "",
  keyPath: "",
  passphrase: "",
};

function toStoredAuth(f: FormState): StoredAuth {
  if (f.authKind === "password") return { kind: "password", password: f.password };
  return {
    kind: "privateKey",
    path: f.keyPath,
    passphrase: f.passphrase || undefined,
  };
}

function fromServer(s: StoredServer): FormState {
  if (s.auth.kind === "password") {
    return {
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      groupId: s.groupId ?? "prod",
      authKind: "password",
      password: s.auth.password,
      keyPath: "",
      passphrase: "",
    };
  }
  if (s.auth.kind === "privateKey") {
    return {
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      groupId: s.groupId ?? "prod",
      authKind: "privateKey",
      password: "",
      keyPath: s.auth.path,
      passphrase: s.auth.passphrase ?? "",
    };
  }
  return { ...empty, name: s.name, host: s.host, port: s.port, username: s.username };
}

export function ConnectDialog() {
  const open = useAppStore((s) => s.connectDialogOpen);
  const close = useAppStore((s) => s.closeConnectDialog);
  const editingId = useAppStore((s) => s.editingServerId);
  const servers = useAppStore((s) => s.servers);
  const setServers = useAppStore((s) => s.setServers);
  const groups = useAppStore((s) => s.groups);
  const addTab = useAppStore((s) => s.addTab);
  const updateTab = useAppStore((s) => s.updateTab);

  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const editing = editingId ? servers.find((s) => s.id === editingId) : null;
    setForm(editing ? fromServer(editing) : empty);
  }, [open, editingId, servers]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    const now = Date.now();
    const stored: StoredServer = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name || `${form.username}@${form.host}`,
      host: form.host,
      port: form.port,
      username: form.username,
      groupId: form.groupId,
      auth: toStoredAuth(form),
      createdAt: now,
      updatedAt: now,
    };
    const list = await saveServer(stored);
    setServers(list);
    return stored;
  };

  const onSaveOnly = async () => {
    if (!form.host || !form.username) {
      setError("请填写主机与用户名");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save();
      close();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onConnect = async () => {
    if (!form.host || !form.username) {
      setError("请填写主机与用户名");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stored = await save();
      const tabId = crypto.randomUUID();
      const tab: TerminalTab = {
        id: tabId,
        title: stored.name,
        serverId: stored.id,
        connected: false,
      };
      addTab(tab);

      const sessionId = await sshConnect({
        host: stored.host,
        port: stored.port,
        username: stored.username,
        auth:
          stored.auth.kind === "password"
            ? { kind: "password", password: stored.auth.password }
            : {
                kind: "privateKey",
                path: (stored.auth as any).path,
                passphrase: (stored.auth as any).passphrase,
              },
        term: "xterm-256color",
        cols: 80,
        rows: 24,
      });

      updateTab(tabId, { sessionId, connected: true });
      close();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl border border-black/5 bg-white p-5 shadow-2xl dark:border-white/5 dark:bg-ink-800">
          <DialogTitle className="mb-4 text-base font-semibold">
            {editingId ? "编辑连接" : "新建连接"}
          </DialogTitle>

          <div className="grid grid-cols-4 gap-3 text-sm">
            <Field label="名称" span={4}>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="留空自动生成"
              />
            </Field>
            <Field label="主机" span={3}>
              <input
                className={inputCls}
                value={form.host}
                onChange={(e) => patch({ host: e.target.value })}
                placeholder="example.com"
              />
            </Field>
            <Field label="端口" span={1}>
              <input
                type="number"
                className={inputCls}
                value={form.port}
                onChange={(e) => patch({ port: Number(e.target.value) || 22 })}
              />
            </Field>
            <Field label="用户名" span={2}>
              <input
                className={inputCls}
                value={form.username}
                onChange={(e) => patch({ username: e.target.value })}
              />
            </Field>
            <Field label="分组" span={2}>
              <Listbox
                value={form.groupId}
                onChange={(v) => patch({ groupId: v })}
              >
                <div className="relative">
                  <ListboxButton
                    className={`${inputCls} flex items-center justify-between text-left data-[open]:border-brand-500`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="h-1.5 w-1.5 rounded-full bg-linear-to-r from-brand-500 to-accent-500" />
                      <span className="truncate">
                        {groups.find((g) => g.id === form.groupId)?.name ??
                          "选择分组"}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-3.5 w-3.5 text-ink-600/60 transition-transform data-[open]:rotate-180 dark:text-ink-100/50"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 7.5 5 5 5-5" />
                    </svg>
                  </ListboxButton>
                  <ListboxOptions
                    anchor="bottom start"
                    transition
                    className="z-[60] mt-1 w-[var(--button-width)] min-w-40 origin-top rounded-lg border border-black/10 bg-white/95 p-1 shadow-xl backdrop-blur transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-white/10 dark:bg-ink-800/95"
                  >
                    {groups.map((g) => (
                      <ListboxOption
                        key={g.id}
                        value={g.id}
                        className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-800 transition-colors data-[focus]:bg-brand-500/10 data-[selected]:text-brand-500 dark:text-ink-100"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-ink-600/40 group-data-[selected]:bg-linear-to-r group-data-[selected]:from-brand-500 group-data-[selected]:to-accent-500" />
                        <span className="flex-1 truncate">{g.name}</span>
                        <svg
                          viewBox="0 0 20 20"
                          className="hidden h-3.5 w-3.5 text-brand-500 group-data-[selected]:block"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m4 10 4 4 8-8" />
                        </svg>
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </Field>

            <Field label="认证方式" span={4}>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "password", label: "密码" },
                    { key: "privateKey", label: "私钥" },
                  ] as const
                ).map((opt) => {
                  const active = form.authKind === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => patch({ authKind: opt.key })}
                      className={`h-9 rounded-md border text-xs font-medium transition-colors ${
                        active
                          ? "border-brand-500 bg-brand-500/10 text-brand-500"
                          : "border-black/10 text-ink-600 hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:text-ink-100/70 dark:hover:border-white/20 dark:hover:bg-white/5"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {form.authKind === "password" ? (
              <Field label="密码" span={4}>
                <input
                  type="password"
                  className={inputCls}
                  value={form.password}
                  onChange={(e) => patch({ password: e.target.value })}
                />
              </Field>
            ) : (
              <>
                <Field label="私钥路径" span={4}>
                  <input
                    className={inputCls}
                    value={form.keyPath}
                    onChange={(e) => patch({ keyPath: e.target.value })}
                    placeholder="~/.ssh/id_ed25519"
                  />
                </Field>
                <Field label="Passphrase" span={4}>
                  <input
                    type="password"
                    className={inputCls}
                    value={form.passphrase}
                    onChange={(e) => patch({ passphrase: e.target.value })}
                    placeholder="留空表示无 passphrase"
                  />
                </Field>
              </>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              disabled={busy}
              onClick={close}
              className="rounded-md px-3 py-1.5 text-sm text-ink-600 hover:bg-black/5 dark:text-ink-100/70 dark:hover:bg-white/5"
            >
              取消
            </button>
            <button
              disabled={busy}
              onClick={onSaveOnly}
              className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              仅保存
            </button>
            <button
              disabled={busy}
              onClick={onConnect}
              className="rounded-md bg-linear-to-r from-brand-500 to-accent-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "连接中…" : "保存并连接"}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

const inputCls =
  "w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-white/10 dark:bg-ink-700/60";

function Field({
  label,
  span,
  children,
}: {
  label: string;
  span: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const spanCls = {
    1: "col-span-1",
    2: "col-span-2",
    3: "col-span-3",
    4: "col-span-4",
  }[span];
  return (
    <label className={`${spanCls} flex flex-col gap-1`}>
      <span className="text-[11px] text-ink-600/70 dark:text-ink-100/50">
        {label}
      </span>
      {children}
    </label>
  );
}

export { loadServers };

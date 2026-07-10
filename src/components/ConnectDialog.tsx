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
  type ProxyJumpConfig,
  type StoredAuth,
  type StoredServer,
} from "../store/settings";
import { saveSecret, getSecret } from "../store/secrets";
import { sshConnect, sshTestConnect, type ConnectPayload } from "../hooks/useSshSession";

type AuthKind = "password" | "privateKey";

interface ProxyJumpForm {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authKind: AuthKind;
  password: string;
  keyPath: string;
  passphrase: string;
}

type ProxyKindForm = "none" | "http" | "socks5";

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
  proxyJump: ProxyJumpForm;
  proxyKind: ProxyKindForm;
  proxyHost: string;
  proxyPort: number;
  showAdvanced: boolean;
}

const emptyJump: ProxyJumpForm = {
  enabled: false,
  host: "",
  port: 22,
  username: "root",
  authKind: "password",
  password: "",
  keyPath: "",
  passphrase: "",
};

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
  proxyJump: { ...emptyJump },
  proxyKind: "none",
  proxyHost: "",
  proxyPort: 1080,
  showAdvanced: false,
};

function toStoredAuth(f: FormState): StoredAuth {
  if (f.authKind === "password") return { kind: "password" };
  return {
    kind: "privateKey",
    path: f.keyPath,
  };
}

async function fromServer(s: StoredServer): Promise<FormState> {
  let password = "";
  let passphrase = "";

  if (s.passwordRef) {
    try { password = await getSecret(s.passwordRef); } catch { password = ""; }
  } else if (s.auth.kind === "password" && s.auth.password) {
    password = s.auth.password;
  }

  if (s.passphraseRef) {
    try { passphrase = await getSecret(s.passphraseRef); } catch { passphrase = ""; }
  } else if (s.auth.kind === "privateKey" && s.auth.passphrase) {
    passphrase = s.auth.passphrase;
  }

  let jumpPwd = "";
  let jumpPp = "";
  if (s.proxyJump) {
    if (s.proxyJump.passwordRef) {
      try { jumpPwd = await getSecret(s.proxyJump.passwordRef); } catch { jumpPwd = ""; }
    } else if (s.proxyJump.auth.kind === "password" && s.proxyJump.auth.password) {
      jumpPwd = s.proxyJump.auth.password;
    }
    if (s.proxyJump.passphraseRef) {
      try { jumpPp = await getSecret(s.proxyJump.passphraseRef); } catch { jumpPp = ""; }
    } else if (s.proxyJump.auth.kind === "privateKey" && s.proxyJump.auth.passphrase) {
      jumpPp = s.proxyJump.auth.passphrase;
    }
  }

  const proxyKind: ProxyKindForm = s.proxy?.kind === "http" ? "http" : s.proxy?.kind === "socks5" ? "socks5" : "none";
  const proxyHost = s.proxy?.kind === "http" || s.proxy?.kind === "socks5" ? s.proxy.host : "";
  const proxyPort = s.proxy?.kind === "http" || s.proxy?.kind === "socks5" ? s.proxy.port : 1080;

  const base = s.auth.kind === "password" ? {
    authKind: "password" as AuthKind, password, keyPath: "", passphrase: "",
  } : s.auth.kind === "privateKey" ? {
    authKind: "privateKey" as AuthKind, password: "", keyPath: s.auth.path, passphrase,
  } : {
    authKind: "password" as AuthKind, password, keyPath: "", passphrase: "",
  };

  return {
    ...empty,
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    groupId: s.groupId ?? "prod",
    ...base,
    proxyJump: {
      enabled: !!s.proxyJump,
      host: s.proxyJump?.host ?? "",
      port: s.proxyJump?.port ?? 22,
      username: s.proxyJump?.username ?? "root",
      authKind: s.proxyJump?.auth.kind === "password" ? "password" : "privateKey",
      password: jumpPwd,
      keyPath: s.proxyJump?.auth.kind === "privateKey" ? s.proxyJump.auth.path : "",
      passphrase: jumpPp,
    },
    proxyKind,
    proxyHost,
    proxyPort,
    showAdvanced: !!s.proxyJump || proxyKind !== "none",
  };
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
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; msg: string } | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    setShowPassword(false);
    setShowPassphrase(false);
    setForm(empty);
    const editing = editingId ? servers.find((s) => s.id === editingId) : null;
    if (editing) {
      fromServer(editing).then(setForm).catch(console.error);
    }
  }, [open, editingId, servers]);

  const patch = (p: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setTestResult(null);
  };

  const buildPayload = (): ConnectPayload => {
    const proxyJump = form.proxyJump.enabled
      ? {
          host: form.proxyJump.host,
          port: form.proxyJump.port,
          username: form.proxyJump.username,
          auth: form.proxyJump.authKind === "password"
            ? { kind: "password" as const, password: form.proxyJump.password }
            : { kind: "privateKey" as const, path: form.proxyJump.keyPath, passphrase: form.proxyJump.passphrase || undefined },
        }
      : undefined;

    const proxy = form.proxyKind === "http"
      ? { kind: "http" as const, host: form.proxyHost, port: form.proxyPort }
      : form.proxyKind === "socks5"
      ? { kind: "socks5" as const, host: form.proxyHost, port: form.proxyPort }
      : undefined;

    return {
      host: form.host,
      port: form.port,
      username: form.username,
      auth:
        form.authKind === "password"
          ? { kind: "password", password: form.password }
          : {
              kind: "privateKey",
              path: form.keyPath,
              passphrase: form.passphrase || undefined,
            },
      proxyJump,
      proxy,
    };
  };

  const validate = (): string | null => {
    if (!form.host) return "请填写主机";
    if (!form.username) return "请填写用户名";
    if (form.authKind === "password" && !form.password) return "请填写密码";
    if (form.authKind === "privateKey" && !form.keyPath) return "请填写私钥路径";
    if (form.proxyJump.enabled) {
      if (!form.proxyJump.host) return "请填写跳板机主机";
      if (!form.proxyJump.username) return "请填写跳板机用户名";
      if (form.proxyJump.authKind === "password" && !form.proxyJump.password) return "请填写跳板机密码";
      if (form.proxyJump.authKind === "privateKey" && !form.proxyJump.keyPath) return "请填写跳板机私钥路径";
    }
    return null;
  };

  const onTest = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const msg = await sshTestConnect(buildPayload());
      setTestResult({ ok: true, msg });
    } catch (e: any) {
      setTestResult({ ok: false, msg: String(e?.message ?? e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const now = Date.now();
    const id = editingId ?? crypto.randomUUID();
    const auth = toStoredAuth(form);
    const stored: StoredServer = {
      id,
      name: form.name || `${form.username}@${form.host}`,
      host: form.host,
      port: form.port,
      username: form.username,
      groupId: form.groupId,
      auth,
      createdAt: now,
      updatedAt: now,
    };

    if (form.authKind === "password" && form.password) {
      await saveSecret(id, form.password);
      stored.passwordRef = id;
    } else if (form.authKind === "privateKey" && form.passphrase) {
      const ref = `${id}_passphrase`;
      await saveSecret(ref, form.passphrase);
      stored.passphraseRef = ref;
    }

    if (form.proxyJump.enabled) {
      const jAuth: StoredAuth = form.proxyJump.authKind === "password"
        ? { kind: "password" }
        : { kind: "privateKey", path: form.proxyJump.keyPath };
      const jump: ProxyJumpConfig = {
        host: form.proxyJump.host,
        port: form.proxyJump.port,
        username: form.proxyJump.username,
        auth: jAuth,
      };
      if (form.proxyJump.authKind === "password" && form.proxyJump.password) {
        const ref = `${id}_jump_pwd`;
        await saveSecret(ref, form.proxyJump.password);
        jump.passwordRef = ref;
      } else if (form.proxyJump.authKind === "privateKey" && form.proxyJump.passphrase) {
        const ref = `${id}_jump_pp`;
        await saveSecret(ref, form.proxyJump.passphrase);
        jump.passphraseRef = ref;
      }
      stored.proxyJump = jump;
    }

    if (form.proxyKind === "http") {
      stored.proxy = { kind: "http", host: form.proxyHost, port: form.proxyPort };
    } else if (form.proxyKind === "socks5") {
      stored.proxy = { kind: "socks5", host: form.proxyHost, port: form.proxyPort };
    }

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

      const auth = form.authKind === "password"
        ? { kind: "password" as const, password: form.password }
        : { kind: "privateKey" as const, path: form.keyPath, passphrase: form.passphrase || undefined };

      const proxyJump = form.proxyJump.enabled
        ? {
            host: form.proxyJump.host,
            port: form.proxyJump.port,
            username: form.proxyJump.username,
            auth: form.proxyJump.authKind === "password"
              ? { kind: "password" as const, password: form.proxyJump.password }
              : { kind: "privateKey" as const, path: form.proxyJump.keyPath, passphrase: form.proxyJump.passphrase || undefined },
          }
        : undefined;

      const proxy = form.proxyKind === "http"
        ? { kind: "http" as const, host: form.proxyHost, port: form.proxyPort }
        : form.proxyKind === "socks5"
        ? { kind: "socks5" as const, host: form.proxyHost, port: form.proxyPort }
        : undefined;

      const sessionId = await sshConnect({
        host: form.host,
        port: form.port,
        username: form.username,
        auth,
        proxyJump,
        proxy,
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
        <DialogPanel className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-black/5 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800">
          <DialogTitle className="shrink-0 px-5 pb-0 pt-5 text-base font-semibold">
            {editingId ? "编辑连接" : "新建连接"}
          </DialogTitle>

          <div className="flex-1 overflow-y-auto px-5 py-4">
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
                <PasswordInput
                  value={form.password}
                  onChange={(v) => patch({ password: v })}
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
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
                  <PasswordInput
                    value={form.passphrase}
                    onChange={(v) => patch({ passphrase: v })}
                    visible={showPassphrase}
                    onToggle={() => setShowPassphrase((v) => !v)}
                    placeholder="留空表示无 passphrase"
                  />
                </Field>
              </>
            )}

            <div className="col-span-4 mt-2">
              <button
                type="button"
                onClick={() => patch({ showAdvanced: !form.showAdvanced })}
                className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
              >
                <svg
                  viewBox="0 0 20 20"
                  className={`h-3 w-3 transition-transform ${form.showAdvanced ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m7 4 6 6-6 6" />
                </svg>
                高级配置
              </button>

              {form.showAdvanced && (
                <div className="mt-3 space-y-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="proxyJump"
                      checked={form.proxyJump.enabled}
                      onChange={(e) => patch({ proxyJump: { ...form.proxyJump, enabled: e.target.checked } })}
                      className="h-3.5 w-3.5 rounded border-black/30 accent-brand-500"
                    />
                    <label htmlFor="proxyJump" className="text-xs font-medium">跳板机 (ProxyJump)</label>
                  </div>

                  {form.proxyJump.enabled && (
                    <div className="grid grid-cols-4 gap-2 pl-4 text-xs">
                      <Field label="跳板主机" span={3}>
                        <input className={inputCls} value={form.proxyJump.host} onChange={(e) => patch({ proxyJump: { ...form.proxyJump, host: e.target.value } })} placeholder="jump.example.com" />
                      </Field>
                      <Field label="端口" span={1}>
                        <input type="number" className={inputCls} value={form.proxyJump.port} onChange={(e) => patch({ proxyJump: { ...form.proxyJump, port: Number(e.target.value) || 22 } })} />
                      </Field>
                      <Field label="跳板用户" span={4}>
                        <input className={inputCls} value={form.proxyJump.username} onChange={(e) => patch({ proxyJump: { ...form.proxyJump, username: e.target.value } })} />
                      </Field>
                      <Field label="认证方式" span={4}>
                        <div className="grid grid-cols-2 gap-2">
                          {(["password", "privateKey"] as const).map((opt) => {
                            const active = form.proxyJump.authKind === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => patch({ proxyJump: { ...form.proxyJump, authKind: opt } })}
                                className={`h-8 rounded-md border text-[11px] font-medium transition-colors ${
                                  active
                                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                                    : "border-black/10 text-ink-600 hover:border-black/20 dark:border-white/10 dark:text-ink-100/70"
                                }`}
                              >
                                {opt === "password" ? "密码" : "私钥"}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                      {form.proxyJump.authKind === "password" ? (
                        <Field label="跳板密码" span={4}>
                          <input type="password" className={inputCls} value={form.proxyJump.password} onChange={(e) => patch({ proxyJump: { ...form.proxyJump, password: e.target.value } })} />
                        </Field>
                      ) : (
                        <Field label="跳板私钥路径" span={4}>
                          <input className={inputCls} value={form.proxyJump.keyPath} onChange={(e) => patch({ proxyJump: { ...form.proxyJump, keyPath: e.target.value } })} placeholder="~/.ssh/id_ed25519" />
                        </Field>
                      )}
                    </div>
                  )}

                  <div className="border-t border-black/5 pt-3 dark:border-white/5">
                    <div className="mb-2 text-xs font-medium">代理 (HTTP / SOCKS5)</div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <Field label="类型" span={1}>
                        <Listbox
                          value={form.proxyKind}
                          onChange={(v) => patch({ proxyKind: v })}
                        >
                          <div className="relative">
                            <ListboxButton
                              className={`${inputCls} flex items-center justify-between text-left data-[open]:border-brand-500`}
                            >
                              <span>{form.proxyKind === "none" ? "无" : form.proxyKind === "http" ? "HTTP" : "SOCKS5"}</span>
                              <svg
                                viewBox="0 0 20 20"
                                className="h-3 w-3 text-ink-600/60 transition-transform data-[open]:rotate-180 dark:text-ink-100/50"
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
                              className="z-[60] mt-1 min-w-24 origin-top rounded-lg border border-black/10 bg-white/95 p-1 shadow-xl backdrop-blur transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-white/10 dark:bg-ink-800/95"
                            >
                              {[
                                { value: "none", label: "无" },
                                { value: "http", label: "HTTP" },
                                { value: "socks5", label: "SOCKS5" },
                              ].map((opt) => (
                                <ListboxOption
                                  key={opt.value}
                                  value={opt.value}
                                  className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-800 transition-colors data-[focus]:bg-brand-500/10 data-[selected]:text-brand-500 dark:text-ink-100"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-ink-600/40 group-data-[selected]:bg-linear-to-r group-data-[selected]:from-brand-500 group-data-[selected]:to-accent-500" />
                                  <span className="flex-1 truncate">{opt.label}</span>
                                  <svg
                                    viewBox="0 0 20 20"
                                    className="hidden h-3 w-3 text-brand-500 group-data-[selected]:block"
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
                      {form.proxyKind !== "none" && (
                        <>
                          <Field label="代理主机" span={2}>
                            <input className={inputCls} value={form.proxyHost} onChange={(e) => patch({ proxyHost: e.target.value })} placeholder="127.0.0.1" />
                          </Field>
                          <Field label="端口" span={1}>
                            <input type="number" className={inputCls} value={form.proxyPort} onChange={(e) => patch({ proxyPort: Number(e.target.value) || 1080 })} />
                          </Field>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>

          {error && (
            <div className="mt-3 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
              {error}
            </div>
          )}

          {testResult && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${
                testResult.ok
                  ? "bg-accent-500/10 text-accent-500"
                  : "bg-red-500/10 text-red-500"
              }`}
            >
              <span className="mt-[1px]">{testResult.ok ? "✓" : "✕"}</span>
              <span className="flex-1 break-all">{testResult.msg}</span>
            </div>
          )}
          </div>

          <div className="shrink-0 border-t border-black/5 px-5 py-3 dark:border-white/5">
          <div className="flex items-center justify-between gap-2">
            <button
              disabled={busy || testing}
              onClick={onTest}
              className="flex items-center gap-1.5 rounded-md border border-brand-500/30 px-3 py-1.5 text-sm text-brand-500 transition-colors hover:bg-brand-500/10 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
                  <span>测试中…</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m10 2-6 10h5l-1 6 6-10h-5z" />
                  </svg>
                  <span>测试连接</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                disabled={busy || testing}
                onClick={close}
                className="rounded-md px-3 py-1.5 text-sm text-ink-600 hover:bg-black/5 dark:text-ink-100/70 dark:hover:bg-white/5"
              >
                取消
              </button>
              <button
                disabled={busy || testing}
                onClick={onSaveOnly}
                className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                仅保存
              </button>
              <button
                disabled={busy || testing}
                onClick={onConnect}
                className="rounded-md bg-linear-to-r from-brand-500 to-accent-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "连接中…" : "保存并连接"}
              </button>
            </div>
          </div>
        </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

const inputCls =
  "w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-white/10 dark:bg-ink-700/60";

function PasswordInput({
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={`${inputCls} pr-9`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={onToggle}
        title={visible ? "隐藏" : "显示"}
        tabIndex={-1}
        className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-500 transition-colors hover:bg-black/5 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
      >
        {visible ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l14 14" />
            <path d="M6.7 6.7C4.6 8 3 10 3 10s3 6 7 6c1.4 0 2.6-.4 3.7-1M9 5.1c.3-.1.7-.1 1-.1 4 0 7 6 7 6s-.5 1-1.4 2.1" />
            <path d="M8.5 8.5a2 2 0 0 0 2.8 2.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" />
            <circle cx="10" cy="10" r="2.5" />
          </svg>
        )}
      </button>
    </div>
  );
}

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

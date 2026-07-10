import { useState } from "react";
import { generateSshKey, type KeyGenResult } from "../hooks/useSftp";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KeyGenDialog({ open, onClose }: Props) {
  const [keyType, setKeyType] = useState("ed25519");
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [result, setResult] = useState<KeyGenResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"pub" | "priv" | null>(null);

  if (!open) return null;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateSshKey(keyType, comment || "spoke@generated");
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (field: "pub" | "priv", text: string) => {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl border border-black/5 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/95"
      >
        <div className="mb-4 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-500/10 text-brand-500">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="10" cy="8" r="3" />
              <path d="M5.5 13.5a7 7 0 0 1 9 0" />
              <path d="M3 17a10 10 0 0 1 14 0" />
            </svg>
          </div>
          <div className="text-[15px] font-semibold text-ink-900 dark:text-ink-100">
            SSH 密钥生成器
          </div>
        </div>

        {!result ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                密钥类型
              </label>
              <div className="flex gap-2">
                {[
                  { value: "ed25519", label: "Ed25519" },
                  { value: "rsa_2048", label: "RSA 2048" },
                  { value: "rsa_4096", label: "RSA 4096" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setKeyType(opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      keyType === opt.value
                        ? "border-brand-500 bg-brand-500/10 text-brand-500"
                        : "border-black/10 bg-white text-ink-600 hover:border-black/20 dark:border-white/10 dark:bg-transparent dark:text-ink-300 dark:hover:border-white/20"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                注释（可选）
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-brand-500/40 focus:shadow-xs dark:border-white/10 dark:bg-transparent dark:text-ink-100 dark:focus:border-brand-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                私钥密码（可选）
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="留空则不设置"
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-brand-500/40 focus:shadow-xs dark:border-white/10 dark:bg-transparent dark:text-ink-100 dark:focus:border-brand-500/40"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-md active:scale-[0.98] disabled:opacity-60"
              >
                {generating ? "生成中…" : "生成密钥对"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-accent-500/10 px-3 py-2 text-xs text-accent-600 dark:text-accent-400">
              <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10l2 2 5-5" />
                <circle cx="10" cy="10" r="8" />
              </svg>
              密钥对已生成！
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                指纹: {result.fingerprint}
              </label>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-600 dark:text-ink-400">公钥</label>
                <button
                  onClick={() => copyToClipboard("pub", result.publicKey)}
                  className="text-[10px] text-brand-500 hover:text-brand-600"
                >
                  {copiedField === "pub" ? "已复制" : "复制"}
                </button>
              </div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2.5 text-[11px] text-ink-600 dark:bg-white/[0.04] dark:text-ink-400">
                {result.publicKey}
              </pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-600 dark:text-ink-400">私钥</label>
                <button
                  onClick={() => copyToClipboard("priv", result.privateKey)}
                  className="text-[10px] text-brand-500 hover:text-brand-600"
                >
                  {copiedField === "priv" ? "已复制" : "复制"}
                </button>
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/[0.04] p-2.5 text-[11px] text-ink-600 dark:bg-white/[0.04] dark:text-ink-400">
                {result.privateKey}
              </pre>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setResult(null); setError(null); }}
                className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5"
              >
                重新生成
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-md active:scale-[0.98]"
              >
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

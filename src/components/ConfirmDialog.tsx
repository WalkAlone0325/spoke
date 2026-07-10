import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  danger = true,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-xl border border-black/5 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-ink-800">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/5"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium text-white transition-colors ${
                danger
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-brand-500 hover:bg-brand-600"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

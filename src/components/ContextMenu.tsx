import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  separatorAfter?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onDoc = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - items.length * 32 - 12;
  const left = Math.min(x, maxX);
  const top = Math.min(y, maxY);

  return createPortal(
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left, top }}
      className="fixed z-[100] min-w-[180px] rounded-xl border border-black/10 bg-white/95 p-1 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-ink-800/95"
    >
      {items.map((item, i) => (
        <div key={i}>
          <button
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
              item.danger
                ? "text-red-500 hover:bg-red-500/10"
                : "text-ink-800 hover:bg-brand-500/10 hover:text-brand-500 dark:text-ink-100"
            }`}
          >
            {item.icon && (
              <span className="grid h-3.5 w-3.5 place-items-center">
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
          </button>
          {item.separatorAfter && (
            <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

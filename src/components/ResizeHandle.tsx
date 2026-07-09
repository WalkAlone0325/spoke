import { useCallback, useEffect, useRef } from "react";

interface Props {
  orientation: "horizontal" | "vertical";
  onDrag: (deltaPx: number) => void;
  className?: string;
}

export function ResizeHandle({ orientation, onDrag, className = "" }: Props) {
  const draggingRef = useRef(false);
  const lastRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      lastRef.current = orientation === "vertical" ? e.clientX : e.clientY;
    },
    [orientation],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const curr = orientation === "vertical" ? e.clientX : e.clientY;
      const delta = curr - lastRef.current;
      lastRef.current = curr;
      onDrag(delta);
    },
    [orientation, onDrag],
  );

  const stop = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      draggingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const prev = document.body.style.userSelect;
    return () => {
      document.body.style.userSelect = prev;
    };
  }, []);

  const cursorCls =
    orientation === "vertical"
      ? "cursor-col-resize w-1 h-full"
      : "cursor-row-resize h-1 w-full";

  return (
    <div
      className={`shrink-0 bg-transparent hover:bg-brand-500/40 transition-colors ${cursorCls} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

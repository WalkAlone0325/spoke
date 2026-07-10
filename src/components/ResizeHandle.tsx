import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  orientation: "horizontal" | "vertical";
  onDrag: (deltaPx: number) => void;
  className?: string;
}

export function ResizeHandle({ orientation, onDrag, className = "" }: Props) {
  const draggingRef = useRef(false);
  const lastRef = useRef(0);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setDragging(true);
      lastRef.current = orientation === "vertical" ? e.clientX : e.clientY;
      document.body.style.userSelect = "none";
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
      setDragging(false);
      document.body.style.userSelect = "";
    }
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
    };
  }, []);

  const isVertical = orientation === "vertical";
  const wrapCls = isVertical
    ? "w-1.5 h-full cursor-col-resize"
    : "h-1.5 w-full cursor-row-resize";
  const barCls = isVertical
    ? "h-8 w-[3px]"
    : "w-8 h-[3px]";
  const active = hover || dragging;

  return (
    <div
      className={`group relative flex shrink-0 items-center justify-center ${wrapCls} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className={`rounded-full transition-all duration-150 ${barCls} ${
          active
            ? "bg-linear-to-b from-brand-500 to-accent-500 opacity-100 scale-125"
            : "bg-ink-400/40 opacity-60 dark:bg-ink-500/40"
        }`}
      />
    </div>
  );
}

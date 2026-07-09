import { useCallback, useEffect, useRef, useState } from "react";
import { useXterm } from "../hooks/useXterm";
import { useSshSession } from "../hooks/useSshSession";
import type { TerminalTab } from "../store/appStore";
import { useAppStore } from "../store/appStore";

interface Props {
  tab: TerminalTab;
}

export function TerminalView({ tab }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const updateTab = useAppStore((s) => s.updateTab);

  const term = useXterm(container, {
    onData: (d) => {
      void sendRef.current?.(d);
    },
    onResize: (cols, rows) => {
      void resizeRef.current?.(cols, rows);
    },
  });

  const sendRef = useRef<((data: string) => Promise<void>) | null>(null);
  const resizeRef = useRef<((cols: number, rows: number) => Promise<void>) | null>(
    null,
  );

  const onData = useCallback((chunk: string) => {
    term.current?.term.write(chunk);
  }, [term]);

  const onExit = useCallback(
    (code: number) => {
      term.current?.term.writeln(`\r\n\x1b[33m[进程退出，code=${code}]\x1b[0m`);
    },
    [term],
  );
  const onClosed = useCallback(() => {
    term.current?.term.writeln(`\r\n\x1b[31m[会话已关闭]\x1b[0m`);
    updateTab(tab.id, { connected: false });
  }, [term, tab.id, updateTab]);
  const onError = useCallback(
    (msg: string) => {
      term.current?.term.writeln(`\r\n\x1b[31m[错误] ${msg}\x1b[0m`);
    },
    [term],
  );

  const { send, resize, ready } = useSshSession(tab.sessionId ?? null, {
    onData,
    onExit,
    onClosed,
    onError,
  });

  useEffect(() => {
    sendRef.current = send;
    resizeRef.current = resize;
  }, [send, resize]);

  useEffect(() => {
    if (ready && term.current) {
      const { cols, rows } = term.current.term;
      void resize(cols, rows);
      term.current.focus();
    }
  }, [ready, resize, term]);

  return (
    <div className="relative h-full w-full bg-black">
      <div
        ref={setContainer}
        className="absolute inset-0 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent"
      />
    </div>
  );
}

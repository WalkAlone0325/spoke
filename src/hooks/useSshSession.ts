import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

export type AuthPayload =
  | { kind: "password"; password: string }
  | { kind: "privateKey"; path: string; passphrase?: string }
  | { kind: "privateKeyText"; pem: string; passphrase?: string };

export interface ConnectPayload {
  host: string;
  port?: number;
  username: string;
  auth: AuthPayload;
  term?: string;
  cols?: number;
  rows?: number;
}

export interface SshSessionApi {
  sessionId: string;
  send: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface SshSessionHooks {
  onData?: (chunk: string) => void;
  onExit?: (code: number) => void;
  onClosed?: () => void;
  onError?: (msg: string) => void;
}

export async function sshConnect(payload: ConnectPayload): Promise<string> {
  const res = await invoke<{ sessionId: string }>("ssh_connect", { payload });
  return res.sessionId;
}

export async function sshTestConnect(payload: ConnectPayload): Promise<string> {
  return await invoke<string>("ssh_test_connect", { payload });
}

export async function sshSendData(sessionId: string, data: string) {
  await invoke("ssh_send_data", { sessionId, data });
}

export async function sshResize(sessionId: string, cols: number, rows: number) {
  await invoke("ssh_resize", { sessionId, cols, rows });
}

export async function sshDisconnect(sessionId: string) {
  await invoke("ssh_disconnect", { sessionId });
}

export function useSshSession(sessionId: string | null, hooks: SshSessionHooks) {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setReady(false);
      return;
    }
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];
    setReady(false);

    (async () => {
      unlisteners.push(
        await listen<string>(`ssh://data/${sessionId}`, (e) => {
          hooksRef.current.onData?.(e.payload);
        }),
      );
      unlisteners.push(
        await listen<number>(`ssh://exit/${sessionId}`, (e) => {
          hooksRef.current.onExit?.(e.payload);
        }),
      );
      unlisteners.push(
        await listen(`ssh://closed/${sessionId}`, () => {
          hooksRef.current.onClosed?.();
        }),
      );
      unlisteners.push(
        await listen<string>(`ssh://error/${sessionId}`, (e) => {
          hooksRef.current.onError?.(e.payload);
        }),
      );
      if (mounted) setReady(true);
    })();

    return () => {
      mounted = false;
      unlisteners.forEach((u) => u());
    };
  }, [sessionId]);

  const send = useCallback(
    (data: string) => (sessionId ? sshSendData(sessionId, data) : Promise.resolve()),
    [sessionId],
  );
  const resize = useCallback(
    (cols: number, rows: number) =>
      sessionId ? sshResize(sessionId, cols, rows) : Promise.resolve(),
    [sessionId],
  );
  const disconnect = useCallback(
    () => (sessionId ? sshDisconnect(sessionId) : Promise.resolve()),
    [sessionId],
  );

  return { ready, send, resize, disconnect };
}

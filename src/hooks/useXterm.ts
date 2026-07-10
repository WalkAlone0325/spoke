import { useEffect, useRef } from "react";
import { Terminal, type ITerminalOptions, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export interface XtermHandle {
  term: Terminal;
  fit: () => void;
  dispose: () => void;
  focus: () => void;
  setTheme: (theme: ITerminalOptions["theme"]) => void;
}

export interface UseXtermOptions {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onOpenLink?: (url: string) => void;
  onOpenPath?: (path: string) => void;
  theme?: ITerminalOptions["theme"];
  fontFamily?: string;
}

const PATH_REGEX = /(?:^|\s|["'`(])(\/(?:[\w.\-@]+\/?)+)/g;

const DEFAULT_THEME_DARK: ITerminalOptions["theme"] = {
  background: "#0d0d0d",
  foreground: "#e5e5e5",
  cursor: "#00c8a0",
  cursorAccent: "#0d0d0d",
  selectionBackground: "#0057ff55",
  black: "#0d0d0d",
  red: "#ff5f56",
  green: "#00c8a0",
  yellow: "#ffbd2e",
  blue: "#0057ff",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#e5e5e5",
  brightBlack: "#3a3a3c",
  brightRed: "#ff7b72",
  brightGreen: "#3fb950",
  brightYellow: "#d29922",
  brightBlue: "#3d80ff",
  brightMagenta: "#bc8cff",
  brightCyan: "#39c5cf",
  brightWhite: "#ffffff",
};

export function useXterm(
  container: HTMLDivElement | null,
  opts: UseXtermOptions = {},
): React.MutableRefObject<XtermHandle | null> {
  const ref = useRef<XtermHandle | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      allowProposedApi: true,
      fontFamily:
        optsRef.current.fontFamily ||
        '"JetBrains Mono", "Fira Code", ui-monospace, "SFMono-Regular", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: optsRef.current.theme || DEFAULT_THEME_DARK,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon((_e, url) => {
      optsRef.current.onOpenLink?.(url);
    });
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(container);

    const pathLink = term.registerLinkProvider({
      provideLinks(
        y: number,
        callback: (links: ILink[] | undefined) => void,
      ) {
        const buf = term.buffer.active;
        const line = buf.getLine(y - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const results: ILink[] = [];
        for (const m of text.matchAll(PATH_REGEX)) {
          const path = m[1];
          if (!path) continue;
          const start = (m.index ?? 0) + m[0].indexOf(path) + 1;
          const end = start + path.length;
          results.push({
            range: {
              start: { x: start, y },
              end: { x: end, y },
            },
            text: path,
            activate: (_e, uri) => {
              optsRef.current.onOpenPath?.(uri);
            },
            hover() {},
            leave() {},
          });
        }
        callback(results.length ? results : undefined);
      },
    });

    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }

    const doFit = () => {
      try {
        fit.fit();
      } catch {}
    };
    doFit();

    const onData = term.onData((d) => optsRef.current.onData?.(d));
    const onResize = term.onResize(({ cols, rows }) =>
      optsRef.current.onResize?.(cols, rows),
    );

    const ro = new ResizeObserver(() => doFit());
    ro.observe(container);

    ref.current = {
      term,
      fit: doFit,
      dispose: () => {
        onData.dispose();
        onResize.dispose();
        pathLink.dispose();
        ro.disconnect();
        webgl?.dispose();
        term.dispose();
      },
      focus: () => term.focus(),
      setTheme: (t) => {
        term.options.theme = t;
      },
    };

    return () => {
      ref.current?.dispose();
      ref.current = null;
    };
  }, [container]);

  return ref;
}

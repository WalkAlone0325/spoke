import { useCallback } from "react";
import { useAppStore } from "./store/appStore";
import { useSystemTheme } from "./hooks/useSystemTheme";
import { Sidebar } from "./components/Sidebar";
import { TerminalArea } from "./components/TerminalArea";
import { SftpPanel } from "./components/SftpPanel";
import { ResizeHandle } from "./components/ResizeHandle";

function App() {
  useSystemTheme();
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sftpPanelHeight = useAppStore((s) => s.sftpPanelHeight);
  const sftpCollapsed = useAppStore((s) => s.sftpPanelCollapsed);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setSftpPanelHeight = useAppStore((s) => s.setSftpPanelHeight);

  const onSidebarDrag = useCallback(
    (dx: number) => setSidebarWidth(sidebarWidth + dx),
    [sidebarWidth, setSidebarWidth],
  );
  const onSftpDrag = useCallback(
    (dy: number) => setSftpPanelHeight(sftpPanelHeight - dy),
    [sftpPanelHeight, setSftpPanelHeight],
  );

  const bottomHeight = sftpCollapsed ? 34 : sftpPanelHeight;

  return (
    <div className="flex h-full w-full text-ink-900 dark:text-ink-100">
      <div style={{ width: sidebarWidth }} className="h-full shrink-0">
        <Sidebar />
      </div>
      <ResizeHandle orientation="vertical" onDrag={onSidebarDrag} />

      <div className="flex h-full flex-1 min-w-0 flex-col">
        <div className="flex-1 min-h-0">
          <TerminalArea />
        </div>
        {!sftpCollapsed && <ResizeHandle orientation="horizontal" onDrag={onSftpDrag} />}
        <div style={{ height: bottomHeight }} className="shrink-0">
          <SftpPanel />
        </div>
      </div>
    </div>
  );
}

export default App;

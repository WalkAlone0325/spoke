import { useCallback, useEffect } from "react";
import { useAppStore } from "./store/appStore";
import { useSystemTheme } from "./hooks/useSystemTheme";
import { Sidebar } from "./components/Sidebar";
import { TerminalArea } from "./components/TerminalArea";
import { SftpPanel } from "./components/SftpPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { ConnectDialog } from "./components/ConnectDialog";
import { loadGroups, loadServers, saveAllGroups } from "./store/settings";

function App() {
  useSystemTheme();
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const sftpPanelHeight = useAppStore((s) => s.sftpPanelHeight);
  const sftpCollapsed = useAppStore((s) => s.sftpPanelCollapsed);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setSftpPanelHeight = useAppStore((s) => s.setSftpPanelHeight);
  const setServers = useAppStore((s) => s.setServers);
  const setGroups = useAppStore((s) => s.setGroups);

  useEffect(() => {
    loadServers()
      .then(setServers)
      .catch((e) => console.error("加载服务器失败", e));
    loadGroups()
      .then(async (g) => {
        if (g.length > 0) {
          setGroups(g);
        } else {
          const defaults = [
            { id: "prod", name: "生产环境" },
            { id: "test", name: "测试环境" },
          ];
          await saveAllGroups(defaults);
          setGroups(defaults);
        }
      })
      .catch((e) => console.error("加载分组失败", e));
  }, [setServers, setGroups]);

  const onSidebarDrag = useCallback(
    (dx: number) => setSidebarWidth(sidebarWidth + dx),
    [sidebarWidth, setSidebarWidth],
  );
  const onSftpDrag = useCallback(
    (dy: number) => setSftpPanelHeight(sftpPanelHeight - dy),
    [sftpPanelHeight, setSftpPanelHeight],
  );

  const bottomHeight = sftpCollapsed ? 38 : sftpPanelHeight;

  return (
    <div className="relative flex h-full w-full flex-col text-ink-900 dark:text-ink-100">
      <div className="flex min-h-0 flex-1 gap-1 p-2">
        <div
          style={{ width: sidebarWidth }}
          className="glass h-full shrink-0 overflow-hidden rounded-2xl"
        >
          <Sidebar />
        </div>
        <ResizeHandle orientation="vertical" onDrag={onSidebarDrag} />

        <div className="flex h-full flex-1 min-w-0 flex-col gap-1">
          <div className="glass flex-1 min-h-0 overflow-hidden rounded-2xl">
            <TerminalArea />
          </div>
          {!sftpCollapsed && <ResizeHandle orientation="horizontal" onDrag={onSftpDrag} />}
          <div
            style={{ height: bottomHeight }}
            className="glass shrink-0 overflow-hidden rounded-2xl"
          >
            <SftpPanel />
          </div>
        </div>
      </div>

      <ConnectDialog />
    </div>
  );
}

export default App;

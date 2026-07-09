import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  groupId?: string;
}

export interface ServerGroup {
  id: string;
  name: string;
}

export interface TerminalTab {
  id: string;
  title: string;
  serverId?: string;
  sessionId?: string;
  connected: boolean;
}

interface AppState {
  themeMode: ThemeMode;
  isDark: boolean;
  groups: ServerGroup[];
  servers: ServerConfig[];
  tabs: TerminalTab[];
  activeTabId: string | null;
  sftpPanelHeight: number;
  sftpPanelCollapsed: boolean;
  sidebarWidth: number;

  setThemeMode: (mode: ThemeMode) => void;
  setIsDark: (dark: boolean) => void;
  addTab: (tab: TerminalTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  setSftpPanelHeight: (h: number) => void;
  toggleSftpPanel: () => void;
  setSidebarWidth: (w: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  themeMode: "system",
  isDark: false,
  groups: [
    { id: "prod", name: "生产环境" },
    { id: "test", name: "测试环境" },
  ],
  servers: [],
  tabs: [],
  activeTabId: null,
  sftpPanelHeight: 200,
  sftpPanelCollapsed: false,
  sidebarWidth: 220,

  setThemeMode: (mode) => set({ themeMode: mode }),
  setIsDark: (dark) => set({ isDark: dark }),
  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? tabs[tabs.length - 1]?.id ?? null : s.activeTabId;
      return { tabs, activeTabId };
    }),
  setActiveTab: (id) => set({ activeTabId: id }),
  setSftpPanelHeight: (h) => set({ sftpPanelHeight: Math.max(120, Math.min(600, h)) }),
  toggleSftpPanel: () => set((s) => ({ sftpPanelCollapsed: !s.sftpPanelCollapsed })),
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(160, Math.min(400, w)) }),
}));

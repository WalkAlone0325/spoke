import { create } from "zustand";
import type { StoredGroup, StoredServer } from "./settings";

export type ThemeMode = "system" | "light" | "dark";

export type ServerConfig = StoredServer;

export type ServerGroup = StoredGroup;

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
  connectDialogOpen: boolean;
  editingServerId: string | null;
  remoteCwd: Record<string, string>;
  localCwd: string;

  setThemeMode: (mode: ThemeMode) => void;
  setIsDark: (dark: boolean) => void;
  setServers: (list: ServerConfig[]) => void;
  setGroups: (list: ServerGroup[]) => void;
  addTab: (tab: TerminalTab) => void;
  updateTab: (id: string, patch: Partial<TerminalTab>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  setSftpPanelHeight: (h: number) => void;
  toggleSftpPanel: () => void;
  setSidebarWidth: (w: number) => void;
  openConnectDialog: (editingId?: string | null) => void;
  closeConnectDialog: () => void;
  setRemoteCwd: (sessionId: string, path: string) => void;
  setLocalCwd: (path: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  themeMode: "system",
  isDark: false,
  groups: [],
  servers: [],
  tabs: [],
  activeTabId: null,
  sftpPanelHeight: 200,
  sftpPanelCollapsed: false,
  sidebarWidth: 220,
  connectDialogOpen: false,
  editingServerId: null,
  remoteCwd: {},
  localCwd: "",

  setThemeMode: (mode) => set({ themeMode: mode }),
  setIsDark: (dark) => set({ isDark: dark }),
  setServers: (list) => set({ servers: list }),
  setGroups: (list) => set({ groups: list }),
  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    })),
  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
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
  openConnectDialog: (editingId = null) =>
    set({ connectDialogOpen: true, editingServerId: editingId }),
  closeConnectDialog: () => set({ connectDialogOpen: false, editingServerId: null }),
  setRemoteCwd: (sessionId, path) =>
    set((s) => ({ remoteCwd: { ...s.remoteCwd, [sessionId]: path } })),
  setLocalCwd: (path) => set({ localCwd: path }),
}));

export function openSftpPath(path: string) {
  const s = useAppStore.getState();
  const active = s.tabs.find((t) => t.id === s.activeTabId);
  if (!active?.sessionId || !active.connected) return;
  if (s.sftpPanelCollapsed) {
    useAppStore.setState({ sftpPanelCollapsed: false });
  }
  s.setRemoteCwd(active.sessionId, path);
}

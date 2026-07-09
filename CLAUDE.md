# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Spoke 是 **SSH 终端 + SFTP 文件传输**深度整合的桌面工具，基于 Tauri v2 + Rust + React 19 + TypeScript 构建。核心差异化：终端路径可点击直接跳转 SFTP 面板（双向联动），非 Electron 套壳。

完整开发计划见 `roadmap.md`（分为 Phase 0~5，MVP 覆盖 Phase 0/1/2）。任何架构变更前必读该文件。

## 常用命令

包管理器统一使用 **pnpm**（`tauri.conf.json` 的 `beforeDevCommand` / `beforeBuildCommand` 均硬编码为 pnpm，勿改成 npm/yarn）。

```bash
pnpm install                 # 安装前端依赖
pnpm tauri dev               # 开发模式（同时启动 Vite 1420 端口和 Rust 主进程）
pnpm tauri build             # 打包桌面应用（生成各平台安装包）
pnpm dev                     # 仅前端 dev server（用于调试 UI，无 Tauri IPC）
pnpm build                   # tsc 严格类型检查 + Vite 构建
cd src-tauri && cargo check  # 仅检查 Rust 代码，不启动应用
cd src-tauri && cargo test   # Rust 单元测试
```

Vite dev server 固定端口 `1420`（`strictPort: true`），被占用会直接失败——不要改端口号，Tauri 依赖它。

## 架构关键点

### 双进程 IPC 模型

前端（React）与后端（Rust）通过 Tauri 的 `invoke` + `event` 通信，SSH/SFTP 全部落在 Rust 侧：

- **命令（同步请求-响应）**：`invoke('ssh_connect', {...})`、`invoke('list_files', { path })` 等在 `src-tauri/src/commands/` 定义，通过 `tauri::generate_handler![...]` 注册到 `lib.rs`。
- **事件（异步流）**：终端输出、传输进度等高频/流式数据通过 `app.emit("terminal:data", ...)` 推送，前端用 `listen()` 订阅。**不要**用 `invoke` 轮询终端输出。

会话状态（活跃的 SSH session、SFTP handle）保存在 Rust 侧，用 `tauri::State<Mutex<HashMap<SessionId, ...>>>` 管理；前端只持有 `session_id` 字符串。

### Rust 侧模块划分（按 roadmap 规范落地）

```
src-tauri/src/
├── main.rs / lib.rs         # 入口，注册 handler
├── ssh/{client,sftp}.rs     # russh + russh-sftp 封装，Tokio 异步
├── commands/{terminal,filesystem}.rs  # #[tauri::command] 定义
└── store/config.rs          # tauri-plugin-store + keyring（密码走系统密钥链，配置文件仅存占位符）
```

**安全铁律**：任何密码/私钥 passphrase 都必须走 `keyring` crate（macOS Keychain / Windows Credential Manager），`settings.json` 只存 `{ "password_ref": "<keyring-id>" }`。开发阶段（Phase 1）允许明文，Phase 4 前必须迁移完成。

### 前端状态与终端渲染

- **状态**：Zustand（`src/store/appStore.ts`）持有服务器列表、当前活跃 tab、连接状态。跨组件共享一律走 store，避免 prop drilling。
- **终端**：XTerm.js + `xterm-addon-fit`（自适应尺寸）+ `xterm-addon-webgl`（性能）。窗口 resize 时必须触发 `fitAddon.fit()`，否则 PTY 大小与显示不一致会出乱码。
- **远程文件列表**：远端目录可能有数万条目，必须用 `@tanstack/react-virtual` 或 `react-window` 虚拟滚动，禁止直接 map 渲染。

### 终端 ↔ SFTP 联动（Phase 3 核心）

这是项目差异化功能，实现时注意：

1. **终端 → SFTP**：前端在 XTerm 输出流上跑正则匹配绝对路径，标记为可点击 link（`xterm` 提供 `registerLinkProvider` API）；点击时调用全局 store 的 `openSftpPath(path)`，触发 SFTP 面板切换目录并展开（若折叠）。
2. **SFTP → 终端**：右键菜单发送 `cd <path>\n` 到当前活跃 SSH session（通过 `invoke('send_data')`），或新开 tab 后再发送。

### 布局与主题

三栏布局（左侧栏 220px / 中央 flex / 底部可拖拽面板，默认 200px），分割线用 Tauri 原生拖拽或纯 CSS `resize`。暗色/亮色跟随系统，通过 `tauri-plugin-os` 读系统偏好 + `usePreferredDark` 监听，Tailwind 的 `dark:` 前缀切换。

### 品牌资源

`spoke-logo.svg` 是应用图标源文件（品牌蓝 `#0057FF` → 青绿 `#00C8A0` 渐变），需通过 `pnpm tauri icon ./spoke-logo.svg` 生成 `src-tauri/icons/` 下各平台图标（覆盖当前默认 Tauri 图标）。

## 遵循 roadmap 的开发顺序

严格按 Phase 0 → 5 推进，不要跳步：Phase 1 的 SSH 通道是 Phase 2 SFTP 的前置（SFTP 复用同一 session），Phase 3 联动依赖 Phase 1/2 完成。每个 Phase 的验收标准即 roadmap 中该 Phase 的任务清单。

以下是整合后的完整 Roadmap 文档，可直接保存为 `README.md` 或 `ROADMAP.md` 使用。

---

# Spoke — SSH + SFTP 二合一工具 · 开发路线图

> **项目代号**：Spoke  
> **Slogan**：Connect. Command. Convey.  
> **仓库**：https://github.com/yourname/spoke (待创建)  
> **开源协议**：MIT 或 GPLv3（待定）

---

## 📖 项目概述

**Spoke** 是一款面向开发者和运维人员的现代化远程服务器管理工具，将 **SSH 终端** 和 **SFTP 文件传输** 深度整合为统一工作流。基于 **Tauri v2** 和 **Rust** 构建，天生具备低内存占用（空闲 < 80MB）、高性能和跨平台（macOS / Windows / Linux）优势。

**核心差异化**：
- 终端内路径点击直接跳转 SFTP 面板（双向联动）
- 轻量原生，非 Electron 套壳
- 开源透明，密码通过系统密钥链加密存储

---

## 🎨 品牌设计规范

### Logo（极简几何风）
![Spoke Logo](./spoke-logo.svg)  
- **图形**：圆形枢纽（Hub）向外辐射三条渐变曲线（辐条）  
- **主色**：品牌蓝 `#0057FF` → 青绿 `#00C8A0`  
- **辅助色**：深空灰 `#1C1C1E` / `#3A3A3C`

### 配色方案
| 用途 | 亮色模式 | 暗色模式 |
| :--- | :--- | :--- |
| 背景 | `#F5F5F5` | `#0D0D0D` |
| 主色 | `#0057FF` | `#0057FF` |
| 成功/数据流 | `#00C8A0` | `#00C8A0` |
| 文本主色 | `#1A1A1A` | `#E5E5E5` |

### 字体
- **界面/标题**：Inter 或 SF Pro Display
- **终端/代码**：JetBrains Mono 或 Fira Code

---

## 🧱 全局技术栈

| 层级 | 选型 | 备注 |
| :--- | :--- | :--- |
| 桌面框架 | **Tauri v2** | Rust + Web 前端，轻量安全 |
| 前端框架 | **React 18 + TypeScript** | Vite 构建 |
| UI 样式 | **Tailwind CSS + Headless UI** | 支持深色/浅色跟随系统 |
| 终端渲染 | **XTerm.js** | 开启 `xterm-256color`，使用 `WebGL` 加速 |
| Rust SSH | **`russh` + `russh-sftp`** | 纯 Rust，Tokio 异步运行时 |
| 加密存储 | **`keyring`** | 调用 macOS Keychain / Windows Credential Manager |
| 配置持久化 | **`serde_json` + `tauri-plugin-store`** | 存储连接配置（不含密码） |
| 状态管理 | **Zustand** | 全局 React 状态 |
| 通信 | **Tauri IPC (invoke + events)** | 双向异步消息 |

---

## 🗺️ 界面布局原型（Wireframe）

整体窗口分为三大区域，默认尺寸 800×600，支持自由拖拽调整分割线。

```
+------------------+--------------------------------------------------+
|  侧边栏 (220px)   |   中央区域 (Flex:1)                                |
|  ┌──────────────┐ |  ┌──────────────────────────────────────────────┐ |
|  │ 🔍 搜索服务器 │ |  │  [Tab1] [Tab2] [+]                            │ |
|  ├──────────────┤ |  ├──────────────────────────────────────────────┤ |
|  │ 📁 生产环境   │ |  │                                              │ |
|  │   🖥️ web-01   │ |  │           终端视图 (XTerm.js)                 │ |
|  │   🖥️ db-01    │ |  │         (全黑背景，适应窗口)                  │ |
|  │ 📁 测试环境   │ |  │                                              │ |
|  │   🖥️ test-01  │ |  │                                              │ |
|  ├──────────────┤ |  └──────────────────────────────────────────────┘ |
|  │ [+ 新建连接]  │ |                                                |
|  └──────────────┘ |                                                |
+--------------------+--------------------------------------------------+
|  底部面板 (高度可拖拽，默认200px)                                    |
|  ┌──────────────────────────────────────────────────────────────┐  |
|  │  SFTP 文件管理器 (双栏)                                     │  |
|  │  [本地] /Users/xxx/  [远程] /var/www/html/                  │  |
|  │  ├── src/         ├── index.html                           │  |
|  │  ├── package.json  ├── style.css                           │  |
|  │  └── ...           └── ...                                │  |
|  └──────────────────────────────────────────────────────────────┘  |
+------------------------------------------------------------------+
```

**关键交互**：
- 终端内 `Cmd+Click` 路径 → 底部 SFTP 面板自动跳转
- SFTP 面板右键文件 → “在此路径打开终端” → 新建终端标签并 `cd` 至该目录
- 文件拖拽到 SFTP 面板 → 自动上传/下载

---

## 🚀 开发路线图（可勾选任务）

### 🟢 Phase 0：项目基建与骨架（预计 1 天）
*目标：搭建 Tauri 项目，完成 UI 骨架和主题适配。*

- [x] 0.1 初始化 Tauri v2 项目 (`pnpm create tauri-app`)，选择 React + TS
- [x] 0.2 安装并配置 Tailwind CSS + Headless UI
- [x] 0.3 创建三栏布局（左侧边栏、中央区域、底部可拖拽面板），使用 Tauri 拖拽分割线
- [x] 0.4 实现暗色/亮色模式跟随系统（`usePreferredDark` + `tauri-plugin-os`）
- [x] 0.5 安装 Zustand，创建全局 `useAppStore`（服务器列表、活动标签页 ID 等）
- [x] 0.6 将 Logo SVG 设置为应用图标（生成各平台图标并配置 `tauri.conf.json`）

---

### 🟢 Phase 1：SSH 终端核心（预计 3 天）
*目标：能连接服务器，输入命令并看到输出。*

- [x] 1.1 Rust 端实现 SSH 连接器（`russh::client::connect`），支持密码和私钥认证
- [x] 1.2 编写 Tauri Command `ssh_connect`，返回 session ID
- [x] 1.3 封装 XTerm.js 组件，集成 `fitAddon`（自适应）和 `webglAddon`（加速）
- [x] 1.4 建立 IPC 双向通信：
  - 前端输入 → `invoke('send_data', { data })` → Rust 写入 SSH channel
  - Rust 异步读取 channel 输出 → `emit` 事件 → 前端写入 XTerm
- [x] 1.5 实现会话保活（每 30s 发送 keepalive 包）
- [x] 1.6 保存连接配置（主机、端口、用户名）到 `settings.json`（使用 `tauri-plugin-store`），密码暂明文存储（仅开发阶段）

---

### 🟢 Phase 2：SFTP 文件传输（预计 3 天）
*目标：看到远程文件列表，实现上传/下载及进度。*

- [x] 2.1 Rust 端基于现有 SSH session 创建 SFTP 实例（`russh-sftp`）
- [x] 2.2 实现 Tauri Command `list_files(path)`，返回文件列表 JSON（名称、大小、类型、修改时间）
- [x] 2.3 前端使用虚拟滚动（`react-window` 或 `@tanstack/react-virtual`）渲染远程文件列表，防止卡死
- [x] 2.4 实现本地文件浏览（使用 `tauri-plugin-fs`），显示在左侧栏
- [x] 2.5 实现文件上传/下载流式传输（Rust 异步读写，支持大文件）
- [x] 2.6 实现传输进度条（通过事件流推送进度到前端）

**Phase 2 实际交付细节**：
- `SessionManager` 惰性缓存 `SftpClient`，会话移除时一并释放
- 命令集：`sftp_list / sftp_home / sftp_mkdir / sftp_remove / sftp_rename / sftp_upload / sftp_download / local_list / local_home`
- 上传/下载 64KB 缓冲流式 + `sftp://progress` 事件流（增量节流）
- 前端双栏面板：本地 + 远程虚拟滚动、面包屑路径导航、上级目录跳转
- 传输队列条：方向图标、渐变进度、完成/失败状态色

---

### 🟢 Phase 3：深度融合交互（预计 2 天）
*目标：打造无缝“二合一”体验，形成竞争力。*

- [x] 3.1 终端路径嗅探：前端监听 XTerm 的 `onKey`，正则匹配绝对路径（如 `/var/log`），检测双击或 `Cmd+Click`
- [x] 3.2 点击路径后调用 `open_sftp_path(path)`，底部 SFTP 面板自动切换至该目录，并自动展开面板（若折叠）
- [x] 3.3 SFTP 面板右键菜单增加 “在此路径打开终端” → 创建新标签，执行 `cd path`
- [x] 3.4 实现拖拽上传（从操作系统拖拽文件到 SFTP 面板区域），触发上传流程
- [x] 3.5 连接状态全局同步：断开连接时，左侧状态点变红，SFTP 面板锁定不可操作

**Phase 3 实际交付细节**：
- `useXterm` 通过 `registerLinkProvider` + 正则匹配绝对路径，Cmd/Ctrl+Click 触发 `onOpenPath`
- 新增 `sftp_stat` 命令：判断点击路径是目录还是文件，文件则自动跳到父目录
- 全局 `openSftpPath(path)` action：自动展开折叠的 SFTP 面板 + 切换 `remoteCwd`
- 通用 `ContextMenu` 组件（Portal + 键盘 ESC + 点击外关闭）
- 远程条目右键：打开 / 在终端 cd / 复制路径 / 下载 / 删除；空白右键：上传 / 刷新 / 复制当前路径
- 拖拽上传：`webview.onDragDropEvent` 监听 Tauri 原生拖入，落到远程栏区域触发 `uploadFiles`，进入时叠加品牌色高亮 overlay
- 会话断开时（`onClosed`/`onExit`/`onError`）标 `connected: false`，SFTP 面板依据 `connected` 判断而非仅 `sessionId`，锁定所有操作

---

### 🟢 Phase 4：安全与配置增强（预计 2 天）
*目标：加密凭证，兼容现有 SSH 配置，支持跳板机。*

- [ ] 4.1 将密码/私钥密码迁移至系统密钥链（`keyring` crate），JSON 中仅存储占位符引用
- [ ] 4.2 实现导入 `~/.ssh/config`：启动时解析该文件，自动生成服务器条目（仅读取不写入）
- [ ] 4.3 支持跳板机（ProxyJump）：连接配置增加 “Jump Server” 字段，Rust 端实现 `russh::config::SshConfig` 的 proxy_jump
- [ ] 4.4 支持 HTTP/Socks5 代理（界面输入或读取环境变量 `HTTP_PROXY` / `SOCKS5_PROXY`）

---

### 🔵 Phase 5：UI 打磨与生产力增强（V1.0 发布前，预计 2 天）
*目标：从”能用”变成”好用”，增加差异化特性。*

- [ ] 5.1 提供 5 种终端主题预设（One Dark, Dracula, Solarized, Nord, 默认暗色）
- [ ] 5.2 全局快捷键：注册 `Cmd+Shift+T`（或自定义），随时呼出/隐藏主窗口（类似 iTerm2 的热键窗）
- [ ] 5.3 内置编辑器联动（Save & Upload）：
  - 双击 SFTP 中的代码文件（`.txt`、`.js`、`.py` 等），下载到临时目录并调用系统默认编辑器（如 VSCode）
  - 监听文件修改时间，若变更则提示”是否上传更改？”
- [ ] 5.4 传输队列管理器：在 SFTP 面板底部显示传输任务列表，支持暂停/恢复/清空
- [ ] 5.5 完成多语言支持（i18n）初版（中/英文）

---

## ✨ 额外交付（未在 Roadmap 中，但已实现）

Phase 2 期间额外补齐的体验类改动，均已提交：

- [x] **液态玻璃 UI（macOS Tahoe 风格）**：窗口 `transparent + titleBarStyle: Overlay`；`.glass` 工具类（多层内阴影 + 深度 backdrop-filter）；三栏卡片 `rounded-2xl` 浮起；`trafficLightPosition {x:18, y:24}` 精调红绿灯位置；顶部品牌头/Tab/SFTP 头条统一支持窗口拖拽
- [x] **ConnectDialog 增强**：品牌渐变分段控件（认证方式）、Headless UI Listbox 分组选择、密码/Passphrase **眼睛图标切换可见性**、独立「测试连接」按钮 + 结果反馈
- [x] **Sidebar 交互精修**：品牌 Logo + Slogan 双行头、搜索框实时过滤（name/host/user）、分组计数徽章、在线服务器状态点 **Ping 光晕动画**、编辑按钮 hover 浮现
- [x] **Tab 关闭二次确认**：连接中的 Tab 关闭前弹出确认弹窗，先 `sshDisconnect` 再从 store 移除
- [x] **双击新建连接**：Sidebar 服务器条目改为**仅双击**触发连接，避免误触
- [x] **ResizeHandle 药丸把手**：默认灰色小条，hover/拖拽变品牌渐变 + 放大，视觉反馈明确
- [x] **稳定性修复**：
  - `ConnectResult` 补 `rename_all = “camelCase”`，修复前端 `sessionId` 为 `undefined` 导致终端不显示
  - `useSshSession` 修复 `StrictMode` 下 `listen()` 泄漏 → **终端输入双字符**问题（移除 StrictMode + cancelled 判断兜底）

---

## 📁 推荐项目目录结构

```
spoke/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── ssh/
│   │   │   ├── mod.rs
│   │   │   ├── client.rs      # russh 连接与认证
│   │   │   └── sftp.rs        # russh-sftp 文件操作
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── terminal.rs    # 终端相关命令
│   │   │   └── filesystem.rs  # 文件列表、上传下载
│   │   └── store/
│   │       └── config.rs      # 配置读写 + keyring 调用
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/ (前端)
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── TerminalView.tsx
│   │   └── SFTPPanel/
│   │       ├── LocalExplorer.tsx
│   │       └── RemoteExplorer.tsx
│   ├── hooks/
│   │   ├── useTerminal.ts     # 封装 XTerm 初始化和数据流
│   │   └── useSFTP.ts         # SFTP 操作 hooks
│   ├── store/
│   │   └── appStore.ts        # Zustand 全局状态
│   ├── styles/
│   │   └── index.css          # Tailwind 入口
│   └── App.tsx
├── public/
│   └── spoke-logo.svg
├── package.json
├── pnpm-lock.yaml
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## ⚙️ 开发环境准备

- Node.js 18+ / pnpm 8+
- Rust 1.70+ (使用 `rustup`)
- Tauri CLI (`cargo install tauri-cli`)
- 如需 macOS 图标生成，需安装 `png2icns` 或使用在线工具

---

## 📌 里程碑与发布计划

| 里程碑 | 预计完成时间 | 包含 Phase |
| :--- | :--- | :--- |
| **MVP 内部测试** | 第 2 周结束 | Phase 0 + 1 + 2（基本终端和文件传输） |
| **Beta 公开测试** | 第 4 周结束 | Phase 3 + 4（深度融合 + 安全增强） |
| **V1.0 正式发布** | 第 6 周结束 | Phase 5（打磨完成，发布首个稳定版） |

---

## 🤝 贡献指南（待补充）

欢迎贡献代码、反馈问题或提出功能建议。请阅读 CONTRIBUTING.md（待创建）了解详情。

---

**最后更新**：2026-07-10  
**状态**：🚧 开发中（Phase 0~2 完成，MVP 可用）

---

这份文档已涵盖所有必要内容。你可以直接保存为 Markdown 文件，放入项目仓库根目录。如果后续需要增减任务或调整顺序，随时可以修改。祝开发顺利！🦀

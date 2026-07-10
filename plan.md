# Spoke — 功能现状与完善计划

> **版本**：v0.1.0  
> **日期**：2026-07-10  
> **状态**：Phase 0~4 完成，Phase 5 进行中

---

## 一、已实现功能总览

### 1. 基础架构
- [x] Tauri v2 + React 19 + TypeScript + Vite 构建
- [x] Tailwind CSS 深色/亮色随系统切换
- [x] Zustand 全局状态管理
- [x] 三栏布局（侧边栏 220px / 终端 / SFTP 面板，分割线可拖拽）
- [x] 液态玻璃 UI（macOS Tahoe 风格：透明窗口 + blur + 多内阴影）
- [x] 全局快捷键 `Cmd+Shift+T` 显示/隐藏窗口
- [x] 通用 ContextMenu / ConfirmDialog 组件

### 2. SSH 终端
- [x] SSH 连接（密码/私钥文件/PEM 文本认证）
- [x] 跳板机 ProxyJump（支持嵌套认证）
- [x] HTTP / SOCKS5 代理隧道连接
- [x] PTY 申请 + locale 环境变量（`LANG/LC_ALL/LC_CTYPE = C.UTF-8`）
- [x] 会话 Keepalive（每 30s，失败通知）
- [x] XTerm.js 终端（WebGL 加速 + FitAddon 自适应 + WebLinksAddon）
- [x] 终端路径嗅探（Cmd+Click 路径跳转 SFTP 面板）
- [x] 5 种终端主题（Spoke Dark / One Dark / Dracula / Solarized / Nord）
- [x] 窗口 Resize → PTY resize 同步

### 3. SFTP 文件传输
- [x] 双栏文件浏览（本地 + 远程，虚拟滚动 `@tanstack/react-virtual`）
- [x] 面包屑路径导航 + 上级目录跳转
- [x] 文件上传/下载（64KB 流式缓冲）
- [x] 目录上传（递归扫描 + 自动创建远端目录）
- [x] 传输进度事件流（增量节流 64KB）
- [x] 传输队列列表（方向图标 + 进度条 + 完成/失败状态）
- [x] 传输取消（`CancellationToken` + 即时响应）
- [x] macOS 文件拖拽上传（Tauri `onDragDropEvent`）
- [x] 本地文件拖拽到远程面板上传
- [x] 右键菜单（打开/cd/复制路径/下载/删除/上传）
- [x] 单文件/多文件批量下载（跳过目录）

### 4. 深度融合联动
- [x] 终端路径点击 → SFTP 自动跳转（展开面板 + 切换目录）
- [x] SFTP 右键 "在终端打开" → 新建 Tab 执行 `cd`
- [x] 连接状态全局同步（断开时侧边栏变红 + SFTP 锁定）
- [x] 编辑器联动：下载 → 系统编辑器打开 → 轮询修改 → 弹窗上传

### 5. 服务器与配置管理
- [x] 服务器/分组 CRUD（双击连接、编辑、删除）
- [x] 服务器搜索过滤（name/host/user）
- [x] 分组折叠 + 计数徽章 + 在线状态 Ping 光晕
- [x] 默认分组（生产/测试）保护（不可编辑删除）
- [x] SSH Config 导入（`~/.ssh/config` 解析）
- [x] 系统密钥链加密存储（`keyring` crate）
- [x] `settings.json` 持久化（Tauri Plugin Store）
- [x] 剪贴板操作（复制路径）

---

## 二、当前阶段的缺失项

### Phase 5 未完成
| 条目 | 现状 | 剩余工作 |
|------|------|----------|
| 5.4 传输队列管理器 | 已有取消功能 | 缺少暂停/恢复、单条重试、排序拖拽 |
| 5.5 多语言 i18n | 未实现 | 无 i18n 框架，UI 硬编码中文 |

### 已知缺陷
| 问题 | 说明 |
|------|------|
| `dialog.rs` 废弃代码 | 依赖 `objc2` 系列 crate，未被使用但被编译，增加构建负担 |
| macOS 原生文件弹窗侧边栏英文 | 系统 NSOpenPanel 跟随 macOS 语言，无法单独设置中文 |
| 目录递归下载未实现 | 多选批量下载时跳过目录 |
| 无传输暂停/恢复 | 只能取消，不能暂停后继续 |
| Rust 编译 warning | `dialog.rs` 大量 `unnecessary unsafe` warnings |

---

## 三、完善计划（建议优先级排序）

### P0：关键缺陷修复（1~2 天）

1. **重构文件选择弹窗** — 替换 `@tauri-apps/plugin-dialog` 的 `open()`/`save()` 为应用内自建面板，复用 `LocalColumn` 组件，支持中文界面 + 目录树选择。参考 VSCode 的"打开文件"弹窗风格
2. **目录递归下载** — 实现 `sftp_download_dir` 命令，递归扫描远程目录结构，下载到本地对应路径
3. **清理 dialog.rs** — 删除 `dialog.rs` 及对应命令注册，移除 `objc2`/`rfd` 依赖

### P1：Phase 5 收尾（2~3 天）

4. **传输队列暂停/恢复**（5.4）
   - Rust: `PauseToken` 类似 `CancellationToken` 但可恢复，或每次暂停时记下 offset，恢复时 `open_with_flags` + `pread` 续传
   - 前端: TransferBar 增加暂停/恢复按钮，区分暂停态和取消态
   - 考虑实现 `sftp_pause_transfer` / `sftp_resume_transfer` 命令

5. **多语言 i18n 初版**（5.5）
   - 方案：`react-i18next` 或 `lingui`，用 JSON 资源文件
   - 覆盖：Sidebar / TerminalArea / SftpPanel / ConnectDialog / ConfirmDialog / ContextMenu
   - 中文（默认）+ 英文切换
   - 语言持久化到 `settings.json`

### P2：体验增强（2~3 天）

6. **连接恢复/重连** — 网络断开后自动或一键重连，恢复终端状态
7. **SFTP 文件搜索** — 在远程面板添加搜索框，支持文件名模糊过滤（服务端 `find` 或内存过滤）
8. **文件冲突处理** — 上传/下载时同名文件弹窗：覆盖/跳过/重命名/比较
9. **传输记录持久化** — 已完成传输保存到 `settings.json`，重启可见历史
10. **服务器配置导出/导入** — JSON 格式导出服务器列表（不含密钥链凭证）

### P3：差异化功能（4~5 天）

11. **SSH Key 生成器** — 内建 `ssh-keygen` 类型界面，生成密钥对并可选上传到远程服务器
12. **双栏传输对比** — 本地和远程选择栏可直接互相拖拽触发上传/下载（目前只能本地→远程拖拽）
13. **终端日志记录** — 会话输出保存到本地文件，支持回放搜索
14. **命令面板** — `Cmd+Shift+P` 类似 VSCode 命令面板，快速执行：连接/上传/切换主题/等
15. **SFTP 书签** — 收藏常用远程目录，快速跳转

### P4：工程与发布（2~3 天，V1.0 前）

16. **应用图标完善** — 用 `spoke-logo.svg` 生成所有平台图标格式
17. **CI/CD 配置** — GitHub Actions 自动构建 macOS/Windows/Linux 安装包
18. **代码签名** — macOS 公证 + Windows Authenticode 签名
19. **自动更新** — 集成 `tauri-plugin-updater`，发布版本检查
20. **用户手册** — 中文 README + 功能说明 + 截图

---

## 四、技术债务

| 项目 | 说明 | 建议 |
|------|------|------|
| `dialog.rs` | 废弃 macOS 原生弹窗尝试 | 删除文件及命令注册 |
| `objc2` 系列依赖 | 仅为 `dialog.rs` 引入 | 删除后一并移除 |
| `rfd` crate | 仅为非 macOS 兜底代码引入 | 删除后一并移除 |
| `tauri-plugin-dialog` | 当前用于前端 open/save | 实现 P0 第 1 项后可移除 |
| `settings.json` schema 验证 | 运行时无结构校验 | 考虑 zod 或 typed 加载 |
| 错误处理 | 部分 unwrap 未处理 | 全局 audit 替换为优雅处理 |

---

## 五、建议执行顺序

```
周 1-2 : P0 关键修复（文件弹窗 + 目录下载 + dialog.rs 清理）
周 3-4 : P1 Phase 5 收尾（暂停恢复 + i18n）
周 5-6 : P2 体验增强（重连 + 搜索 + 冲突 + 历史）
周 7-8 : P3 差异化功能（Key 生成 + 双向拖拽 + 日志 + 命令面板）
周 9-10: P4 工程与发布（CI/CD + 签名 + 更新 + 文档）
```

每个周期结束时发一个 alpha/beta 版本收集反馈。

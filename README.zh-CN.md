# UI-LLM

[English](./README.md)

UI-LLM 是一个仅支持 Windows 的本地 Electron 应用，用于接入多供应商（OpenAI 兼容接口）的：

- 聊天（流式输出 + “停止生成”）
- 知识库 RAG（txt/md/pdf）
- 生图（文生图 + 图生图）
- 月度限额与用量记账

## 目录

- [功能特性](#功能特性)
- [运行要求](#运行要求)
- [快速开始（开发）](#快速开始开发)
- [构建与打包（Windows EXE）](#构建与打包windows-exe)
- [配置说明](#配置说明)
- [数据与安全](#数据与安全)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可协议](#许可协议)

## 功能特性

- 多供应商接入：通过 OpenAI 兼容 REST 端点（`/chat/completions`、`/embeddings`、`/images/*`）统一调用
- 聊天流式输出，支持“停止生成”（中止后保留已生成内容并标记为“已中止”）
- 聊天气泡内支持 Markdown（GFM）渲染
- 会话管理：新会话、重命名、删除、搜索、排序
- 导出能力：单会话导出 JSON/Markdown/PDF；支持批量导出、批量重命名、批量删除
- RAG：支持 `txt`/`md`/`pdf` 入库并做相似度检索
- 生图：文生图 + 可选参考图的图生图
- 内置安全限制：
  - RAG 入库：单次最多 3 个文件，总大小不超过 15MB
  - 图生图参考图：`png/jpg/jpeg`，不超过 10MB，最长边不超过 4096px
- 成本与限额：可配置供应商单价（CNY），提供月限额（默认阻断，支持“仅放开本次”）
- 本地优先：数据落盘在本机；API Key 优先使用 Windows 凭据管理器存储

## 运行要求

- Windows 10/11
- Node.js `22.x`（推荐）
- npm

说明：

- 本项目依赖 `keytar`（原生模块），某些环境需要安装 Visual Studio Build Tools 并勾选“使用 C++ 的桌面开发”。
- 若仅需验证前端构建，可用 `npm install --ignore-scripts` 跳过原生依赖构建，再执行 `npm run build`。

## 快速开始（开发）

```bash
npm install
npm run dev
```

运行逻辑：

- Vite 开发服务器监听 `http://localhost:5173`
- Electron 等待 `5173` 端口可用后启动桌面窗口

## 构建与打包（Windows EXE）

构建前端资源：

```bash
npm run build
```

稳定版打包脚本（推荐）：

```bash
npm run pack:win:stable
```

细节：

- 脚本：`scripts/pack-win-stable.ps1`
- 行为：可选清理 Electron 缓存 → 可选安装依赖 → 构建 → 尝试打 NSIS 安装包；失败则回退为便携版 EXE
- 输出：脚本会枚举并打印 `release/**/UI-LLM.exe` 的所有路径

直接打包命令：

- `npm run pack:win`（NSIS 安装包）
- `npm run pack:portable`（便携目录）

## 配置说明

所有供应商配置都在应用内完成：

- 供应商名称
- Base URL（OpenAI 兼容）
- API Key
- 模型列表（每行：`模型ID,展示名`）
- 单价配置（CNY）：输入 1k、输出 1k、生图每次

限额：

- 设置月限额（CNY）
- 达到限额后默认阻断请求
- 可选择“仅放开本次请求”以允许一次超限

## 数据与安全

数据位置：

- 应用数据目录为 `Electron app.getPath("userData")`
- SQLite 数据库：`app.db`（会话、消息、供应商、RAG 向量、用量台账等）
- 日志：`userData/logs`（自动清理：最多保留 40 天且总量不超过 500MB）
- RAG 快照：`userData/rag-snapshots`

API Key 存储：

- 优先：通过 `keytar` 写入 Windows Credential Manager
- 回退（当 `keytar` 不可用时）：`userData/credentials.local.json`（明文 JSON）

建议：

- 将 `credentials.local.json` 视为敏感文件处理。
- 反馈问题时避免分享 API Key 和包含个人信息的聊天导出文件。

## 项目结构

- `src/`：渲染进程（React + Vite）
- `electron/`：主进程、IPC、各类本地服务（SQLite、凭据、RAG、导出等）
- `scripts/`：打包辅助脚本
- `release/`：构建产物（自动生成）

## 常见问题

- `keytar` 安装/编译失败：安装 Visual Studio Build Tools（C++ 桌面开发）后重试 `npm install`。
- 打包下载 Electron 过慢或失败：打包脚本默认设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 流式生成中止：UI 会保留已生成内容，并标记为“已中止”。

## 参与贡献

- 不要将任何密钥写入代码或提交到 git。
- 建议以小而清晰的变更提交 PR。

## 许可协议

当前为 UNLICENSED（默认视作内部/私有使用）。

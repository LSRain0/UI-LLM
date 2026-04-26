# UI-LLM

[中文说明](./README.zh-CN.md)

UI-LLM is a Windows-only local Electron app for multi-provider, OpenAI-compatible:

- Chat (streaming + “Stop”)
- RAG (txt/md/pdf)
- Image generation (text-to-image + img2img)
- Monthly budget control and usage accounting

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start (Dev)](#quick-start-dev)
- [Build & Package (Windows EXE)](#build--package-windows-exe)
- [Configuration](#configuration)
- [Data & Security](#data--security)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- Multi-provider support via OpenAI-compatible REST endpoints (`/chat/completions`, `/embeddings`, `/images/*`)
- Streaming chat output with “Stop” (aborted output is preserved and marked as aborted)
- Markdown rendering (GFM) inside chat bubbles
- Conversation management: new chat, rename, delete, search, sort
- Export: JSON/Markdown/PDF; batch export + batch rename + batch delete
- RAG pipeline: ingest `txt`/`md`/`pdf` into local store and run similarity search
- Image generation: text-to-image and optional reference image for img2img
- Built-in safety guards:
  - RAG ingest: up to 3 files per run, total size up to 15MB
  - Img2Img reference image: `png/jpg/jpeg`, up to 10MB, max edge 4096px
- Cost controls: per-provider unit prices + monthly limit (block by default, allow one request over-limit)
- Local-first: data stored on your machine; API keys stored via Windows Credential Manager when available

## Requirements

- Windows 10/11
- Node.js `22.x` (recommended)
- npm

Notes:

- This project uses `keytar` (native module). On some machines it may require Visual Studio Build Tools with “Desktop development with C++”.
- For renderer-only build validation you can do `npm install --ignore-scripts` and then `npm run build`.

## Quick Start (Dev)

```bash
npm install
npm run dev
```

What happens:

- Vite dev server runs on `http://localhost:5173`
- Electron waits for port `5173`, then launches the desktop window

## Build & Package (Windows EXE)

Build renderer:

```bash
npm run build
```

Stable packaging script (recommended):

```bash
npm run pack:win:stable
```

Details:

- Script: `scripts/pack-win-stable.ps1`
- Behavior: cleans Electron caches (optional) → installs deps (optional) → builds → packages NSIS installer; falls back to portable EXE on failure
- Outputs: looks under `release/**/UI-LLM.exe` and prints all found paths

Direct packaging commands:

- `npm run pack:win` (NSIS installer)
- `npm run pack:portable` (portable directory)

## Configuration

All provider configuration happens inside the app UI:

- Provider name
- Base URL (OpenAI-compatible)
- API key
- Models list (one per line: `model-id,display-name`)
- Pricing fields (CNY): input per 1k, output per 1k, image per call

Budget control:

- Set monthly limit (CNY)
- When the limit is reached, requests are blocked by default
- You can allow exactly one request to exceed the limit

## Data & Security

Where data lives:

- App data directory is `Electron app.getPath("userData")`
- SQLite database: `app.db` (conversations, messages, providers, RAG vectors, usage ledger)
- Logs: `userData/logs` (auto-cleaned: up to 40 days and 500MB)
- RAG snapshots: `userData/rag-snapshots`

API key storage:

- Preferred: Windows Credential Manager via `keytar`
- Fallback (when `keytar` is unavailable): `userData/credentials.local.json` (plain JSON)

Practical advice:

- Treat `credentials.local.json` as sensitive.
- When reporting bugs, avoid sharing your keys and personal conversation exports.

## Project Structure

- `src/`: renderer (React + Vite)
- `electron/`: main process, IPC handlers, local services (SQLite, credentials, RAG, export)
- `scripts/`: packaging helpers
- `release/`: build outputs (generated)

## Troubleshooting

- `keytar` install/build fails: install Visual Studio Build Tools (Desktop C++) and retry `npm install`.
- Packaging is slow or fails downloading Electron: the packaging script sets `ELECTRON_MIRROR` to `https://npmmirror.com/mirrors/electron/` by default.
- Stream stops mid-way: the UI keeps partial output and marks it as aborted.

## Contributing

- Keep secrets out of git history.
- Prefer small, focused changes.

## License

UNLICENSED (internal / private use by default).

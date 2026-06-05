# WoopMemo

A powerful desktop note-taking application with built-in AI capabilities. Capture ideas, manage tasks, and let AI help you think and create.

![macOS](https://img.shields.io/badge/macOS-15+-purple)
![Tauri](https://img.shields.io/badge/Tauri-2.0-cyan)
![React](https://img.shields.io/badge/React-19-blue)

## Features

### 📝 Rich Note Editing
- **Tiptap Editor** — Write with Markdown support, code syntax highlighting, tables, and more
- **File Attachments** — Embed images, videos, and files directly in your notes
- **Mermaid Diagrams** — Create flowcharts, sequence diagrams, and more with code blocks

### 🏷️ Organization
- **Tags & Notebooks** — Organize notes with customizable tags and notebook categories
- **Quick Search** — Find any note instantly with full-text search
- **Favorites** — Pin important notes for quick access

### ✅ Task Management
- **Todo Lists** — Track tasks directly within notes with checkboxes
- **Status Tracking** — Mark tasks as pending/completed

### 🤖 AI Assistant
- **Built-in AI Agent** — Chat with AI directly in your notes
- **Multiple Providers** — Support for OpenAI, Anthropic, and DeepSeek
- **Streaming Responses** — Real-time AI responses as they're generated

### 🖥️ Desktop Native
- **Native Performance** — Built with Tauri + Rust for speed and low resource usage
- **Multi-window** — Open notes in separate windows
- **File-based Storage** — Your notes are plain Markdown files you own

## Screenshots

*Coming soon*

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2 |
| Backend | Rust, SQLite |
| Frontend | React 19, TypeScript |
| Editor | Tiptap |
| State Management | Zustand |
| UI | Tailwind CSS, shadcn/ui |
| AI | rllm (OpenAI/Anthropic/DeepSeek) |

## Getting Started

### Prerequisites

- macOS 14+ or Windows 10+
- Node.js 20+
- Rust 1.75+

### Installation

```bash
# Clone the repository
git clone https://github.com/aicollaborate/woop.git
cd woop

# Install frontend dependencies
cd app/frontend
npm install

# Run in development mode
npm run tauri dev
```

### Available Commands

```bash
cd app

# Full app development (with Rust backend)
npm run tauri dev

# Frontend only (localhost:1420)
npm run dev

# Production build
npm run tauri build
```

## Project Structure

```
woop/
├── app/
│   ├── backend/           # Tauri Rust backend
│   │   └── src/
│   │       ├── lib.rs     # App entry, plugin config
│   │       ├── commands.rs # IPC commands
│   │       ├── db.rs      # SQLite database
│   │       ├── memo_file.rs # File storage
│   │       ├── agent.rs   # AI agent
│   │       └── threads.rs  # Chat threads
│   └── frontend/          # React frontend
│       ├── components/
│       │   ├── mdeditor/  # Tiptap editor
│       │   ├── memo/      # Note list & detail
│       │   └── agent/     # AI chat interface
│       ├── lib/
│       │   ├── store/     # Zustand stores
│       │   └── tauri/     # RPC client
│       └── hooks/         # Custom React hooks
└── public/               # Static assets
```

## Data Storage

Notes are stored as Markdown files with YAML frontmatter:

```markdown
---
id: m_xxxxx
title: My Note
tags: [work, ideas]
createdAt: 1234567890
---

Your note content here...
```

Metadata is managed in `.metadata/` folders for each notebook.

## License

MIT
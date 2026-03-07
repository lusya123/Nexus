# Nexus - AI Agent Session Monitor

## 启动方式

**默认启动（推荐）**：

```bash
npm start
```

- 访问 http://localhost:7878
- 一体化服务（前后端同端口）
- 后台运行，适合日常使用

**开发模式**（仅用于修改代码）：

```bash
npm run dev:all
```

- 前端：http://localhost:5173（热重载）
- 后端：http://localhost:7878
- 前台运行，占用终端

## 端口说明

- **7878**：生产模式统一端口，开发模式后端 API 端口
- **5173**：仅开发模式前端端口（Vite 默认）

## 项目架构

- 后端：Express + WebSocket（监控 Claude Code/Codex/OpenClaw 会话）
- 前端：React + Vite（实时展示会话流和用量统计）
- 生产模式：后端静态服务前端构建产物（`dist/`）
- 开发模式：前后端独立运行，支持热重载

## 监控目录

- Claude Code：`~/.claude/projects/`
- Codex：`~/.codex/sessions/`
- OpenClaw：`~/.openclaw/agents/`

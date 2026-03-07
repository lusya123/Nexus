# Nexus

> 实时监控本地 AI Agent 会话的可视化工具

Nexus 是一个轻量级的本地监控工具，用于实时追踪和分析 AI Agent（Claude Code、Codex、OpenClaw）的会话活动、Token 使用量和成本统计。

## ✨ 特性

- **实时会话监控** - 自动发现并追踪正在运行的 AI Agent 会话
- **多工具支持** - 同时监控 Claude Code、Codex 和 OpenClaw
- **用量统计** - 实时聚合 Token 使用量和 USD 成本
- **历史回溯** - 自动扫描历史会话数据，提供完整的用量分析
- **WebSocket 实时推送** - 前端实时展示会话流和统计数据
- **零配置启动** - 一键启动，自动发现本地 Agent 目录

## 🚀 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/nexus.git
cd nexus

# 安装依赖
npm install
cd client && npm install && cd ..
```

### 启动服务

**日常使用（推荐）：**

```bash
npm start
```

然后访问：**http://localhost:7878** ✅

> 这是一体化服务，前后端运行在同一个端口，后台运行不占用终端。

**其他命令：**

```bash
npm stop           # 停止服务
npm restart        # 重启服务
npm run status     # 查看运行状态
```

---

### 端口说明

| 启动方式 | 命令 | 访问地址 | 使用场景 |
|---------|------|---------|---------|
| **生产模式** | `npm start` | **http://localhost:7878** | ✅ 日常使用（推荐） |
| 开发模式 | `npm run dev:all` | http://localhost:5173 | 仅用于修改前端代码 |

**重要提示：**
- 如果你只是想使用 Nexus 监控会话，用 `npm start` 访问 **7878** 端口
- 只有在需要修改前端代码时才用开发模式的 5173 端口

## 📖 使用说明

### 监控目录

Nexus 会自动监控以下目录中的 AI Agent 会话：

- **Claude Code**: `~/.claude/projects/`
- **Codex**: `~/.codex/sessions/`
- **OpenClaw**: `~/.openclaw/agents/`

### 会话状态

- **Active** - 正在活跃运行的会话
- **Idle** - 2 分钟内无新消息的会话
- **Cooling** - 进程已退出，等待最终状态确认
- **Gone** - 已结束并从列表移除

### 用量统计

- **实时统计** - 当前运行会话的 Token 和成本
- **历史统计** - 所有历史会话的累计用量
- **分工具统计** - 按 Claude Code、Codex、OpenClaw 分别统计

## 🛠️ 开发

### 开发模式（仅用于修改代码）

如果你需要修改前端代码并实时预览：

```bash
npm run dev:all
```

然后访问：**http://localhost:5173**（前端开发服务器，支持热重载）

> **注意**：开发模式会同时启动两个服务：
> - 前端开发服务器：5173（访问这个）
> - 后端 API 服务：7878（前端会自动连接）
>
> 日常使用请用 `npm start` 访问 7878 端口

### 运行测试

```bash
npm test                        # 运行所有测试
npm run test:codex              # Codex 解析器测试
npm run test:usage-parsers      # 用量解析器测试
npm run test:usage-manager      # 用量管理器测试
```

### 项目结构

```
Nexus/
├── server/              # 后端服务
│   ├── index.js        # 服务入口
│   ├── parsers/        # 各工具的日志解析器
│   ├── monitors/       # 文件和进程监控
│   └── usage/          # 用量统计和价格服务
├── client/             # 前端应用（React + Vite）
├── scripts/            # 启动控制脚本
├── tests/              # 测试文件
└── docs/               # 详细文档
```

## 📚 文档

- [架构设计](./docs/ARCHITECTURE.md) - 核心机制和设计决策
- [API 文档](./docs/API.md) - WebSocket API 规范
- [贡献指南](./docs/CONTRIBUTING.md) - 如何添加新工具支持
- [故障排查](./docs/TROUBLESHOOTING.md) - 常见问题解决方案

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

在提交 PR 前，请确保：
1. 代码通过所有测试（`npm test`）
2. 遵循现有的代码风格
3. 更新相关文档

详见 [贡献指南](./docs/CONTRIBUTING.md)。

## 📄 许可证

[MIT](./LICENSE)

## 🔗 相关项目

- [Claude Code](https://github.com/anthropics/claude-code) - Anthropic 官方 CLI
- [Codex](https://github.com/codex-ai/codex) - AI 编程助手
- [OpenClaw](https://github.com/openclaw/openclaw) - 开源 AI Agent 框架

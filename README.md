# Nexus - Agent Arena Monitor

**Phase 1 已完成** ✅

实时监控本地 Claude Code sessions 的终端墙。

## 一键安装（给用户）

```bash
curl -fsSL https://raw.githubusercontent.com/lusya123/Nexus/main/install.sh | bash
```

安装后可直接使用：

```bash
nexus start      # 生产模式（后台运行）
nexus stop
nexus restart
nexus status
nexus logs prod
```

## 本地开发（给你调试）

```bash
nexus dev-start
nexus dev-stop
nexus dev-restart
nexus logs backend
nexus logs frontend
```

开发模式访问：http://localhost:5173
生产模式访问：http://localhost:3000

## 项目状态

**Phase 1 完成** (2026-02-15)
- ✅ 实时监控 Claude Code sessions
- ✅ 文件监听 + 增量读取
- ✅ 进程扫描 + 状态机
- ✅ React 前端 + 动画效果
- ✅ E2E 测试 13/13 通过

**已知问题**：
- ⚠️ WebSocket 连接问题已修复（session 对象 JSON 序列化）

## 项目结构

```
Nexus/
├── server/             # 后端服务器
│   ├── index.js        # 主入口
│   ├── websocket.js    # WebSocket 服务
│   ├── session-manager.js  # 会话状态管理
│   ├── parsers/        # 解析器（支持多工具）
│   │   └── claude-code.js
│   └── monitors/       # 监控模块
│       ├── file-monitor.js
│       └── process-monitor.js
├── client/             # React 前端
├── tests/              # 测试文件
├── docs/               # 用户文档
└── dev-docs/           # 开发文档
```

## 核心功能

- **自动发现**：扫描 `~/.claude/projects/` 下所有 JSONL 文件
- **实时监听**：使用 `fs.watch` 监听文件修改
- **增量读取**：只读取新增内容，不重新解析整个文件
- **进程扫描**：每 15 秒扫描 Claude 进程，检测退出
- **状态机**：ACTIVE / IDLE / COOLING / GONE 四种状态
- **实时推送**：通过 WebSocket 推送到浏览器
- **Token / 金额看板**：顶部实时显示运行中 Agent、全量历史累计 Token、累计 USD 金额

### Token / 金额统计口径

- **范围**：全量历史累计（启动后回扫本机日志）+ 实时新增
- **运行中 Agent**：`state in {active, idle}`
- **金额**：优先在线价表，离线回退本地缓存；未知模型按 0 USD 处理（Token 仍计入）

## 技术栈

- 后端：Node.js + Express + WebSocket
- 前端：React + TypeScript + Vite
- 测试：Puppeteer

## 文档

**用户文档：**
- [README.md](./README.md) - 快速开始（本文件）
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - 架构设计与核心机制
- [docs/API.md](./docs/API.md) - WebSocket API 文档
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) - 如何添加新工具支持
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) - 故障排查指南

**开发文档：**
- [dev-docs/00-technical-spec.md](./dev-docs/00-technical-spec.md) - 完整技术规格
- [dev-docs/00-requirements.md](./dev-docs/00-requirements.md) - 需求文档
- [dev-docs/00-vision.md](./dev-docs/00-vision.md) - 产品愿景
- [dev-docs/05-phase2-implementation.md](./dev-docs/05-phase2-implementation.md) - Phase 2 实施记录
- [dev-docs/REFACTORING-2026-02-15.md](./dev-docs/REFACTORING-2026-02-15.md) - 重构记录
- [dev-docs/CHANGELOG.md](./dev-docs/CHANGELOG.md) - 变更日志

## 测试

```bash
# 运行 E2E 测试
node tests/e2e-test.js

# 运行验证测试
node tests/verify-phase1.js
```

## 当前支持

- Claude Code（`~/.claude/projects/`）
- Codex（`~/.codex/sessions/`）
- OpenClaw（`~/.openclaw/agents/`）

实现细节见：[dev-docs/05-phase2-implementation.md](./dev-docs/05-phase2-implementation.md)

## 故障排查

常见问题快速解决：

- **WebSocket 显示 disconnected**：刷新浏览器，检查后端是否运行
- **卡片不显示**：确认有活跃的 Claude Code sessions
- **消息不更新**：重启服务清除缓存

完整排查指南：[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

## 许可证

MIT

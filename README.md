# Nexus - Agent Arena Monitor

**Phase 1 已完成** ✅

实时监控本地 Claude Code sessions 的终端墙。

## 快速开始

```bash
# 启动服务
./start.sh

# 或手动启动
node server.js              # 后端 (终端 1)
cd client && npm run dev    # 前端 (终端 2)
```

访问：http://localhost:5173

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
- [dev-docs/spec.md](./dev-docs/spec.md) - 完整技术规格
- [dev-docs/requirements.md](./dev-docs/requirements.md) - 需求文档
- [dev-docs/vision.md](./dev-docs/vision.md) - 产品愿景
- [dev-docs/HANDOFF.md](./dev-docs/HANDOFF.md) - 项目交接文档
- [dev-docs/ACCEPTANCE.md](./dev-docs/ACCEPTANCE.md) - 验收清单
- [dev-docs/FINAL_REPORT.md](./dev-docs/FINAL_REPORT.md) - 最终报告

## 测试

```bash
# 运行 E2E 测试
node tests/e2e-test.js

# 运行验证测试
node tests/verify-phase1.js
```

## 下一步：Phase 2

添加 Codex 和 OpenClaw 支持：
1. 实现 Codex parser（`~/.codex/sessions/`）
2. 实现 OpenClaw parser（`~/.openclaw/agents/`）
3. 进程扫描支持多工具
4. 前端颜色区分（蓝色=Claude Code，绿色=Codex，紫色=OpenClaw）

详见：[dev-docs/HANDOFF.md](./dev-docs/HANDOFF.md)

## 故障排查

常见问题快速解决：

- **WebSocket 显示 disconnected**：刷新浏览器，检查后端是否运行
- **卡片不显示**：确认有活跃的 Claude Code sessions
- **消息不更新**：重启服务清除缓存

完整排查指南：[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

## 许可证

MIT

# Nexus - Agent Arena Monitor

实时监控本地 AI Agent 会话（Claude Code / Codex / OpenClaw），并在前端实时展示会话流与聚合 Token / USD 用量。

## 一键安装（面向使用者）

```bash
curl -fsSL https://raw.githubusercontent.com/lusya123/Nexus/main/install.sh | bash
```

安装后可直接使用：

```bash
nexus start      # 生产模式（后台运行，服务端口 3000）
nexus stop
nexus restart
nexus status
nexus logs prod
```

## 本地开发（面向调试）

```bash
nexus dev-start
nexus dev-stop
nexus dev-restart
nexus logs backend
nexus logs frontend
```

- 开发模式前端：`http://localhost:5173`
- 后端 / 生产模式：`http://localhost:3000`

## 当前后端行为（以 `server/index.js` 为准）

### 1) 会话发现与持续更新

- 服务启动后会先初始化价格/外部用量服务，再初始化 WebSocket，然后进行首次进程扫描并开始目录监听。
- 进程扫描周期：每 `15s`（`checkProcesses`）。
- 空闲检测周期：每 `30s`（`checkIdleSessions`）。
- 日志读取为增量模式（只处理新增 JSONL 行）。
- 对已识别的活跃文件会进行兜底轮询处理，避免漏掉未触发 watcher 的更新。

### 2) 多工具发现策略

- **Claude Code**：优先使用 `lsof` 映射到正在打开的 `.jsonl`，并结合最近修改文件兜底。
  - 最近修改保活窗口：`30 分钟`
  - 每目录最多保留：`5` 个最近会话文件
- **Codex**：基于 `lsof` 活跃文件 + 最近修改文件发现。
  - 最近修改发现窗口：`30 分钟`
  - 最多发现：`12` 个最近会话文件
- **OpenClaw**：结合 `.jsonl.lock` 与最近修改文件发现。
  - 最近修改发现窗口：`6 小时`
  - 每 agent 最多：`3` 个
  - 总上限：`12` 个

### 3) 会话状态机

- 会话状态：`active` / `idle` / `cooling` / `gone`
- `active -> idle`：2 分钟无新消息
- 进程消失后：进入 `cooling`
- `cooling` 时长：活跃时长的 10%，并限制在 `3s ~ 5min`
- `cooling` 到期后：进入 `gone` 并从内存移除

### 4) 用量与成本统计

- 启动后会在后台执行一次全量历史回扫（Claude/Codex/OpenClaw 日志）。
- 实时增量 + 历史回扫共同构成 `all_history` 口径统计。
- 运行中 Agent 计数口径：`state in {active, idle}`。
- 模型价格服务：
  - 启动时初始化
  - 每 `1h` 后台刷新价格缓存
- 外部用量同步：
  - 每 `5min` 刷新一次外部用量覆盖
  - 覆盖发生变化时广播最新聚合数据

### 5) WebSocket 事件

- 首次连接：`init`（包含当前 `sessions` 与 `usageTotals`）
- 增量事件：`session_init`、`message_add`、`state_change`、`session_remove`、`usage_totals`

## 监控目录

- Claude Code：`~/.claude/projects/`
- Codex：`~/.codex/sessions/`
- OpenClaw：`~/.openclaw/agents/`

## 项目结构

```text
Nexus/
├── server/
│   ├── index.js
│   ├── websocket.js
│   ├── session-manager.js
│   ├── parsers/
│   │   ├── claude-code.js
│   │   ├── codex.js
│   │   └── openclaw.js
│   ├── monitors/
│   │   ├── file-monitor.js
│   │   └── process-monitor.js
│   └── usage/
│       ├── usage-manager.js
│       └── pricing-service.js
├── client/
├── tests/
├── docs/
└── dev-docs/
```

## 测试

```bash
npm test
npm run test:codex
npm run test:usage-parsers
npm run test:usage-manager
```

## 文档

- [README.md](./README.md) - 快速开始（本文件）
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - 架构设计与核心机制
- [docs/API.md](./docs/API.md) - WebSocket API 文档
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) - 如何添加新工具支持
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) - 故障排查指南
- [dev-docs/00-technical-spec.md](./dev-docs/00-technical-spec.md) - 完整技术规格
- [dev-docs/00-requirements.md](./dev-docs/00-requirements.md) - 需求文档
- [dev-docs/00-vision.md](./dev-docs/00-vision.md) - 产品愿景
- [dev-docs/05-phase2-implementation.md](./dev-docs/05-phase2-implementation.md) - Phase 2 实施记录
- [dev-docs/REFACTORING-2026-02-15.md](./dev-docs/REFACTORING-2026-02-15.md) - 重构记录
- [dev-docs/CHANGELOG.md](./dev-docs/CHANGELOG.md) - 变更日志

## 许可证

MIT

# Nexus 架构说明

> 本文档描述当前实现（以 `server/index.js` 为主）。历史设计讨论见 `dev-docs/`。

## 1. 总览

Nexus 是本地会话监控服务，自动发现并实时展示三类工具会话：

- Claude Code（`~/.claude/projects/`）
- Codex（`~/.codex/sessions/`）
- OpenClaw（`~/.openclaw/agents/`）

核心目标：

- 自动发现和追踪活跃会话
- 增量读取 JSONL，避免全量重解析
- 通过 WebSocket 向前端推送会话与用量更新
- 提供全历史口径 Token / USD 聚合

## 2. 生命周期与状态机

会话状态：

- `active`：有新内容或最近活跃
- `idle`：持续无新内容
- `cooling`：活跃信号消失后进入冷却
- `gone`：冷却结束并从内存移除

状态转换规则：

- `active -> idle`：2 分钟无新增消息
- `active|idle -> cooling`：进程/文件活跃信号消失
- `cooling -> gone`：冷却计时结束

冷却时长：

- 基于会话活跃时长的 10%
- 最短 3 秒，最长 5 分钟

## 3. 活跃会话发现策略

### 3.1 Claude Code

- 进程扫描优先使用 `lsof` 提取该 PID 打开的 `.jsonl`。
- 同时保留最近修改文件作为兜底，避免短时漏检。
- 关键参数：
  - 最近修改保活窗口：30 分钟
  - 每目录最多纳入：5 个文件

### 3.2 Codex

- 因目录为 `YYYY/MM/DD` 结构，按“活跃文件集合”而不是固定项目目录追踪。
- 活跃来源：`lsof` 打开文件 + 最近修改文件发现。
- 关键参数：
  - 最近修改窗口：30 分钟
  - 全局最多发现：12 个最近文件

### 3.3 OpenClaw

- 使用 `.jsonl.lock` 作为活跃标记。
- lock 可能短暂，叠加最近修改窗口做保活。
- 关键参数：
  - 最近修改窗口：6 小时
  - 每 agent 最多：3 个文件
  - 总上限：12 个文件

## 4. 运行时流程

启动流程：

1. 初始化价格服务（`pricing-service`）
2. 初始化外部用量服务（`external-usage-service`）
3. 初始化 WebSocket 服务
4. 首次进程扫描并加载会话
5. 建立目录监听（Claude/Codex/OpenClaw）
6. 后台执行历史用量回扫（backfill）

定时任务：

- 每 15 秒：进程扫描（`checkProcesses`）
- 每 30 秒：空闲会话检查（`checkIdleSessions`）
- 每 1 小时：价格缓存后台刷新
- 每 5 分钟：外部用量刷新（Claude/Codex）

## 5. 数据流

```text
JSONL 文件变化 / 周期进程扫描
        ↓
FileMonitor 增量读取新增行
        ↓
Parser 解析消息与用量事件
        ↓
SessionManager 更新会话状态
UsageManager 更新聚合统计
        ↓
WebSocket 广播 init/session/message/state/usage
        ↓
前端实时渲染
```

## 6. 模块结构

```text
server/
├── index.js
├── websocket.js
├── session-manager.js
├── parsers/
│   ├── claude-code.js
│   ├── codex.js
│   └── openclaw.js
├── monitors/
│   ├── file-monitor.js
│   └── process-monitor.js
├── usage/
│   ├── usage-manager.js
│   ├── pricing-service.js
│   └── external-usage-service.js
└── utils/
    └── logger.js
```

职责：

- `index.js`：流程编排与调度
- `websocket.js`：连接管理与广播
- `session-manager.js`：会话状态机与生命周期
- `parsers/*`：工具日志解析（消息 + usage）
- `file-monitor.js`：目录扫描、watch、增量读取
- `process-monitor.js`：`ps + lsof` 活跃进程与文件映射
- `usage-manager.js`：全历史聚合与运行中计数
- `pricing-service.js`：模型价格拉取/缓存/成本计算
- `external-usage-service.js`：外部用量覆盖（Claude/Codex）

## 7. WebSocket 协议（概览）

核心消息类型：

- `init`
- `session_init`
- `message_add`
- `state_change`
- `session_remove`
- `usage_totals`

协议细节见 `docs/API.md`。

## 8. 扩展新工具的最小步骤

1. 新增 `server/parsers/<tool>.js`（消息 + usage 解析）
2. 在 `server/index.js` 接入发现逻辑与 `processFile` 调用
3. 在 `server/usage/usage-manager.js` 验证工具统计聚合
4. 前端补充工具展示配置
5. 更新 `README.md`、`docs/API.md`、`docs/ARCHITECTURE.md`

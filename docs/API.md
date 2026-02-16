# Nexus API 文档

## 1. WebSocket

- 地址：`ws://localhost:3000`
- 连接建立后，服务端会先发送 `init` 全量快照。

```js
const ws = new WebSocket('ws://localhost:3000');
```

## 2. 消息类型

### 2.1 `init`

客户端连接后立即收到一次全量数据。

```json
{
  "type": "init",
  "sessions": [],
  "usageTotals": {
    "scope": "all_history",
    "totals": {
      "runningAgents": 0,
      "totalTokens": 0,
      "totalCostUsd": 0
    },
    "byTool": {
      "codex": { "totalTokens": 0, "totalCostUsd": 0, "runningAgents": 0 },
      "claude-code": { "totalTokens": 0, "totalCostUsd": 0, "runningAgents": 0 },
      "openclaw": { "totalTokens": 0, "totalCostUsd": 0, "runningAgents": 0 }
    },
    "backfill": {
      "status": "running",
      "scannedFiles": 0,
      "totalFiles": 100
    },
    "updatedAt": 1771184174000
  }
}
```

### 2.2 `session_init`

发现新会话时推送。

```json
{
  "type": "session_init",
  "sessionId": "abc123",
  "tool": "codex",
  "name": "2026-02-16",
  "messages": [
    { "role": "assistant", "content": "[tool_call] shell" }
  ],
  "state": "active"
}
```

### 2.3 `message_add`

会话新增消息时推送（按消息逐条推送）。

```json
{
  "type": "message_add",
  "sessionId": "abc123",
  "message": {
    "role": "assistant",
    "content": "done"
  }
}
```

### 2.4 `state_change`

会话状态变化时推送。

```json
{
  "type": "state_change",
  "sessionId": "abc123",
  "state": "idle"
}
```

### 2.5 `session_remove`

会话进入 `gone` 并从内存移除后推送。

```json
{
  "type": "session_remove",
  "sessionId": "abc123"
}
```

### 2.6 `usage_totals`

用量聚合变化时推送（实时增量 + 历史回扫 + 外部覆盖）。

```json
{
  "type": "usage_totals",
  "scope": "all_history",
  "totals": {
    "runningAgents": 4,
    "totalTokens": 223344,
    "totalCostUsd": 25.67
  },
  "byTool": {
    "codex": { "totalTokens": 150000, "totalCostUsd": 18.5, "runningAgents": 2 },
    "claude-code": { "totalTokens": 50000, "totalCostUsd": 4.2, "runningAgents": 1 },
    "openclaw": { "totalTokens": 23344, "totalCostUsd": 2.97, "runningAgents": 1 }
  },
  "backfill": {
    "status": "done",
    "scannedFiles": 800,
    "totalFiles": 800
  },
  "updatedAt": 1771184200123
}
```

## 3. 数据模型

### 3.1 Session

```ts
interface Session {
  sessionId: string;
  tool: 'claude-code' | 'codex' | 'openclaw' | string;
  name: string;
  messages: Message[];
  filePath: string;
  projectDir: string;
  state: 'active' | 'idle' | 'cooling' | 'gone';
  startTime: number;
  lastModified: number;
  endTime: number | null;
}
```

说明：`gone` 通常通过 `session_remove` 体现，最终不会长期留在 `sessions` 列表。

### 3.2 Message

```ts
interface Message {
  role: 'user' | 'assistant';
  content: string;
}
```

### 3.3 UsageTotals

```ts
interface UsageTotals {
  scope: 'all_history';
  totals: {
    runningAgents: number; // state in {active, idle}
    totalTokens: number;
    totalCostUsd: number;
  };
  byTool: Record<string, {
    totalTokens: number;
    totalCostUsd: number;
    runningAgents: number;
  }>;
  backfill: {
    status: 'running' | 'done';
    scannedFiles: number;
    totalFiles: number;
  };
  updatedAt: number; // epoch ms
}
```

## 4. HTTP

当前后端仅提供：

- 静态资源服务（`dist/`）
- WebSocket 实时通道

不提供稳定公开的 REST API。

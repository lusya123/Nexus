# Nexus API 文档

## WebSocket

服务地址：`ws://localhost:3000`

```js
const ws = new WebSocket('ws://localhost:3000');
```

### 消息类型

#### 1. `init`

客户端连接后立即收到当前全量会话。

```json
{
  "type": "init",
  "usageTotals": {
    "scope": "all_history",
    "totals": {
      "runningAgents": 3,
      "totalTokens": 123456,
      "totalCostUsd": 12.34
    },
    "byTool": {
      "codex": { "totalTokens": 80000, "totalCostUsd": 9.2, "runningAgents": 1 },
      "claude-code": { "totalTokens": 30000, "totalCostUsd": 2.1, "runningAgents": 1 },
      "openclaw": { "totalTokens": 13456, "totalCostUsd": 1.04, "runningAgents": 1 }
    },
    "backfill": {
      "status": "running",
      "scannedFiles": 120,
      "totalFiles": 800
    },
    "updatedAt": 1771184174000
  },
  "sessions": [
    {
      "sessionId": "abc123",
      "tool": "claude-code",
      "name": "my-project",
      "messages": [
        { "role": "user", "content": "hello" },
        { "role": "assistant", "content": "hi" }
      ],
      "filePath": "/Users/xxx/.../session.jsonl",
      "projectDir": "/Users/xxx/...",
      "state": "active",
      "startTime": 1700000000000,
      "lastModified": 1700000005000,
      "endTime": null
    }
  ]
}
```

#### 6. `usage_totals`

Token / 金额统计增量推送（全量历史累计 + 实时新增）。

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

#### 2. `session_init`

发现新会话时推送。

```json
{
  "type": "session_init",
  "sessionId": "abc123",
  "tool": "codex",
  "name": "2026-02-15",
  "messages": [
    { "role": "assistant", "content": "[tool_call] shell" }
  ],
  "state": "active"
}
```

#### 3. `message_add`

会话新增消息时推送。

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

#### 4. `state_change`

会话状态变化时推送。

```json
{
  "type": "state_change",
  "sessionId": "abc123",
  "state": "idle"
}
```

#### 5. `session_remove`

会话进入 `gone` 并被移除时推送。

```json
{
  "type": "session_remove",
  "sessionId": "abc123"
}
```

## 数据模型

### Session

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

### UsageTotals

```ts
interface UsageTotals {
  scope: 'all_history';
  totals: {
    runningAgents: number;   // state in {active, idle}
    totalTokens: number;     // 全量历史累计 + 实时增量
    totalCostUsd: number;    // USD
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

### Message

```ts
interface Message {
  role: 'user' | 'assistant';
  content: string;
}
```

## HTTP

当前后端仅承载静态资源与 WebSocket，未提供稳定公开的 REST API。

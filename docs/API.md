# Nexus API 文档

## WebSocket 协议

### 连接

```javascript
const ws = new WebSocket('ws://localhost:3000');
```

### 消息格式

所有消息都是 JSON 格式。

## 服务端 → 客户端消息

### 1. 完整状态同步（连接时）

客户端连接时，服务端立即推送所有 session 的完整状态。

```json
{
  "type": "init",
  "sessions": [
    {
      "id": "abc-123",
      "tool": "claude-code",
      "projectName": "my-project",
      "filePath": "/Users/xxx/.claude/projects/-Users-xxx-my-project/session-123.jsonl",
      "status": "ACTIVE",
      "messages": [
        {
          "role": "user",
          "content": "Help me fix this bug",
          "timestamp": 1708012345678
        },
        {
          "role": "assistant",
          "content": "Let me help you with that...",
          "timestamp": 1708012346789
        }
      ],
      "lastActivity": 1708012346789,
      "startTime": 1708012345678
    }
  ]
}
```

### 2. Session 创建

新 session 被发现时推送。

```json
{
  "type": "session_added",
  "session": {
    "id": "abc-123",
    "tool": "claude-code",
    "projectName": "my-project",
    "filePath": "/Users/xxx/.claude/projects/-Users-xxx-my-project/session-123.jsonl",
    "status": "ACTIVE",
    "messages": [],
    "lastActivity": 1708012345678,
    "startTime": 1708012345678
  }
}
```

### 3. 新消息

Session 有新消息时推送。

```json
{
  "type": "message",
  "sessionId": "abc-123",
  "message": {
    "role": "user",
    "content": "What's the current status?",
    "timestamp": 1708012347890
  }
}
```

### 4. 状态更新

Session 状态变化时推送。

```json
{
  "type": "status_update",
  "sessionId": "abc-123",
  "status": "IDLE",
  "lastActivity": 1708012347890
}
```

### 5. Session 移除

Session 进入 GONE 状态时推送。

```json
{
  "type": "session_removed",
  "sessionId": "abc-123"
}
```

## 数据结构

### Session 对象

```typescript
interface Session {
  id: string;              // Session 唯一标识
  tool: string;            // 工具类型: "claude-code" | "codex" | "openclaw"
  projectName: string;     // 项目名称（路径最后一段）
  filePath: string;        // JSONL 文件完整路径
  status: SessionStatus;   // 当前状态
  messages: Message[];     // 消息列表
  lastActivity: number;    // 最后活动时间（毫秒时间戳）
  startTime: number;       // Session 开始时间
  endTime?: number;        // Session 结束时间（进程退出时设置）
  cooldownEnd?: number;    // 冷却结束时间（COOLING 状态时设置）
}
```

### SessionStatus 枚举

```typescript
type SessionStatus =
  | "ACTIVE"   // 进程在跑 + 文件最近有修改
  | "IDLE"     // 进程在跑 + 文件一段时间没修改
  | "COOLING"  // 进程已退出，冷却倒计时中
  | "GONE";    // 冷却期结束（即将移除）
```

### Message 对象

```typescript
interface Message {
  role: "user" | "assistant";  // 消息角色
  content: string;              // 消息内容
  timestamp: number;            // 消息时间戳（毫秒）
}
```

## HTTP 端点

### GET /

返回前端 HTML 页面。

### GET /health

健康检查端点。

```json
{
  "status": "ok",
  "activeSessions": 3,
  "uptime": 12345
}
```

## 工具配置

### 支持的工具

当前支持的工具及其配置：

```javascript
const TOOL_CONFIGS = {
  'claude-code': {
    name: 'Claude Code',
    scanPath: '~/.claude/projects/',
    pattern: '**/*.jsonl',
    processName: 'claude',
    color: 'blue'
  }
  // Phase 2 将添加 Codex 和 OpenClaw
};
```

## 错误处理

WebSocket 连接断开时，客户端应自动重连：

```javascript
ws.onclose = () => {
  console.log('WebSocket disconnected, reconnecting...');
  setTimeout(() => {
    connectWebSocket();
  }, 1000);
};
```

## 性能特性

- **增量更新**：只推送变化的数据，不重复发送完整状态
- **批量推送**：短时间内的多个更新会合并推送
- **自动清理**：GONE 状态的 session 自动从内存移除

## 示例：完整客户端实现

```javascript
class NexusClient {
  constructor(url = 'ws://localhost:3000') {
    this.url = url;
    this.sessions = new Map();
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 1000);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'init':
        data.sessions.forEach(s => this.sessions.set(s.id, s));
        break;
      case 'session_added':
        this.sessions.set(data.session.id, data.session);
        break;
      case 'message':
        const session = this.sessions.get(data.sessionId);
        if (session) {
          session.messages.push(data.message);
          session.lastActivity = data.message.timestamp;
        }
        break;
      case 'status_update':
        const s = this.sessions.get(data.sessionId);
        if (s) {
          s.status = data.status;
          s.lastActivity = data.lastActivity;
        }
        break;
      case 'session_removed':
        this.sessions.delete(data.sessionId);
        break;
    }
  }
}
```

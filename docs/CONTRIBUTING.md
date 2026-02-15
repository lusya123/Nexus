# 贡献指南

## 如何添加新工具支持

Nexus 设计为易于扩展。添加新的 AI 编程工具支持只需几个步骤。

### 1. 添加工具配置

在 `server.js` 中的 `TOOL_CONFIGS` 添加新工具：

```javascript
const TOOL_CONFIGS = {
  'claude-code': {
    name: 'Claude Code',
    scanPath: path.join(os.homedir(), '.claude', 'projects'),
    pattern: '**/*.jsonl',
    processName: 'claude',
    color: 'blue'
  },
  'codex': {
    name: 'Codex',
    scanPath: path.join(os.homedir(), '.codex', 'sessions'),
    pattern: '**/*.jsonl',
    processName: 'codex',
    color: 'green'
  }
};
```

### 2. 实现 Parser 函数

创建解析函数来处理工具的 JSONL 格式：

```javascript
function parseCodexLine(line) {
  try {
    const data = JSON.parse(line);

    // 提取消息
    if (data.type === 'message') {
      return {
        role: data.role,
        content: data.content,
        timestamp: data.timestamp
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}
```

在 `readNewContent` 函数中添加工具判断：

```javascript
function readNewContent(filePath, tool) {
  // ... 读取逻辑 ...

  lines.forEach(line => {
    let message;
    if (tool === 'claude-code') {
      message = parseClaudeCodeLine(line);
    } else if (tool === 'codex') {
      message = parseCodexLine(line);
    }

    if (message) {
      newMessages.push(message);
    }
  });
}
```

### 3. 添加进程扫描规则

在 `scanProcesses` 函数中添加新工具的进程扫描：

```javascript
async function scanProcesses() {
  const tools = ['claude', 'codex', 'openclaw'];

  for (const tool of tools) {
    try {
      const { stdout } = await execAsync(
        `lsof -c ${tool} -a -d cwd -F pcn 2>/dev/null || true`
      );

      // 解析 lsof 输出...
    } catch (e) {
      // 错误处理
    }
  }
}
```

### 4. 前端颜色主题

在 `client/src/App.tsx` 中添加工具颜色：

```typescript
const toolColors = {
  'claude-code': {
    border: 'border-blue-500',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400'
  },
  'codex': {
    border: 'border-green-500',
    bg: 'bg-green-500/10',
    text: 'text-green-400'
  }
};
```

## 项目结构

```
Nexus/
├── server.js              # 后端服务器
│   ├── WebSocket 服务
│   ├── 文件监听系统
│   ├── 进程扫描器
│   └── 状态管理器
│
├── client/                # React 前端
│   ├── src/
│   │   ├── App.tsx       # 主组件
│   │   └── main.tsx      # 入口
│   └── package.json
│
├── tests/                 # 测试文件
│   ├── e2e-test.js       # E2E 测试
│   └── verify-phase1.js  # 验证测试
│
├── docs/                  # 用户文档
│   ├── ARCHITECTURE.md   # 架构说明
│   ├── API.md            # API 文档
│   ├── CONTRIBUTING.md   # 本文件
│   └── TROUBLESHOOTING.md
│
└── dev-docs/              # 开发文档
    ├── spec.md           # 技术规格
    ├── requirements.md   # 需求文档
    └── ...
```

## 开发流程

### 本地开发

```bash
# 启动后端（终端 1）
node server.js

# 启动前端（终端 2）
cd client
npm run dev

# 访问
open http://localhost:5173
```

### 运行测试

```bash
# E2E 测试
node tests/e2e-test.js

# 验证测试
node tests/verify-phase1.js
```

### 调试

查看服务器日志：

```bash
tail -f /tmp/nexus-server.log
```

查看 WebSocket 消息（浏览器控制台）：

```javascript
// 在浏览器控制台中
window.ws = new WebSocket('ws://localhost:3000');
window.ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

## 代码风格

- 使用 ES6+ 语法
- 异步操作使用 async/await
- 错误处理使用 try/catch
- 变量命名使用 camelCase
- 常量使用 UPPER_SNAKE_CASE

## 提交规范

```bash
# 功能添加
git commit -m "feat: 添加 Codex 支持"

# Bug 修复
git commit -m "fix: 修复 WebSocket 连接问题"

# 文档更新
git commit -m "docs: 更新 API 文档"

# 重构
git commit -m "refactor: 优化进程扫描逻辑"
```

## 性能优化建议

### 1. 增量读取优化

```javascript
// 使用 fileOffsets 记录读取位置
const fileOffsets = new Map();

function readNewContent(filePath) {
  const offset = fileOffsets.get(filePath) || 0;
  const fd = fs.openSync(filePath, 'r');
  const stats = fs.fstatSync(fd);

  if (stats.size > offset) {
    const buffer = Buffer.alloc(stats.size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fileOffsets.set(filePath, stats.size);
    // 处理新内容...
  }

  fs.closeSync(fd);
}
```

### 2. 批量推送

```javascript
// 短时间内的多个更新合并推送
let pendingUpdates = [];
let updateTimer = null;

function scheduleUpdate(update) {
  pendingUpdates.push(update);

  if (!updateTimer) {
    updateTimer = setTimeout(() => {
      broadcast({ type: 'batch', updates: pendingUpdates });
      pendingUpdates = [];
      updateTimer = null;
    }, 100);
  }
}
```

### 3. 内存管理

```javascript
// 定期清理 GONE 状态的 session
setInterval(() => {
  for (const [id, session] of sessions.entries()) {
    if (session.status === 'GONE') {
      sessions.delete(id);
      fileOffsets.delete(session.filePath);
    }
  }
}, 60000); // 每分钟清理一次
```

## 常见问题

### Q: 如何处理大文件？

A: 使用增量读取，只解析新增内容。避免一次性读取整个文件。

### Q: 如何处理高频更新？

A: 使用批量推送机制，合并短时间内的多个更新。

### Q: 如何支持新的 JSONL 格式？

A: 实现对应的 parser 函数，处理工具特定的数据结构。

## 获取帮助

- 查看 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解系统设计
- 查看 [API.md](./API.md) 了解数据格式
- 查看 `dev-docs/spec.md` 了解完整技术规格
- 提交 Issue：https://github.com/yourusername/nexus/issues

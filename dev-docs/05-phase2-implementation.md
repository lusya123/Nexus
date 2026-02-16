# Nexus Phase 2 实现文档

> 文档定位（更新于 2026-02-16）：本文档主要记录 Phase 2 实施过程，部分示例代码已与当前仓库实现存在差异。当前行为请以 `server/index.js`、`README.md`、`docs/ARCHITECTURE.md`、`docs/API.md` 为准。

## 当前实现差异（2026-02-16）

- 已新增 `server/usage/` 体系：`usage-manager.js`、`pricing-service.js`、`external-usage-service.js`。
- WebSocket 除会话消息外，已增加 `usage_totals` 持续推送。
- Claude/Codex/OpenClaw 的活跃发现策略已升级为“进程信号 + 最近修改文件兜底”混合模式。
- OpenClaw 活跃识别已使用 `.jsonl.lock` + mtime 双信号。
- 状态与调度周期以代码常量为准：
  - 进程扫描：15 秒
  - 空闲检测：30 秒
  - 外部用量刷新：5 分钟

## 一、背景与目标

### 1.1 Phase 1 完成情况

Phase 1 已完成 Claude Code 的完整监控功能：
- ✅ 文件发现与实时监听
- ✅ 进程扫描与状态管理
- ✅ WebSocket 实时推送
- ✅ React 前端展示
- ✅ 动画效果（入场/淡出/呼吸灯）
- ✅ E2E 自动化测试（13/13 通过）

### 1.2 Phase 2 目标

扩展支持 Codex 和 OpenClaw 两个工具，实现：
1. 添加 Codex 和 OpenClaw 的 JSONL parser
2. 扩展文件监听支持多工具的不同路径结构
3. 扩展进程监控支持多工具
4. 前端通过颜色区分不同工具类型

### 1.3 架构优势

当前架构已为多工具支持做好准备：
- Parser 模块：函数式设计，易于扩展
- FileMonitor 模块：通用的扫描和监听机制
- ProcessMonitor 模块：可配置的进程扫描
- 前端：已接收 `tool` 字段，只需添加颜色映射

---

## 二、实现步骤

### Step 1: 创建 Codex Parser

**文件**: `server/parsers/codex.js`

**完整代码**:

```javascript
import path from 'path';
import os from 'os';

// Codex sessions 目录
export const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');

// 解析 Codex JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // Codex 格式: type == "response_item" && payload.role == "user/assistant"
    if (obj.type === 'response_item' && obj.payload?.role) {
      const role = obj.payload.role;

      if (role !== 'user' && role !== 'assistant') {
        return null;
      }

      const content = obj.payload.content;
      let text = '';

      // content 是数组，提取 type === 'text' 的 text 字段
      if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      } else if (typeof content === 'string') {
        text = content;
      }

      return { role, content: text };
    }

    return null;
  } catch (error) {
    return null;
  }
}

// 从文件路径提取 Session ID
export function getSessionId(filePath) {
  const filename = path.basename(filePath, '.jsonl');
  // 从 rollout-{timestamp}-{uuid}.jsonl 提取 uuid
  const match = filename.match(/^rollout-\d+-(.+)$/);
  return match ? match[1] : filename;
}

// 从目录路径提取项目名称
export function getProjectName(dirPath) {
  // 从 YYYY/MM/DD 路径提取，返回 "YYYY-MM-DD"
  const parts = dirPath.split(path.sep);
  const year = parts[parts.length - 3];
  const month = parts[parts.length - 2];
  const day = parts[parts.length - 1];

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }

  return path.basename(dirPath);
}

// 编码工作目录为目录名
export function encodeCwd(cwd) {
  return cwd.replace(/\//g, '-');
}
```

**关键点**:
- Codex JSONL 格式：`{ type: "response_item", payload: { role: "user", content: [...] } }`
- content 是数组，需要过滤 `item.type === 'text'` 并提取 `item.text`
- 文件名格式：`rollout-1234567890-abc123.jsonl`，需要提取 uuid 部分

---

### Step 2: 创建 OpenClaw Parser

**文件**: `server/parsers/openclaw.js`

**完整代码**:

```javascript
import path from 'path';
import os from 'os';

// OpenClaw agents 目录
export const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents');

// 解析 OpenClaw JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // OpenClaw 格式最简单: role == "user" 或 role == "assistant"
    if (obj.role === 'user' || obj.role === 'assistant') {
      const content = obj.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: obj.role, content: text };
    }

    return null;
  } catch (error) {
    return null;
  }
}

// 从文件路径提取 Session ID
export function getSessionId(filePath) {
  return path.basename(filePath, '.jsonl');
}

// 从目录路径提取项目名称
export function getProjectName(dirPath) {
  // 从 agents/{agentName}/sessions 提取 agentName
  const parts = dirPath.split(path.sep);
  const sessionsIndex = parts.lastIndexOf('sessions');

  if (sessionsIndex > 0) {
    return parts[sessionsIndex - 1];
  }

  return path.basename(path.dirname(dirPath));
}

// 编码工作目录为目录名
export function encodeCwd(cwd) {
  return cwd.replace(/\//g, '-');
}
```

**关键点**:
- OpenClaw JSONL 格式最简单：`{ role: "user", content: "..." }`
- 路径结构：`~/.openclaw/agents/{agentName}/sessions/{sessionId}.jsonl`
- 项目名称从 agentName 提取

---

### Step 3: 扩展文件监听支持多工具

**文件**: `server/monitors/file-monitor.js`

**在文件末尾添加以下函数**:

```javascript
// 扫描 Codex sessions (YYYY/MM/DD 目录结构)
export function scanCodexSessions(sessionsDir, onFileFound, onDirFound) {
  try {
    if (!fs.existsSync(sessionsDir)) {
      console.log('Codex sessions directory not found');
      return;
    }

    // 扫描 YYYY 目录
    const years = fs.readdirSync(sessionsDir);

    for (const year of years) {
      const yearPath = path.join(sessionsDir, year);

      try {
        const yearStat = fs.statSync(yearPath);
        if (!yearStat.isDirectory()) continue;

        // 扫描 MM 目录
        const months = fs.readdirSync(yearPath);

        for (const month of months) {
          const monthPath = path.join(yearPath, month);

          try {
            const monthStat = fs.statSync(monthPath);
            if (!monthStat.isDirectory()) continue;

            // 扫描 DD 目录
            const days = fs.readdirSync(monthPath);

            for (const day of days) {
              const dayPath = path.join(monthPath, day);

              try {
                const dayStat = fs.statSync(dayPath);
                if (!dayStat.isDirectory()) continue;

                // 扫描 JSONL 文件
                const files = fs.readdirSync(dayPath);
                files.forEach(file => {
                  if (file.startsWith('rollout-') && file.endsWith('.jsonl')) {
                    const filePath = path.join(dayPath, file);
                    onFileFound(filePath);
                  }
                });

                onDirFound(dayPath);
              } catch (error) {
                // Skip inaccessible day directories
              }
            }
          } catch (error) {
            // Skip inaccessible month directories
          }
        }
      } catch (error) {
        // Skip inaccessible year directories
      }
    }

    console.log('Scanned Codex sessions');
  } catch (error) {
    console.error('Error scanning Codex sessions:', error.message);
  }
}

// 扫描 OpenClaw agents (agents/*/sessions 结构)
export function scanOpenClawAgents(agentsDir, onFileFound, onDirFound) {
  try {
    if (!fs.existsSync(agentsDir)) {
      console.log('OpenClaw agents directory not found');
      return;
    }

    // 扫描 agents 目录
    const agents = fs.readdirSync(agentsDir);

    for (const agent of agents) {
      const agentPath = path.join(agentsDir, agent);

      try {
        const agentStat = fs.statSync(agentPath);
        if (!agentStat.isDirectory()) continue;

        // 扫描 sessions 目录
        const sessionsPath = path.join(agentPath, 'sessions');

        if (fs.existsSync(sessionsPath)) {
          const sessionsStat = fs.statSync(sessionsPath);

          if (sessionsStat.isDirectory()) {
            const files = fs.readdirSync(sessionsPath);
            files.forEach(file => {
              if (file.endsWith('.jsonl')) {
                const filePath = path.join(sessionsPath, file);
                onFileFound(filePath);
              }
            });

            onDirFound(sessionsPath);
          }
        }
      } catch (error) {
        // Skip inaccessible agent directories
      }
    }

    console.log('Scanned OpenClaw agents');
  } catch (error) {
    console.error('Error scanning OpenClaw agents:', error.message);
  }
}
```

**关键点**:
- Codex 需要扫描 3 层目录：`sessions/YYYY/MM/DD/*.jsonl`
- OpenClaw 需要扫描通配符路径：`agents/*/sessions/*.jsonl`
- 复用现有的 `watchProjectDir` 函数进行文件监听
- 容错处理：目录不存在或不可访问时跳过

---

### Step 4: 扩展进程监控支持多工具

**文件**: `server/monitors/process-monitor.js`

**修改现有的 `scanProcesses` 函数**:

将第 11 行的函数签名修改为：

```javascript
export async function scanProcesses(toolName, projectsDir, encodeCwdFn) {
```

将第 14 行的 grep 命令修改为：

```javascript
const { stdout } = await execAsync(`ps aux | grep " ${toolName}" | grep -v grep | grep -v "node server" | grep -v "node /Users"`);
```

将第 60 行的日志修改为：

```javascript
console.log(`Active ${toolName} processes: ${activeProcesses.size}`);
```

**在文件末尾添加新函数**:

```javascript
// 扫描所有工具的进程
export async function scanAllToolProcesses(tools) {
  const allProcesses = new Map();

  for (const tool of tools) {
    const processes = await scanProcesses(
      tool.processName,
      tool.projectsDir,
      tool.encodeCwdFn
    );

    if (processes.size > 0) {
      allProcesses.set(tool.toolName, processes);
    }
  }

  return allProcesses;
}
```

**关键点**:
- 进程名称：`claude`, `codex`, `openclaw-gateway`
- 每个工具使用各自的 `encodeCwd` 函数
- 支持并发扫描多个工具的进程

---

### Step 5: 更新主入口支持多工具

**文件**: `server/index.js`

**1. 在文件顶部添加导入**（第 8 行后）:

```javascript
import * as CodexParser from './parsers/codex.js';
import * as OpenClawParser from './parsers/openclaw.js';
```

**2. 修改 `processFile` 函数**（第 26-81 行）:

将函数签名改为接收 parser 和 toolName 参数：

```javascript
function processFile(filePath, parser, toolName) {
  const sessionId = parser.getSessionId(filePath);
  const projectDir = path.dirname(filePath);
  const projectName = parser.getProjectName(projectDir);

  // Check if this is a new session
  if (!SessionManager.getSession(sessionId)) {
    console.log(`New session discovered: ${sessionId} (${projectName}) [${toolName}]`);

    const session = SessionManager.createSession(
      sessionId,
      toolName,
      projectName,
      filePath,
      projectDir
    );

    // Read all existing messages
    const messages = FileMonitor.readIncremental(filePath, parser.parseMessage);
    SessionManager.addMessages(sessionId, messages);

    // Broadcast new session
    broadcast({
      type: 'session_init',
      sessionId,
      tool: toolName,
      name: projectName,
      messages,
      state: 'active'
    });
  } else {
    // Read incremental messages
    const messages = FileMonitor.readIncremental(filePath, parser.parseMessage);

    if (messages.length > 0) {
      SessionManager.addMessages(sessionId, messages);

      // Set to ACTIVE if it was IDLE
      const session = SessionManager.getSession(sessionId);
      if (session.state === 'idle') {
        SessionManager.setSessionState(sessionId, 'active', handleStateChange);
      }

      // Broadcast each new message
      messages.forEach(message => {
        broadcast({
          type: 'message_add',
          sessionId,
          message
        });
      });

      console.log(`Session ${sessionId} [${toolName}]: +${messages.length} messages`);
    }
  }
}
```

**3. 修改 `checkProcesses` 函数**（第 100-108 行）:

```javascript
async function checkProcesses() {
  const tools = [
    {
      processName: 'claude',
      toolName: 'claude-code',
      projectsDir: ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
      encodeCwdFn: ClaudeCodeParser.encodeCwd
    },
    {
      processName: 'codex',
      toolName: 'codex',
      projectsDir: CodexParser.CODEX_SESSIONS_DIR,
      encodeCwdFn: CodexParser.encodeCwd
    },
    {
      processName: 'openclaw-gateway',
      toolName: 'openclaw',
      projectsDir: OpenClawParser.OPENCLAW_AGENTS_DIR,
      encodeCwdFn: OpenClawParser.encodeCwd
    }
  ];

  for (const tool of tools) {
    const processes = await ProcessMonitor.scanProcesses(
      tool.processName,
      tool.projectsDir,
      tool.encodeCwdFn
    );

    const activeProjectDirs = ProcessMonitor.getActiveProjectDirs();
    SessionManager.checkSessionProcesses(activeProjectDirs, handleStateChange);
  }
}
```

**4. 在 `server.listen` 回调中添加多工具扫描**（第 119-124 行后）:

```javascript
  // Scan all Claude Code projects
  FileMonitor.scanAllProjects(
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    (filePath) => processFile(filePath, ClaudeCodeParser, 'claude-code'),
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, ClaudeCodeParser, 'claude-code')
    )
  );

  // Scan Codex sessions
  FileMonitor.scanCodexSessions(
    CodexParser.CODEX_SESSIONS_DIR,
    (filePath) => processFile(filePath, CodexParser, 'codex'),
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, CodexParser, 'codex')
    )
  );

  // Scan OpenClaw agents
  FileMonitor.scanOpenClawAgents(
    OpenClawParser.OPENCLAW_AGENTS_DIR,
    (filePath) => processFile(filePath, OpenClawParser, 'openclaw'),
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, OpenClawParser, 'openclaw')
    )
  );
```

**关键点**:
- 为每个工具设置独立的扫描和监听
- 使用各自的 parser 和 toolName
- 复用现有的 `processFile` 和 `watchProjectDir` 逻辑

---

### Step 6: 前端添加工具类型颜色映射

**文件**: `client/src/App.tsx`

**1. 在文件顶部添加工具类型配置**（第 16 行后）:

```typescript
const TOOL_CONFIG: Record<string, { label: string; color: string; borderColor: string }> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#60a5fa',      // 蓝色
    borderColor: '#3b82f6'
  },
  'codex': {
    label: 'Codex',
    color: '#4ade80',      // 绿色
    borderColor: '#22c55e'
  },
  'openclaw': {
    label: 'OpenClaw',
    color: '#c084fc',      // 紫色
    borderColor: '#a855f7'
  }
};
```

**2. 修改 `SessionCard` 组件**（第 164 行开始）:

找到 `function SessionCard({ session }: { session: Session })` 函数，在函数开头添加：

```typescript
function SessionCard({ session }: { session: Session }) {
  const toolConfig = TOOL_CONFIG[session.tool] || TOOL_CONFIG['claude-code'];

  // ... 其余代码
```

**3. 修改卡片的 JSX**:

将第 177 行的：
```typescript
<span className="session-tool">Claude Code</span>
```

改为：
```typescript
<span className="session-tool" style={{ color: toolConfig.color }}>
  {toolConfig.label}
</span>
```

将第 172 行的 `<div className={cardClass}>` 改为：
```typescript
<div
  className={cardClass}
  style={{
    borderColor: session.state === 'active' ? toolConfig.borderColor : undefined
  }}
>
```

**文件**: `client/src/App.css`

**修改样式**:

找到 `.session-tool` 样式（约第 80 行），移除固定颜色：

```css
.session-tool {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  /* color: #60a5fa; <- 删除这行，改用内联样式 */
}
```

找到 `.session-card.active` 样式（约第 60 行），修改边框：

```css
.session-card.active {
  /* border: 1px solid #3b82f6; <- 删除这行 */
  border: 1px solid; /* 保留 border 属性，颜色由内联样式控制 */
  animation: breathe 2s ease-in-out infinite;
}
```

**关键点**:
- 通过 `TOOL_CONFIG` 映射工具类型到颜色
- 动态显示工具类型标签
- ACTIVE 状态的边框颜色根据工具类型变化

---

### Step 7: 重新构建前端

**命令**:

```bash
cd client
npm run build
cd ..
```

这会将前端构建到 `dist/` 目录，后端会自动提供这些静态文件。

---

## 三、测试验证

### 3.1 后端验证

**启动服务器**:

```bash
node server/index.js
```

**检查日志**:

```bash
# 推荐：通过控制脚本查看日志
nexus logs backend | rg -i "session"
nexus logs backend | rg -i "process"
```

**预期输出**:
- `Scanned Claude Code projects`
- `Scanned Codex sessions`
- `Scanned OpenClaw agents`
- `Active claude processes: X`
- `Active codex processes: X`
- `Active openclaw-gateway processes: X`

### 3.2 前端验证

**打开浏览器**:

访问 http://localhost:5173

**验证点**:
1. 不同工具的卡片颜色不同
   - Claude Code: 蓝色边框和标签
   - Codex: 绿色边框和标签
   - OpenClaw: 紫色边框和标签

2. 工具类型标签正确显示
   - 显示 "Claude Code" / "Codex" / "OpenClaw"
   - 不再硬编码为 "Claude Code"

3. 所有 session 都能实时更新
   - 新消息立即出现
   - 状态转换正确（ACTIVE → IDLE → COOLING → GONE）

### 3.3 多工具混合测试

**测试场景**:

1. 同时运行 Claude Code、Codex、OpenClaw
2. 在不同工具中发送消息
3. 验证所有 session 都能正确显示
4. 验证颜色区分清晰

### 3.4 目录不存在测试

**测试场景**:

如果 `~/.codex/` 或 `~/.openclaw/` 目录不存在：
- 服务器应该正常启动
- 日志显示 "Codex sessions directory not found"
- 不影响 Claude Code 的监控

---

## 四、完成标准

- [ ] Codex parser 创建完成
- [ ] OpenClaw parser 创建完成
- [ ] 文件监听支持 Codex 和 OpenClaw
- [ ] 进程监控支持多工具
- [ ] 主入口集成所有工具
- [ ] 前端正确显示工具类型和颜色
- [ ] 前端重新构建完成
- [ ] 所有工具的 session 都能实时更新
- [ ] 状态转换正确（ACTIVE/IDLE/COOLING/GONE）
- [ ] 无明显 bug 或性能问题

---

## 五、关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/parsers/codex.js` | 创建 | Codex JSONL 解析器 |
| `server/parsers/openclaw.js` | 创建 | OpenClaw JSONL 解析器 |
| `server/monitors/file-monitor.js` | 修改 | 添加 `scanCodexSessions` 和 `scanOpenClawAgents` |
| `server/monitors/process-monitor.js` | 修改 | 修改 `scanProcesses` 支持 toolName 参数 |
| `server/index.js` | 修改 | 集成所有工具的监听和进程扫描 |
| `client/src/App.tsx` | 修改 | 添加 `TOOL_CONFIG` 和动态颜色 |
| `client/src/App.css` | 修改 | 移除硬编码颜色 |

---

## 六、风险和注意事项

1. **目录不存在**: Codex 和 OpenClaw 的目录可能不存在，已添加容错处理
2. **JSONL 格式差异**: 需要仔细测试每个 parser 的解析逻辑
3. **进程名称**: 需要确认 Codex 和 OpenClaw 的实际进程名称
   - 如果进程名称不匹配，修改 `checkProcesses` 中的 `processName`
4. **路径编码**: 不同工具可能有不同的路径编码规则
5. **性能**: 监听多个工具的目录，注意文件监听数量限制

---

## 七、预估工作量

- Parser 实现: 30 分钟
- 文件监听扩展: 20 分钟
- 进程监控扩展: 20 分钟
- 主入口集成: 30 分钟
- 前端颜色区分: 20 分钟
- 前端构建: 5 分钟
- 测试验证: 30 分钟

**总计**: 约 2.5 小时

---

## 八、实施顺序建议

1. **后端 Parsers** (Step 1-2): 先实现两个 parser，可以独立测试
2. **文件监听扩展** (Step 3): 添加扫描函数，复用现有监听机制
3. **进程监控扩展** (Step 4): 修改进程扫描支持多工具
4. **主入口集成** (Step 5): 将所有模块集成到主程序
5. **前端颜色区分** (Step 6): 实现前端展示
6. **前端构建** (Step 7): 构建前端
7. **测试验证**: 全面测试所有功能

---

## 九、下一步

Phase 2 完成后，可以考虑：
- Phase 3: 体验打磨（点击放大、布局切换、筛选、手机适配）
- 添加更多工具支持
- 性能优化
- 远程监控支持

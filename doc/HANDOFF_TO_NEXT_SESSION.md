# Nexus - 下一个 Session 的任务指南

**当前状态**：✅ Phase 1 已完成

**最后更新**：2026-02-15

---

## 一、Phase 1 完成情况

Phase 1（终端墙）已完成并通过所有测试：
- ✅ 实时监控 Claude Code sessions
- ✅ 文件监听 + 增量读取
- ✅ 进程扫描 + 状态机
- ✅ React 前端 + 动画效果
- ✅ E2E 测试 13/13 通过

**已知问题已修复**：
- ✅ WebSocket 连接问题（session 对象 JSON 序列化）

---

## 二、下一步：Phase 2

### 目标

添加 **Codex** 和 **OpenClaw** 支持，实现多工具监控。

### 任务清单

#### 1. 添加 Codex Parser

**文件位置**：`server.js`

**扫描路径**：`~/.codex/sessions/YYYY/MM/DD/*.jsonl`

**文件格式**：`rollout-{timestamp}-{uuid}.jsonl`

**解析规则**：
```javascript
function parseCodexMessage(line) {
  const obj = JSON.parse(line);

  if (obj.type === 'response_item' && obj.payload?.role === 'user') {
    const content = obj.payload.content;
    const text = Array.isArray(content)
      ? content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      : content;
    return { role: 'user', content: text };
  }

  if (obj.type === 'response_item' && obj.payload?.role === 'assistant') {
    const content = obj.payload.content;
    const text = Array.isArray(content)
      ? content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      : content;
    return { role: 'assistant', content: text };
  }

  return null;
}
```

#### 2. 添加 OpenClaw Parser

**扫描路径**：`~/.openclaw/agents/*/sessions/*.jsonl`

**文件格式**：`{sessionId}.jsonl`

**解析规则**：
```javascript
function parseOpenClawMessage(line) {
  const obj = JSON.parse(line);

  if (obj.role === 'user') {
    return { role: 'user', content: obj.content || '' };
  }

  if (obj.role === 'assistant') {
    return { role: 'assistant', content: obj.content || '' };
  }

  return null;
}
```

#### 3. 更新进程扫描

**修改位置**：`server.js` 中的 `scanProcesses` 函数

**当前代码**：
```javascript
const { stdout } = await execAsync('ps aux | grep " claude" | grep -v grep | grep -v "node server.js"');
```

**修改为**：
```javascript
// 扫描所有三种工具的进程
const tools = ['claude', 'codex', 'openclaw'];
const allProcesses = new Map();

for (const tool of tools) {
  try {
    const { stdout } = await execAsync(`ps aux | grep " ${tool}" | grep -v grep | grep -v "node server.js"`);
    // ... 解析并添加到 allProcesses
  } catch (error) {
    // 该工具没有运行的进程
  }
}
```

#### 4. 前端颜色区分

**修改位置**：`client/src/App.css`

**添加工具特定样式**：
```css
/* Claude Code - 蓝色系 */
.session-card[data-tool="claude-code"] {
  border-color: #3b82f6;
}

.session-card[data-tool="claude-code"] .session-tool {
  color: #60a5fa;
}

/* Codex - 绿色系 */
.session-card[data-tool="codex"] {
  border-color: #10b981;
}

.session-card[data-tool="codex"] .session-tool {
  color: #34d399;
}

/* OpenClaw - 紫色系 */
.session-card[data-tool="openclaw"] {
  border-color: #a855f7;
}

.session-card[data-tool="openclaw"] .session-tool {
  color: #c084fc;
}
```

**修改位置**：`client/src/App.tsx`

**更新 SessionCard 组件**：
```tsx
<div className={cardClass} data-tool={session.tool}>
```

---

## 三、实现步骤

### Step 1: 添加 Codex 支持

1. 在 `server.js` 中添加 `parseCodexMessage` 函数
2. 添加 Codex 目录扫描逻辑
3. 更新 `processFile` 函数支持 Codex 格式
4. 测试：打开 Codex session，验证监控正常

### Step 2: 添加 OpenClaw 支持

1. 在 `server.js` 中添加 `parseOpenClawMessage` 函数
2. 添加 OpenClaw 目录扫描逻辑
3. 更新 `processFile` 函数支持 OpenClaw 格式
4. 测试：打开 OpenClaw session，验证监控正常

### Step 3: 更新进程扫描

1. 修改 `scanProcesses` 函数支持多工具
2. 更新 CWD 编码逻辑（如果需要）
3. 测试：同时运行三种工具，验证进程检测正常

### Step 4: 前端颜色区分

1. 更新 `client/src/App.css` 添加工具特定样式
2. 更新 `client/src/App.tsx` 添加 `data-tool` 属性
3. 测试：验证不同工具的 session 显示不同颜色

### Step 5: 测试和验收

1. 同时运行 Claude Code、Codex、OpenClaw
2. 验证所有工具的 session 都能正常监控
3. 验证颜色区分正确
4. 验证状态机对所有工具都正常工作
5. 运行 E2E 测试

---

## 四、参考文档

- **完整规格**：`doc/agent-arena-monitor-spec.md`（第四节、第七节）
- **Phase 1 实现**：`docs/HANDOFF.md`
- **测试指南**：`docs/ACCEPTANCE.md`

---

## 五、当前项目结构

```
Nexus/
├── server.js           # 后端服务器（需要修改）
├── start.sh            # 一键启动脚本
├── client/             # React 前端（需要修改）
│   ├── src/
│   │   ├── App.tsx     # 主应用（需要修改）
│   │   └── App.css     # 样式（需要修改）
│   └── package.json
├── tests/              # 测试文件
├── docs/               # 详细文档
└── doc/                # 规格文档
```

---

## 六、快速启动

```bash
# 启动服务
./start.sh

# 或手动启动
node server.js              # 后端
cd client && npm run dev    # 前端
```

访问：http://localhost:5173

---

## 七、故障排查

### WebSocket 显示 disconnected
- 刷新浏览器页面
- 检查后端：`curl http://localhost:3000`
- 查看日志：`tail -f /tmp/nexus-server.log`

### 卡片不显示
- 检查进程：`ps aux | grep -E "(claude|codex|openclaw)"`
- 查看日志：`tail -f /tmp/nexus-server.log | grep Session`

---

## 八、重要提醒

1. **增量开发**：一个工具一个工具添加，添加完一个测试一个
2. **保持兼容**：确保添加新工具不影响现有的 Claude Code 监控
3. **代码复用**：尽量复用现有的状态机和 WebSocket 逻辑
4. **测试充分**：每个工具都要单独测试，然后测试多工具并发

---

**下一个 Agent 应该从 Step 1 开始，逐步实现 Phase 2。**

**祝好运！** 🚀

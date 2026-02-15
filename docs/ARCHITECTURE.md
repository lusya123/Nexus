# Nexus 架构说明

## 核心设计理念

Nexus 是一个零配置的本地监控系统，自动发现并实时展示机器上所有 AI 编程工具的活跃 session。

**设计原则：**
- **零人工干预**：Session 自动出现、自动消失
- **进程驱动**：通过操作系统进程判断 session 存活状态
- **增量读取**：只解析文件新增内容，不重复读取
- **质量模型**：Session 停留时间与活跃时长成正比

## Session 生命周期

### 状态机

每个 session 有四种状态：

```
ACTIVE   → 进程在跑 + 文件最近有修改（正在工作）
IDLE     → 进程在跑 + 文件一段时间没修改（用户在思考）
COOLING  → 进程已退出，冷却倒计时中（逐渐淡出）
GONE     → 冷却期结束（从页面移除）
```

### 状态转换流程

```
新文件出现 ──→ ACTIVE
                 │
          文件持续修改 ←──┐
                 │        │
          2分钟无修改     │
                 ↓        │
               IDLE ──────┘ (文件再次修改)
                 │
           进程退出
                 ↓
             COOLING ──→ 冷却期结束 ──→ GONE（移除）
```

### 活跃判定机制

**进程存活 = Session 存活**

通过 `lsof` 命令扫描工具进程：

```bash
lsof -c claude -a -d cwd -F pcn 2>/dev/null
```

- 进程在 → session 开着
- 进程退出 → session 进入冷却期

每 15 秒执行一次进程扫描，结合 `fs.watch` 实时检测文件修改。

### 质量模型：动态冷却时间

Session 的冷却时间根据活跃时长动态计算：

```javascript
function getCooldownDuration(session) {
  const activeSeconds = (session.endTime - session.startTime) / 1000;
  // 活跃时间的 10%，限制在 3秒 ~ 5分钟
  return clamp(activeSeconds * 0.1, 3, 300);
}
```

**效果：**
- 10 秒快速任务 → 停留 3 秒后淡出
- 1 小时长对话 → 停留 6 分钟后淡出
- 自然形成视觉层次：重要的 session 停留更久

## 数据流

```
┌─────────────────┐
│  文件系统监听    │  fs.watch 监听 JSONL 文件
│  ~/.claude/     │
│  ~/.codex/      │
│  ~/.openclaw/   │
└────────┬────────┘
         │
         │ 文件修改事件
         ↓
┌─────────────────┐
│  增量读取器      │  记录字节偏移，只读新增行
│  fileOffsets    │
└────────┬────────┘
         │
         │ 解析 JSONL
         ↓
┌─────────────────┐
│  Session 管理器  │  维护状态机，管理生命周期
│  sessions Map   │
└────────┬────────┘
         │
         │ WebSocket 推送
         ↓
┌─────────────────┐
│  React 前端      │  实时渲染卡片，动画效果
│  浏览器         │
└─────────────────┘

         ↑
         │ 进程扫描（每 15 秒）
         │
┌─────────────────┐
│  lsof 进程扫描   │  检测工具进程存活状态
│  activeProcesses│
└─────────────────┘
```

## 后端架构（模块化设计）

**2026-02-15 重构**：后端已从单体 server.js (475行) 重构为模块化架构 (6个模块)。

### 目录结构

```
server/
├── index.js                    # 主入口，协调各模块
├── websocket.js                # WebSocket 通信层
├── session-manager.js          # 会话生命周期管理
├── parsers/
│   └── claude-code.js         # Claude Code JSONL 解析
└── monitors/
    ├── file-monitor.js        # 文件监听 + 增量读取
    └── process-monitor.js     # 进程扫描
```

### 核心模块

#### 1. server/index.js - 主入口
- 协调所有模块
- 初始化 HTTP/WebSocket 服务器
- 设置定时任务（进程扫描、空闲检测）
- 处理文件变更事件

#### 2. server/websocket.js - WebSocket 通信
- 初始化 WebSocket 服务器
- 管理客户端连接
- 广播消息到所有连接的客户端
- 新客户端连接时同步完整状态

#### 3. server/session-manager.js - 会话管理
- 维护 sessions Map
- 管理会话生命周期状态机（ACTIVE → IDLE → COOLING → GONE）
- 计算动态冷却时间
- 检测空闲会话和进程退出

#### 4. server/parsers/claude-code.js - Claude Code 解析器
- 解析 Claude Code JSONL 格式
- 提取用户和助手消息
- 编码工作目录路径
- 获取 session ID 和项目名称

#### 5. server/monitors/file-monitor.js - 文件监听
- 增量读取 JSONL 文件（记录字节偏移）
- 使用 fs.watch 监听目录变化
- 扫描项目目录发现新会话
- 管理文件监听器生命周期

#### 6. server/monitors/process-monitor.js - 进程监控
- 扫描系统中的 Claude 进程
- 使用 lsof 获取进程工作目录
- 维护活跃进程列表
- 检测进程退出事件

### 模块间通信

```
index.js (主协调器)
    ├─→ websocket.js (广播消息)
    ├─→ session-manager.js (管理状态)
    ├─→ file-monitor.js (监听文件)
    ├─→ process-monitor.js (扫描进程)
    └─→ parsers/claude-code.js (解析数据)
```

### React 前端

- **卡片网格**：响应式布局，按最后活动时间排序
- **动画系统**：错开入场、呼吸灯、淡出效果
- **自动滚动**：新消息到达时滚动到底部

## 扩展性设计

### 添加新工具支持

模块化架构使得添加新工具支持变得简单：

1. **创建新的 parser**：在 `server/parsers/` 下创建新文件（如 `codex.js`）
2. **实现解析函数**：
   - `parseMessage(line)` - 解析消息格式
   - `getSessionId(filePath)` - 提取 session ID
   - `getProjectName(dirPath)` - 获取项目名称
   - `encodeCwd(cwd)` - 编码工作目录路径
3. **更新进程监控**：在 `process-monitor.js` 中添加新工具的进程扫描规则
4. **更新主入口**：在 `server/index.js` 中导入并使用新 parser
5. **前端适配**：添加工具特定的颜色主题和图标

**示例**：添加 Codex 支持只需创建 `server/parsers/codex.js` 并实现上述接口。

## 性能考虑

- **增量读取**：避免重复解析大文件
- **按需监听**：只监听有活跃 session 的目录
- **定时清理**：GONE 状态的 session 自动从内存移除
- **WebSocket 复用**：所有更新通过同一连接推送

## 未来扩展

**Phase 2 计划：**
- 添加 Codex 支持（`~/.codex/sessions/`）
- 添加 OpenClaw 支持（`~/.openclaw/agents/`）
- 多工具颜色区分
- 大规模 session 优化（支持数百个并发 session）

# Nexus 核心数据模型设计

> 设计者：data-model-designer
> 日期：2026-02-19
> 基于：Vision v1.0（00-vision.md 第八节）

## 一、核心实体设计

### 1.1 Machine（机器/集群）

```typescript
interface Machine {
  machineId: string;           // 唯一标识，如 "local" 或 "aws-prod-1"
  name: string;                // 显示名称
  type: 'local' | 'remote';    // 机器类型
  host?: string;               // 远程机器地址
  status: 'online' | 'offline' | 'error';

  // 元数据
  platform?: string;           // darwin, linux, win32
  arch?: string;               // x64, arm64

  // 统计信息（实时计算）
  stats: {
    totalSessions: number;
    activeSessions: number;
    totalDepartments: number;
  };

  createdAt: number;
  lastSeenAt: number;
}
```

**设计说明**：
- 当前版本只支持本地机器（machineId = "local"）
- 为未来多机器支持预留字段
- stats 字段通过聚合计算，不持久化

### 1.2 Department（部门）

```typescript
interface Department {
  departmentId: string;        // 唯一标识，如 "dev", "content", "customer-service"
  machineId: string;           // 所属机器
  name: string;                // 显示名称
  description?: string;

  // 置顶指标配置
  pinnedMetrics: string[];     // Metric ID 列表

  // 统计信息（实时计算）
  stats: {
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
  };

  createdAt: number;
  updatedAt: number;
}
```

**设计说明**：
- 当前版本可以用工具类型（claude-code/codex/openclaw）作为隐式部门
- 未来支持用户自定义部门分类
- pinnedMetrics 支持部门级别的指标定制

### 1.3 Task（任务）

```typescript
interface Task {
  taskId: string;              // 唯一标识
  departmentId: string;        // 所属部门
  machineId: string;           // 所属机器

  name: string;                // 任务名称
  description?: string;

  // 任务状态（三列模型）
  status: 'pending' | 'running' | 'completed';

  // 关联的 Sessions
  sessionIds: string[];        // 执行该任务的 Session 列表

  // 时间信息
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // 元数据
  metadata?: Record<string, any>;
}
```

**设计说明**：
- 三列状态模型：pending → running → completed
- 一个 Task 可以包含多个 Session（例如 OpenClaw 调度多个 Claude Code）
- 当前版本：Task 与 Session 是 1:1 关系，未来扩展为 1:N

### 1.4 Session/Agent（执行单元）

```typescript
interface Session {
  sessionId: string;           // 唯一标识
  taskId?: string;             // 所属任务（可选，当前版本可能为空）
  machineId: string;           // 所属机器

  // 工具信息
  tool: 'claude-code' | 'codex' | 'openclaw';
  name: string;                // 项目名称或 Session 名称

  // 对话内容
  messages: Message[];

  // 文件路径
  filePath: string;            // JSONL 文件路径
  projectDir: string;          // 项目目录

  // 状态管理
  state: 'active' | 'idle' | 'cooling' | 'gone';

  // 时间信息
  startTime: number;
  lastModified: number;
  endTime?: number;

  // 使用统计
  usage?: SessionUsage;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface SessionUsage {
  model?: string;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    cacheWriteTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
}
```

**设计说明**：
- 保持与当前实现兼容
- 增加 taskId 字段用于未来的任务关联
- usage 字段整合了 usage-manager 的数据

### 1.5 Metric（指标）

```typescript
interface Metric {
  metricId: string;            // 唯一标识
  name: string;                // 指标名称
  description?: string;

  // 指标类型
  type: 'counter' | 'gauge' | 'rate' | 'currency';

  // 指标层级
  scope: 'global' | 'machine' | 'department' | 'task' | 'session';
  scopeId?: string;            // 对应层级的 ID

  // 当前值
  value: number;
  unit?: string;               // 单位，如 "tokens", "USD", "sessions"

  // 趋势数据（可选）
  trend?: {
    direction: 'up' | 'down' | 'stable';
    changePercent?: number;
  };

  // 时间信息
  updatedAt: number;
}
```

**设计说明**：
- 支持多层级指标挂载
- 当前版本重点：global 和 tool-level 指标
- 未来扩展：部门级、任务级指标

## 二、数据关系图

```
Machine (1)
  ├─> Department (N)
  │     ├─> Task (N)
  │     │     └─> Session (N)
  │     └─> Metric (N)
  └─> Metric (N)

Global
  └─> Metric (N)
```

**关系说明**：
- Machine → Department：一对多
- Department → Task：一对多
- Task → Session：一对多（当前版本为一对一）
- Metric 可挂载在任何层级

## 三、数据存储方案分析

### 3.1 当前方案：纯内存 + JSONL 文件

**优点**：
- 零配置，启动即用
- 数据源是工具原生文件，无需额外同步
- 轻量级，适合单机场景

**缺点**：
- 重启后需要重新扫描（慢）
- 无法持久化 Machine/Department/Task 等元数据
- 无法支持历史查询和分析
- 多机器场景无法共享数据

### 3.2 推荐方案：SQLite + JSONL 混合

**为什么选择 SQLite？**

1. **零配置**：单文件数据库，无需安装服务
2. **轻量级**：适合本地应用，性能优秀
3. **SQL 支持**：方便查询和聚合
4. **事务支持**：数据一致性保证
5. **跨平台**：macOS/Linux/Windows 都支持

**不选择 PostgreSQL 的原因**：
- 需要安装和配置数据库服务
- 对于单机应用过于重量级
- 增加部署复杂度

**不选择 MongoDB 的原因**：
- 需要安装服务
- 对于结构化数据，SQL 更合适
- 查询和聚合不如 SQL 直观

### 3.3 混合存储架构

```
┌─────────────────────────────────────────┐
│         Nexus Application               │
├─────────────────────────────────────────┤
│  SQLite Database (nexus.db)             │
│  ├─ machines                            │
│  ├─ departments                         │
│  ├─ tasks                               │
│  ├─ sessions (metadata only)            │
│  ├─ metrics                             │
│  └─ usage_history                       │
├─────────────────────────────────────────┤
│  Memory Cache                           │
│  ├─ Active Sessions (full data)         │
│  └─ Real-time Metrics                   │
├─────────────────────────────────────────┤
│  JSONL Files (read-only)                │
│  ├─ ~/.claude/projects/                 │
│  ├─ ~/.codex/sessions/                  │
│  └─ ~/.openclaw/agents/                 │
└─────────────────────────────────────────┘
```

**数据分层**：

1. **SQLite 持久化**：
   - Machine/Department/Task 元数据
   - Session 元数据（不含 messages）
   - 历史 Usage 数据
   - Metrics 历史记录

2. **内存缓存**：
   - 活跃 Session 的完整数据（含 messages）
   - 实时指标计算结果

3. **JSONL 文件**：
   - 保持只读，作为数据源
   - 实时监听文件变化
   - 不修改工具原生文件

### 3.4 数据库 Schema 设计

```sql
-- Machine 表
CREATE TABLE machines (
  machine_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  host TEXT,
  status TEXT NOT NULL,
  platform TEXT,
  arch TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Department 表
CREATE TABLE departments (
  department_id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  pinned_metrics TEXT, -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
);

-- Task 表
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  metadata TEXT, -- JSON object
  FOREIGN KEY (department_id) REFERENCES departments(department_id),
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
);

-- Session 表（元数据）
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  task_id TEXT,
  machine_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  state TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  last_modified INTEGER NOT NULL,
  end_time INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
);

-- Usage History 表
CREATE TABLE usage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cached_input_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Metric 表
CREATE TABLE metrics (
  metric_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id TEXT,
  value REAL NOT NULL,
  unit TEXT,
  updated_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX idx_sessions_machine ON sessions(machine_id);
CREATE INDEX idx_sessions_tool ON sessions(tool);
CREATE INDEX idx_sessions_state ON sessions(state);
CREATE INDEX idx_tasks_department ON tasks(department_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_usage_session ON usage_history(session_id);
CREATE INDEX idx_usage_recorded_at ON usage_history(recorded_at);
```

## 四、数据迁移策略

### 4.1 从当前模型到新模型

**阶段 1：保持兼容（0 破坏性）**

1. 引入 SQLite，但不改变现有逻辑
2. 在后台同步数据到 SQLite
3. 前端继续使用 WebSocket 推送（不变）

**实现**：
```javascript
// 在 session-manager.js 中增加 DB 同步
export function createSession(sessionId, tool, name, filePath, projectDir) {
  const session = { /* 现有逻辑 */ };
  sessions.set(sessionId, session);

  // 新增：同步到 DB
  db.run(`INSERT INTO sessions (...) VALUES (...)`, [sessionId, ...]);

  return session;
}
```

**阶段 2：引入 Machine/Department/Task（渐进式）**

1. 创建默认 Machine（"local"）
2. 将工具类型映射为隐式 Department
3. 每个 Session 自动创建对应的 Task

**映射规则**：
```javascript
// 隐式部门映射
const TOOL_TO_DEPARTMENT = {
  'claude-code': { id: 'dev', name: '研发部' },
  'codex': { id: 'dev-codex', name: '研发部（Codex）' },
  'openclaw': { id: 'automation', name: '自动化部' }
};

// Session → Task 映射（1:1）
function createTaskForSession(session) {
  return {
    taskId: session.sessionId, // 复用 sessionId
    departmentId: TOOL_TO_DEPARTMENT[session.tool].id,
    machineId: 'local',
    name: session.name,
    status: sessionStateToTaskStatus(session.state),
    sessionIds: [session.sessionId]
  };
}
```

**阶段 3：支持用户自定义（未来）**

1. 前端增加 Department 管理界面
2. 支持手动创建 Task 并分配 Session
3. 支持 Task 包含多个 Session

### 4.2 数据恢复策略

**启动时恢复**：
```javascript
async function initializeDatabase() {
  // 1. 从 DB 加载元数据
  const machines = await db.all('SELECT * FROM machines');
  const departments = await db.all('SELECT * FROM departments');
  const tasks = await db.all('SELECT * FROM tasks');

  // 2. 扫描文件系统，发现活跃 Session
  await checkProcesses();

  // 3. 同步 DB 中的 Session 状态
  for (const session of sessions.values()) {
    await db.run('UPDATE sessions SET state = ? WHERE session_id = ?',
      [session.state, session.sessionId]);
  }

  // 4. 清理已结束的 Session（state = 'gone'）
  await db.run('DELETE FROM sessions WHERE state = ?', ['gone']);
}
```

**定期持久化**：
```javascript
// 每 30 秒持久化一次活跃 Session 状态
setInterval(() => {
  for (const [sessionId, session] of sessions.entries()) {
    db.run('UPDATE sessions SET state = ?, last_modified = ? WHERE session_id = ?',
      [session.state, session.lastModified, sessionId]);
  }
}, 30000);
```

## 五、查询模式设计

### 5.1 常见查询

**1. 获取所有活跃 Session**
```sql
SELECT * FROM sessions
WHERE state IN ('active', 'idle')
ORDER BY last_modified DESC;
```

**2. 按部门统计任务**
```sql
SELECT
  d.name AS department_name,
  COUNT(CASE WHEN t.status = 'pending' THEN 1 END) AS pending,
  COUNT(CASE WHEN t.status = 'running' THEN 1 END) AS running,
  COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS completed
FROM departments d
LEFT JOIN tasks t ON d.department_id = t.department_id
GROUP BY d.department_id;
```

**3. 获取 Session 的 Usage 历史**
```sql
SELECT
  recorded_at,
  total_tokens,
  cost_usd
FROM usage_history
WHERE session_id = ?
ORDER BY recorded_at DESC
LIMIT 100;
```

**4. 全局指标聚合**
```sql
SELECT
  tool,
  SUM(total_tokens) AS total_tokens,
  SUM(cost_usd) AS total_cost
FROM usage_history
WHERE recorded_at > ?  -- 今日开始时间
GROUP BY tool;
```

### 5.2 性能优化

1. **索引优化**：已在 Schema 中定义关键索引
2. **分页查询**：历史数据使用 LIMIT/OFFSET
3. **缓存策略**：热数据保持在内存中
4. **定期清理**：删除过期的历史数据

## 六、实施建议

### 6.1 优先级

**P0（必须）**：
- 引入 SQLite，持久化 Session 元数据
- 实现启动时数据恢复
- 保持与现有前端的兼容性

**P1（重要）**：
- 实现 Machine/Department/Task 模型
- 隐式部门映射（工具类型 → 部门）
- Usage 历史数据持久化

**P2（可选）**：
- 前端 Department 管理界面
- 用户自定义 Task 创建
- Metric 历史趋势分析

### 6.2 风险评估

**技术风险**：
- SQLite 文件损坏：定期备份，支持重建
- 数据迁移失败：保持 JSONL 文件作为数据源，可重新扫描

**性能风险**：
- 大量历史数据：定期归档，保留最近 30 天
- 并发写入：SQLite 支持 WAL 模式，提升并发性能

**兼容性风险**：
- 现有前端不受影响：WebSocket 协议保持不变
- 渐进式迁移：分阶段引入新功能

## 七、总结

### 7.1 核心决策

1. **数据库选择**：SQLite（轻量、零配置、适合本地应用）
2. **存储架构**：混合存储（SQLite + 内存 + JSONL）
3. **迁移策略**：渐进式、零破坏性、保持兼容

### 7.2 数据模型特点

- **五个核心实体**：Machine、Department、Task、Session、Metric
- **清晰的层级关系**：Machine → Department → Task → Session
- **灵活的指标系统**：支持多层级挂载
- **向后兼容**：当前 Session 模型无缝升级

### 7.3 下一步行动

1. 创建 SQLite Schema 和迁移脚本
2. 实现 Database Service 层
3. 在 session-manager 中集成 DB 同步
4. 测试数据恢复和持久化
5. 逐步引入 Machine/Department/Task 模型

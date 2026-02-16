# Agent Arena Monitor — 正式开发规格文档

> 历史说明（更新于 2026-02-16）：本文档是设计规格与阶段性实现说明，不是当前运行时真值。当前实现以 `server/index.js`、`README.md`、`docs/ARCHITECTURE.md`、`docs/API.md` 为准。
>
> 当前关键事实：
> - 已支持 `claude-code` / `codex` / `openclaw`
> - 进程扫描周期为 15 秒，空闲检测周期为 30 秒
> - 增加了 `server/usage/*` 与 `usage_totals` 实时推送

## 一、这是什么

一个本地网页，自动发现并实时展示这台机器上 Claude Code、Codex、OpenClaw 的所有活跃 session 对话内容。

打开浏览器，一屏看到所有 session 在同时滚动。session 自动出现、自动消失，零人工干预。

## 二、为什么做

日常同时用 Claude Code、Codex、OpenClaw 工作，每个工具都有多个 session 同时在跑。需要一面监控墙——一眼扫过去就知道每个 session 的状态。

未来 OpenClaw 会编排大量 Claude Code 和 Codex session（几百甚至上千个），Monitor 需要在这个规模下依然清晰可用。

同时这个画面本身就是最好的内容素材。

## 三、核心机制：Session 生命周期

这是整个项目的关键设计。Monitor 需要自动判断哪些 session 应该显示、哪些应该移除，不依赖任何手动操作或外部配置。

### 3.1 活跃判定：进程存活 = Session 存活

一个 session 是否"活跃"，最可靠的信号是**它的工具进程是否还在运行**。

- Claude Code 运行时，有一个 `claude`（node）进程在跑
- Codex 运行时，有对应的进程在跑
- OpenClaw 运行时，有 `openclaw-gateway` 进程在跑

进程在 = session 开着。进程退出 = session 结束。这是操作系统级别的事实。

检测方式：

```bash
# 一条命令拿到所有 claude 进程的 PID 和工作目录
lsof -c claude -a -d cwd -F pcn 2>/dev/null

# 工作目录映射到 session 存储路径
# CWD /Users/xxx/project → ~/.claude/projects/-Users-xxx-project/*.jsonl
# 每个项目目录下最近修改的 JSONL = 当前活跃 session
```

每 10-30 秒执行一次进程扫描，结合文件系统事件（fs.watch）实时检测文件修改。

### 3.2 状态机

每个 session 有四种状态：

```
ACTIVE   → 进程在跑 + 文件最近有修改（正在工作）
IDLE     → 进程在跑 + 文件一段时间没修改（用户在思考/看输出）
COOLING  → 进程已退出，冷却倒计时中（刚结束，逐渐淡出）
GONE     → 冷却期结束（从页面移除）
```

状态转换：

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

ACTIVE 和 IDLE 状态下，只要进程还在跑，session 就一直显示，不会被移除。只有进程退出后才进入 COOLING 倒计时。

### 3.3 质量模型：冷却时间与活跃时长成正比

session 的冷却时间不是固定的，而是根据它的"质量"（活跃时长）动态计算：

```javascript
function getCooldownDuration(session) {
  const activeSeconds = (session.endTime - session.startTime) / 1000;
  // 活跃时间的 10%，限制在 3秒 ~ 5分钟
  return clamp(activeSeconds * 0.1, 3, 300);
}
```

效果：
- OpenClaw 调的 10 秒快速任务 → 停留 3 秒后淡出
- 人跑了 1 小时的长对话 → 停留 6 分钟后淡出
- 自然形成视觉层次：重要的 session 停留更久

## 四、Session 发现与监听

### 4.1 扫描路径

| 工具 | 扫描路径 | 文件格式 |
|------|---------|---------|
| Claude Code | `~/.claude/projects/{project}/*.jsonl` | `{uuid}.jsonl` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | `rollout-{timestamp}-{uuid}.jsonl` |
| OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` | `{sessionId}.jsonl` |

### 4.2 监听机制

- 使用 `fs.watch` 监听上述目录，检测新文件创建和文件修改
- 文件修改时只读取增量（记录上次读取的字节偏移，只解析新增的行）
- 不重新解析整个文件
- 新 session 出现时自动加入页面，不需要刷新浏览器

### 4.3 进程扫描

每 10-30 秒执行一次：

```bash
# 获取所有工具进程的 PID 和工作目录
for cmd in claude codex openclaw; do
  lsof -c $cmd -a -d cwd -F pcn 2>/dev/null
done
```

将进程工作目录映射到 session 存储路径，确定哪些 session 的进程还在运行。

## 五、实时展示

### 5.1 卡片内容

每个 session 一个卡片，卡片内是 user 和 assistant 的对话流。新消息到达时自动滚到底部。

卡片标题显示：工具类型图标 + session 名称（项目路径的最后一段）+ 最后活动时间。

### 5.2 网格布局

所有卡片网格排列，按最后活动时间排序（最新的在前）。不同工具用不同颜色区分：

- Claude Code：蓝色系
- Codex：绿色系
- OpenClaw：紫色系

## 六、视觉缓冲系统

卡片的出现和消失不是瞬间的，而是有惯性、有质感的。类似 Screen Studio 对鼠标动作做空间维度的缓动，Monitor 对 session 卡片做时间维度的缓动。

### 6.1 错开入场

当多个 session 同时出现时（比如 OpenClaw 批量启动），不同时涌入，而是依次滑入：

```javascript
const entryQueue = [];
const STAGGER_DELAY = 150; // 每张卡片间隔 150ms

function enqueueSession(session) {
  entryQueue.push(session);
}

setInterval(() => {
  if (entryQueue.length > 0) {
    const session = entryQueue.shift();
    addCardWithAnimation(session);
  }
}, STAGGER_DELAY);
```

### 6.2 弹性入场动画

卡片从下方滑入，带轻微过冲（弹一下）：

```css
@keyframes card-enter {
  0%   { opacity: 0; transform: translateY(20px) scale(0.95); }
  60%  { opacity: 1; transform: translateY(-4px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.card-entering {
  animation: card-enter 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### 6.3 活跃呼吸灯

正在输出的 session（ACTIVE 状态），边框有微弱的脉动：

```css
.card-active {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.1); }
  50%      { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15); }
}
```

IDLE 状态停止脉动，视觉上安静下来。

### 6.4 缓慢淡出退场

进入 COOLING 状态后，卡片缓慢淡出 + 轻微缩小：

```css
@keyframes card-exit {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.97); }
}

.card-exiting {
  animation: card-exit 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
```

淡出动画的持续时间 = 冷却时间（由质量模型计算），所以长 session 淡出得更慢。

### 6.5 整体视觉效果

像一条河——session 从一端流入，在屏幕上停留一段时间，然后从另一端流走。快的任务像小水花，长的任务像大石头，各有各的节奏。

## 七、JSONL 解析规则

三个工具都是 JSONL（每行一个 JSON），但字段结构不同，各写一个 parser。

**Claude Code：**
- `role: "user"` → user 消息
- `role: "assistant"` → assistant 消息
- 其他行跳过
- content 可能是字符串或数组，兼容两种

**Codex：**
- `type == "response_item"` 且 `payload.role == "user"` → user 消息
- `type == "response_item"` 且 `payload.role == "assistant"` → assistant 消息
- 其他行跳过
- content 是数组，取其中的 text 字段

**OpenClaw：**
- `role == "user"` → user 消息
- `role == "assistant"` → assistant 消息
- 其他行跳过

**通用容错：** 解析失败、空行、未知格式一律跳过，不崩溃。

## 八、不做什么

- 不做调度和控制，只看不操作
- 不做远程连接，只看本机
- 不做数据库，数据源就是 JSONL 文件
- 不解析工具调用细节，tool_calls 只显示摘要
- 不要求用户配置环境变量或命名规范，零配置启动
- 不手动 pin/dismiss 卡片，全自动生命周期管理

## 九、设计原则

### General 优先，不过度工程化

AI 进步很快，今天费力做的很多东西明天可能就没意义了。能用 10 行代码解决的事不要用 100 行。

### 做随 AI 能力提升受益斜率最大的事

AI 越强 → 同时跑的 session 越多 → Monitor 上的卡片越多 → 画面越震撼。核心体验是"同时看到很多卡片在滚动"，不是"把某一个 session 看得特别清楚"。

### 做水面上的船，不做固定山头

Monitor 是纯展示层，只依赖一个事实：这些工具把对话存成了 JSONL 文件。工具改了格式就改 parser，出了新工具就加 parser。Monitor 本身不受影响。

### Monitor 是镜子，不是记忆

Monitor 忠实反映"进程是否在运行"这个事实。session 的输出是否被消费、是否需要后续处理，是调度方（人或 OpenClaw）的责任，不是 Monitor 的责任。

## 十、技术架构

```
┌─────────────────────────────────────────────┐
│                  浏览器                       │
│  网格布局 ← WebSocket ← 实时推送             │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────┴──────────────────────┐
│              Node.js 服务端                   │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 文件监听  │  │ 进程扫描  │  │ JSONL解析  │  │
│  │ fs.watch  │  │ lsof/ps  │  │ 3个parser │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │              │         │
│       └─────────────┴──────────────┘         │
│                     │                        │
│            Session 状态机管理                  │
│       ACTIVE → IDLE → COOLING → GONE         │
└──────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
  ~/.claude/      ~/.codex/     ~/.openclaw/
  projects/       sessions/     agents/
  *.jsonl         *.jsonl       *.jsonl
```

服务端是一个轻量 Node.js 进程，职责：
1. 监听文件系统变化（fs.watch）
2. 定期扫描进程状态（lsof）
3. 解析 JSONL 增量内容
4. 管理 session 状态机
5. 通过 WebSocket 推送到浏览器

前端使用 React + TypeScript，通过 WebSocket 接收数据并渲染。

## 十一、分阶段

### Phase 1：Claude Code（核心流程验证）

只做 Claude Code。先验证：进程检测 + 文件监听 + 实时推送 + 状态机 + 视觉缓冲。

完成标准：
- 打开页面看到活跃的 Claude Code session
- 新开 session 自动出现（弹性入场）
- 对话实时更新
- 关闭 Claude Code 后卡片缓慢淡出消失
- 多个 session 同时出现时错开入场

### Phase 2：Codex + OpenClaw

加两个 parser 和对应的进程检测，颜色区分工具类型。

### Phase 3：体验打磨（按需）

点击放大、布局切换、筛选、手机适配、交互能力。

## 十二、约束

- macOS 环境
- 文件监听只读增量，不重新解析整个文件
- 零配置：用户启动 Monitor 后不需要做任何额外设置
- 全自动：session 的出现和消失完全由进程状态 + 文件活动决定
- 先按最多 30 个同时显示的 session 设计，架构上支持更多

## 十三、项目结构

项目名称：Nexus。根目录即项目根目录。

```
Nexus/
├── package.json       # 后端依赖：express, ws
├── server.js          # Node.js 服务端（全部后端逻辑）
├── client/            # React + TypeScript 前端
│   ├── package.json   # 前端依赖
│   ├── src/
│   └── ...
├── doc/
│   ├── agent-arena-monitor-spec.md      # 本文档（开发规格）
│   └── agent-arena-monitor-requirements.md  # 原始需求文档（参考）
└── .gitignore
```

**技术栈**：
- 后端：Node.js + Express + ws
- 前端：React + TypeScript + Vite

## 十四、Phase 1 实现指南

Phase 1 只做 Claude Code，以下是实现顺序：

### Step 1：server.js 基础骨架

1. 启动 HTTP 服务，serve `public/index.html`
2. 启动 WebSocket 服务
3. 客户端连接时，发送当前所有活跃 session 的完整状态

### Step 2：文件发现与监听

1. 扫描 `~/.claude/projects/` 下所有子目录中的 `*.jsonl` 文件
2. 用 `fs.watch` 监听这些目录，检测新文件和文件修改
3. 文件修改时，从上次读取的字节偏移开始读取新增内容
4. 逐行解析 JSON，提取 user/assistant 消息
5. 通过 WebSocket 推送增量消息到浏览器

### Step 3：进程扫描

1. 每 15 秒执行 `lsof -c claude -a -d cwd -F pcn`
2. 解析输出，得到 PID → CWD 映射
3. CWD 编码规则：`/Users/xxx/project` → `-Users-xxx-project`（把 `/` 替换为 `-`，去掉开头的 `-`... 实际上是把路径中的 `/` 替换为 `-`）
4. 映射到 `~/.claude/projects/{encoded-cwd}/` 目录
5. 该目录下最近修改的 JSONL = 该进程的活跃 session

### Step 4：状态机

1. 每个 session 维护状态：ACTIVE / IDLE / COOLING / GONE
2. 文件修改 → 设为 ACTIVE，记录 lastModified
3. 2 分钟无修改但进程在 → 设为 IDLE
4. 进程扫描发现进程不在了 → 设为 COOLING，计算冷却时间
5. 冷却时间到 → 设为 GONE，通知前端移除
6. 状态变化时通过 WebSocket 推送给前端

### Step 5：前端 React 应用

1. 使用 Vite 创建 React + TypeScript 项目
2. 实现 WebSocket 连接和消息处理
3. 实现 session 卡片组件（网格布局）
4. 收到增量消息后追加到对应卡片，自动滚到底部
5. 收到状态变化后更新卡片样式（ACTIVE 呼吸灯、COOLING 淡出）
6. 实现错开入场队列
7. 实现弹性入场 / 缓慢淡出动画（CSS 或 Framer Motion）

### 关键技术细节

**CWD 编码验证**（在开发前先确认）：
```bash
# 查看实际的目录名来确认编码规则
ls ~/.claude/projects/
```

**增量读取 JSONL**：
```javascript
// 记录每个文件的读取偏移
const fileOffsets = new Map(); // filePath → byteOffset

function readIncremental(filePath) {
  const offset = fileOffsets.get(filePath) || 0;
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  if (stat.size <= offset) { fs.closeSync(fd); return []; }

  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  return buf.toString('utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
```

**WebSocket 消息协议**：
```javascript
// 服务端 → 浏览器的消息类型
{ type: 'session_init', sessionId, tool, name, messages: [] }  // 新 session
{ type: 'message_add', sessionId, message: { role, content } } // 新消息
{ type: 'state_change', sessionId, state: 'active|idle|cooling|gone' } // 状态变化
{ type: 'session_remove', sessionId }  // 移除 session
```

## 十五、开发与测试流程

### 15.1 增量开发原则

**一个 Feature 一个 Feature 写，写完一个测一个。**

开发顺序严格按照 Phase 1 实现指南的 Step 1-5 进行，每完成一个 Step 立即测试验证，确保功能正常后再进入下一个 Step。

### 15.2 各 Feature 测试方法

#### Step 1 测试：基础骨架

**测试目标**：验证服务端启动和 WebSocket 连接。

**测试步骤**：
1. 启动服务端：`node server/index.js`
2. 浏览器访问 `http://localhost:3000`（或配置的端口）
3. 打开浏览器开发者工具，查看 WebSocket 连接状态
4. 验证 WebSocket 连接成功建立

**通过标准**：
- 服务端正常启动，无报错
- WebSocket 连接状态为 `OPEN`
- 控制台无连接错误

#### Step 2 测试：文件发现与监听

**测试目标**：验证文件扫描和实时监听功能。

**测试步骤**：
1. 确保有至少一个活跃的 Claude Code session（打开一个项目）
2. 启动服务端，查看控制台输出
3. 验证服务端发现了现有的 JSONL 文件
4. 在 Claude Code 中发送一条消息
5. 查看服务端控制台，验证文件修改被检测到
6. 验证新消息被解析并通过 WebSocket 推送

**通过标准**：
- 服务端启动时正确扫描并列出所有 JSONL 文件
- 文件修改时触发 `fs.watch` 事件
- 增量读取正确（只读取新增内容，不重新解析整个文件）
- 解析出的消息格式正确（role + content）
- WebSocket 推送消息到前端

**调试技巧**：
- 在服务端添加 `console.log` 输出文件路径和解析结果
- 使用 `ls ~/.claude/projects/` 确认目录结构
- 手动查看 JSONL 文件内容，对比解析结果

#### Step 3 测试：进程扫描

**测试目标**：验证进程检测和 session 映射。

**测试步骤**：
1. 打开 2-3 个不同项目的 Claude Code session
2. 启动服务端，等待进程扫描执行（15 秒）
3. 查看服务端控制台，验证检测到的进程和工作目录
4. 关闭其中一个 Claude Code session
5. 等待下一次进程扫描，验证该 session 被标记为进程退出

**通过标准**：
- `lsof` 命令正确执行，无报错
- PID → CWD 映射正确
- CWD 编码规则正确（路径转换为目录名）
- 进程退出时能正确检测到

**调试技巧**：
- 手动执行 `lsof -c claude -a -d cwd -F pcn` 查看输出格式
- 打印 PID、CWD、编码后的目录名，逐步验证映射逻辑
- 使用 `ps aux | grep claude` 辅助验证进程状态

#### Step 4 测试：状态机

**测试目标**：验证 session 状态转换逻辑。

**测试步骤**：
1. 打开一个 Claude Code session，发送消息 → 验证状态为 ACTIVE
2. 停止发送消息，等待 2 分钟 → 验证状态变为 IDLE
3. 再次发送消息 → 验证状态回到 ACTIVE
4. 关闭 Claude Code → 验证状态变为 COOLING
5. 等待冷却时间结束 → 验证状态变为 GONE，session 被移除

**通过标准**：
- 状态转换时机正确
- 冷却时间计算正确（活跃时长的 10%，限制在 3 秒 ~ 5 分钟）
- 状态变化时通过 WebSocket 推送给前端
- GONE 状态后 session 从内存中移除

**调试技巧**：
- 在状态转换时打印日志：`[Session ${id}] ${oldState} → ${newState}`
- 打印冷却时间计算过程
- 使用较短的测试时间（如 10 秒代替 2 分钟）加速测试

#### Step 5 测试：前端 React 应用

**测试目标**：验证前端展示和动画效果。

**测试步骤**：
1. 启动前端开发服务器：`cd client && npm run dev`
2. 浏览器访问前端页面
3. 验证现有 session 正确显示（网格布局）
4. 打开新的 Claude Code session → 验证卡片弹性入场动画
5. 发送消息 → 验证消息实时追加，自动滚动到底部
6. 验证 ACTIVE 状态的呼吸灯效果
7. 同时打开 3 个 session → 验证错开入场（150ms 间隔）
8. 关闭一个 session → 验证淡出动画

**通过标准**：
- WebSocket 连接正常
- session 卡片正确渲染（工具类型、名称、时间）
- 消息列表正确显示 user/assistant 对话
- 入场动画流畅（弹性效果）
- 呼吸灯动画正常（ACTIVE 状态）
- 淡出动画正常（COOLING 状态）
- 错开入场效果明显

**调试技巧**：
- 使用 React DevTools 查看组件状态
- 在浏览器控制台查看 WebSocket 消息
- 使用 CSS 动画调试工具查看动画效果
- 调整动画时长（如 0.1s）加速测试

### 15.3 全面测试

完成所有 Step 后，进行端到端的全面测试。

#### 测试场景 1：单 Session 完整生命周期

1. 启动服务端和前端
2. 打开一个 Claude Code session
3. 验证卡片出现（弹性入场）
4. 发送 5-10 条消息，验证实时更新
5. 停止发送消息 2 分钟，验证状态变为 IDLE（呼吸灯停止）
6. 再次发送消息，验证状态回到 ACTIVE
7. 关闭 Claude Code，验证淡出动画
8. 等待冷却时间结束，验证卡片消失

#### 测试场景 2：多 Session 并发

1. 同时打开 5 个不同项目的 Claude Code session
2. 验证 5 个卡片依次入场（错开 150ms）
3. 在不同 session 中随机发送消息
4. 验证每个卡片独立更新，互不干扰
5. 关闭其中 2 个 session，验证只有对应卡片淡出
6. 再打开 3 个新 session，验证新卡片正确入场

#### 测试场景 3：长时间运行

1. 启动服务端和前端
2. 打开 2-3 个 Claude Code session
3. 持续运行 30 分钟以上
4. 期间随机发送消息、打开/关闭 session
5. 验证无内存泄漏（查看服务端内存占用）
6. 验证 WebSocket 连接稳定（无断线重连）
7. 验证文件监听正常（无遗漏消息）

#### 测试场景 4：边界情况

1. **空状态**：启动时没有任何 Claude Code session，验证页面显示正常
2. **快速开关**：快速打开并立即关闭 session（< 3 秒），验证冷却时间最小值生效
3. **长对话**：运行一个 session 超过 1 小时，验证冷却时间最大值生效（5 分钟）
4. **大量消息**：在一个 session 中发送 100+ 条消息，验证性能正常
5. **文件损坏**：手动修改 JSONL 文件（添加非法 JSON），验证容错处理
6. **进程异常**：强制 kill Claude Code 进程，验证进程扫描能检测到

### 15.4 E2E 测试（端到端自动化测试）

完成所有功能开发和手动测试后，必须进行 E2E 自动化测试，确保最终交付的质量。

#### 测试工具

使用 **Puppeteer MCP server** 进行浏览器自动化测试。Puppeteer 可以模拟真实用户操作，验证前端界面和交互逻辑。

#### E2E 测试场景

**场景 1：首次启动和 Session 发现**
```javascript
// 1. 启动服务端和前端
// 2. 打开浏览器访问前端页面
// 3. 验证页面正常加载
// 4. 验证 WebSocket 连接成功
// 5. 验证现有 Claude Code session 自动显示
// 6. 验证卡片内容正确（名称、时间、消息）
```

**场景 2：实时消息更新**
```javascript
// 1. 页面已打开，显示一个 session
// 2. 在 Claude Code 中发送一条消息
// 3. 等待 1-2 秒
// 4. 验证前端页面自动更新，新消息出现
// 5. 验证消息内容正确
// 6. 验证自动滚动到底部
```

**场景 3：新 Session 入场动画**
```javascript
// 1. 页面已打开
// 2. 打开一个新的 Claude Code session
// 3. 验证新卡片出现
// 4. 验证弹性入场动画执行（检查 CSS 动画类名）
// 5. 验证卡片位置正确（网格布局）
```

**场景 4：多 Session 错开入场**
```javascript
// 1. 页面已打开，无 session
// 2. 快速打开 3 个 Claude Code session
// 3. 验证 3 个卡片依次出现（不是同时）
// 4. 测量入场时间间隔（应约为 150ms）
// 5. 验证最终 3 个卡片都正确显示
```

**场景 5：状态转换（ACTIVE → IDLE）**
```javascript
// 1. 页面显示一个 ACTIVE 状态的 session
// 2. 验证呼吸灯动画存在（检查 CSS 类名或动画）
// 3. 等待 2 分钟（或使用缩短的测试时间）
// 4. 验证状态变为 IDLE
// 5. 验证呼吸灯动画停止
```

**场景 6：Session 退出和淡出**
```javascript
// 1. 页面显示一个 session
// 2. 关闭对应的 Claude Code session
// 3. 等待进程扫描周期（15 秒）
// 4. 验证卡片开始淡出动画
// 5. 等待冷却时间结束
// 6. 验证卡片从页面消失
```

**场景 7：长时间运行稳定性**
```javascript
// 1. 启动服务端和前端
// 2. 打开 2 个 Claude Code session
// 3. 每隔 30 秒发送一条消息
// 4. 持续运行 10 分钟
// 5. 验证无内存泄漏（监控浏览器内存）
// 6. 验证 WebSocket 连接稳定（无断线）
// 7. 验证所有消息都正确显示
```

**场景 8：边界情况 - 空状态**
```javascript
// 1. 确保没有任何 Claude Code session 运行
// 2. 启动服务端和前端
// 3. 打开浏览器访问页面
// 4. 验证页面正常显示（空状态）
// 5. 验证无 JavaScript 错误
// 6. 打开一个新 session
// 7. 验证卡片正确出现
```

**场景 9：网络重连**
```javascript
// 1. 页面已打开，显示 session
// 2. 重启服务端（模拟网络中断）
// 3. 验证前端检测到 WebSocket 断开
// 4. 服务端重启完成后
// 5. 验证前端自动重连
// 6. 验证 session 状态恢复正常
```

#### E2E 测试实现建议

1. **创建测试脚本目录**：`tests/e2e/`
2. **使用 Puppeteer MCP server** 编写自动化测试脚本
3. **测试脚本结构**：
   ```javascript
   // tests/e2e/session-lifecycle.test.js
   describe('Session Lifecycle', () => {
     test('should display existing sessions on load', async () => {
       // 测试逻辑
     });

     test('should show new session with animation', async () => {
       // 测试逻辑
     });

     // ... 更多测试
   });
   ```

4. **测试辅助工具**：
   - 创建测试用的 Claude Code session 启动脚本
   - 创建清理测试数据的脚本
   - 使用 Puppeteer 的截图功能记录测试过程

5. **CI/CD 集成**（可选）：
   - 在 GitHub Actions 中运行 E2E 测试
   - 每次 commit 前自动执行测试

#### E2E 测试通过标准

- ✅ 所有 9 个 E2E 测试场景通过
- ✅ 测试覆盖率达到核心功能的 100%
- ✅ 测试可重复执行，结果稳定
- ✅ 测试脚本有清晰的注释和文档
- ✅ 发现的 bug 都已修复并添加回归测试

### 15.5 测试通过标准

Phase 1 完成的标准：

- ✅ 所有 5 个 Step 的单元测试通过
- ✅ 4 个全面测试场景全部通过
- ✅ **所有 E2E 自动化测试通过**
- ✅ 无明显 bug 或性能问题
- ✅ 代码可读性良好，关键逻辑有注释
- ✅ 服务端和前端都能正常启动，无报错

**重要**：E2E 测试是最终交付的必要条件。只有通过完整的 E2E 测试，才能确保产品质量，Phase 1 才算真正完成。

达到以上标准后，Phase 1 才算真正完成，可以进入 Phase 2。

# Agent Arena Monitor — 正式开发规格文档

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
- 不做构建流程，前端一个 HTML 文件
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

前端是一个纯 HTML 文件，通过 WebSocket 接收数据并渲染。

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
├── package.json       # 依赖：仅 ws（WebSocket 库）
├── server.js          # Node.js 服务端（全部后端逻辑）
├── public/
│   └── index.html     # 前端单文件（HTML + CSS + JS 内联）
├── agent-arena-monitor-spec.md      # 本文档（开发规格）
└── agent-arena-monitor-requirements.md  # 原始需求文档（参考）
```

不需要构建工具、不需要框架、不需要 TypeScript。保持最简。

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

### Step 5：前端 index.html

1. 连接 WebSocket
2. 收到 session 数据后渲染卡片（网格布局）
3. 收到增量消息后追加到对应卡片，自动滚到底部
4. 收到状态变化后更新卡片样式（ACTIVE 呼吸灯、COOLING 淡出）
5. 实现错开入场队列
6. 实现弹性入场 / 缓慢淡出 CSS 动画

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

## 十五、给下一个 Claude Code 的提示词

复制以下内容作为提示词，在 Nexus 项目根目录下启动新的 Claude Code session：

---

请阅读 `agent-arena-monitor-spec.md`，这是 Nexus 项目的完整开发规格文档。

你的任务是从零开始搭建项目架构并实现 Phase 1（只做 Claude Code 支持）。

第零步：初始化 Git 仓库
- `git init` 初始化本地仓库
- 创建 `.gitignore`（至少包含 `node_modules/`）
- 用 `gh repo create Nexus --public --source=. --push` 创建远程仓库并推送（如果远程已存在则跳过，直接关联）

第一步：初始化项目
- 在当前目录（Nexus 根目录）创建 `package.json`、`server.js`、`public/index.html`
- 依赖只需要 `ws`（WebSocket 库），然后 `npm install`

第二步：按文档第十四节的 Step 1 → Step 5 顺序实现
- 文档中有详细的实现步骤、关键技术细节、WebSocket 消息协议
- 每完成一个 Step 后，必须先测试验证功能正常，再 commit。commit message 写清楚这个 Step 做了什么
- 不要一口气写完所有代码再测试，逐步推进、逐步验证

第三步：全面测试
- 所有 Step 完成后，从头到尾做一次完整的端到端测试
- 测试场景包括：
  - 启动 Monitor，确认能发现已有的活跃 Claude Code session
  - 新开一个 Claude Code session，确认自动出现
  - 在 Claude Code 中对话，确认实时更新
  - 关闭 Claude Code，确认卡片淡出消失
  - 同时开多个 session，确认错开入场、网格排列正常
  - 刷新浏览器页面，确认能重新加载所有活跃 session
  - 长时间无操作后恢复，确认状态机正确
- 全部测试通过后，做最终 commit 并 push 到远程

完成标准：
1. `npm start` 启动服务，浏览器打开后能看到当前活跃的 Claude Code session
2. 新开一个 Claude Code session，页面自动出现新卡片（弹性入场）
3. 在 Claude Code 中对话，卡片内实时显示新消息
4. 关闭 Claude Code，卡片缓慢淡出消失
5. 多个 session 同时存在时，错开入场、网格排列

---

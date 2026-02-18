# Nexus — 需求文档

> 历史说明（更新于 2026-02-16）：本文档记录的是立项阶段需求与边界，不是当前实现真值。当前行为以 `README.md`、`docs/ARCHITECTURE.md`、`docs/API.md` 为准。

## 一、这是什么

一个本地网页，自动发现并实时展示这台机器上 Claude Code、Codex、OpenClaw 的所有 session 对话内容。

打开浏览器，一屏看到所有 session 在同时滚动。

## 二、为什么做

我日常同时用 Claude Code、Codex、OpenClaw 工作，每个工具都会有多个 session 同时在跑。但我没有一个地方能同时看到它们全部在干什么。

我需要一面监控墙——一眼扫过去就知道每个 session 的状态。

同时这个画面本身就是最好的内容素材。

## 三、核心功能

### 3.1 自动发现活跃 Session

Nexus 启动后自动扫描本机三个工具的存储目录，找到**正在活跃的** session 并展示。JSONL 文件会永久保存在磁盘上，但 Nexus 只关心最近有过更新的那些。

判断标准：JSONL 文件在最近 N 分钟内被修改过（默认 30 分钟）。超过这个时间没有新内容写入的 session，从页面上移除。

新的 session 出现时自动加入，不需要刷新页面。session 长时间没有活动后自动消失。

三个工具的 session 存储位置：

| 工具 | 扫描路径 | 文件格式 |
|------|---------|---------|
| Claude Code | `~/.claude/projects/{project}/*.jsonl` | `{uuid}.jsonl` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | `rollout-{timestamp}-{uuid}.jsonl` |
| OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` | `{sessionId}.jsonl` |

### 3.2 实时展示对话

三个工具都实时写入 JSONL 文件（Claude Code 流式 1-2 秒更新、Codex 每个回复完成后写入、OpenClaw 每条消息后写入）。Nexus 监听文件变化，解析新增的行，实时推送到浏览器。

每个 session 一个卡片，卡片内是 user 和 assistant 的对话流，新消息到达时自动滚到底部。

### 3.3 网格布局

所有卡片网格排列，按最后活动时间排序。卡片标题显示工具类型 + session 名称 + 最后活动时间。不同工具不同颜色。

## 四、不做什么

- 不做调度和控制，只看不操作
- 不做远程连接，只看本机
- 不做数据库，数据源就是 JSONL 文件
- 不做构建流程，前端一个 HTML 文件
- 不解析工具调用细节，tool_calls 只显示摘要

## 五、JSONL 解析规则

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

## 六、设计原则

### General 优先，不过度工程化

AI 进步很快，今天费力做的很多东西明天可能就没意义了。一次模型能力的提升，现在的很多问题也就都解决了。能用 10 行代码解决的事不要用 100 行。

### 做随 AI 能力提升受益斜率最大的事

AI 越强 → 同时跑的 session 越多 → Nexus 上的卡片越多 → 画面越震撼。核心体验是"同时看到很多卡片在滚动"，不是"把某一个 session 看得特别清楚"。

### 做水面上的船，不做固定山头

Nexus 是纯展示层，只依赖一个事实：这些工具把对话存成了 JSONL 文件。工具改了格式就改 parser，出了新工具就加 parser。Nexus 本身不受影响。

### 先能看到，再说好不好看

Phase 1 的唯一目标是浏览器里能看到 session 在实时滚动。丑没关系，先让画面存在。

## 七、分阶段

### Phase 1：Claude Code（1-2 天）

只做 Claude Code。调研数据最充分，先验证核心流程。

完成标准：打开页面看到活跃的 Claude Code session，新开 session 自动出现，对话实时更新。

### Phase 2：Codex + OpenClaw（1-2 天）

加两个 parser，颜色区分工具类型。

### Phase 3：体验打磨（按需）

点击放大、布局切换、筛选、手机适配、交互能力。

## 八、约束

- macOS 环境
- 文件监听只读增量，不重新解析整个文件
- 先按最多 30 个 session 设计

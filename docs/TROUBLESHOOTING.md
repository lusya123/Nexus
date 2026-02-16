# 故障排查

## 0. 先确认服务状态

```bash
nexus status
```

常见端口：

- 生产模式：`3000`
- 开发模式前端：`5173`

## 1. WebSocket 显示 disconnected

排查顺序：

1. 后端是否监听 3000：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

2. 使用控制脚本查看日志：

```bash
nexus logs prod
# 或开发模式
nexus logs backend
```

3. 浏览器 Network -> WS 查看连接是否成功建立。

4. 重启服务：

```bash
nexus restart
# 或开发模式
nexus dev-restart
```

## 2. 页面没有会话卡片

可能原因：

- 当前确实没有活跃会话
- 对应工具日志目录不存在或为空
- 进程扫描未识别到工具进程

排查命令：

```bash
# Claude Code
ls -la ~/.claude/projects
ps aux | rg -i claude

# Codex
ls -la ~/.codex/sessions
ps aux | rg -i codex

# OpenClaw
ls -la ~/.openclaw/agents
ps aux | rg -i openclaw
```

查看后端日志中的扫描信息：

```bash
nexus logs prod | rg -i "process|watch|session|scanned"
```

## 3. 会话有卡片但消息不更新

可能原因：

- 文件监听未覆盖到对应目录
- 文件变化没有触发（由轮询兜底会有一定延迟）
- parser 过滤掉了非文本噪音行

建议：

1. 在会话内再发送一条明确文本消息。
2. 等待一个进程扫描周期（最多约 15 秒）。
3. 查看日志确认是否出现 `message_add` 前置解析日志。

```bash
nexus logs prod | rg -i "message|session|watch"
```

## 4. 状态不从 active/idle 变为 gone

这是正常的两段式状态机：

- 先进入 `cooling`
- 再根据活跃时长计算冷却时间（3s 到 5min）
- 冷却结束后才 `gone`

如需验证，建议观察 `state_change` 与 `session_remove` 事件顺序。

## 5. 用量或金额不更新

先确认 `usage_totals` 是否有推送，再区分来源：

- 实时增量：来自日志新增 usage 事件
- 历史回扫：启动后后台 backfill
- 外部覆盖：每 5 分钟刷新一次（Claude/Codex）

排查命令：

```bash
nexus logs prod | rg -i "usage|backfill|pricing|external"
```

说明：

- 未知模型可能出现 Token 有值但 USD 为 0。
- 回扫运行中时，`backfill.status` 会是 `running`。

## 6. 前端启动或构建失败

```bash
# 安装依赖
npm install
npm install --prefix client

# 本地开发
nexus dev-start

# 构建前端
npm run build --prefix client
```

检查 Node 版本（建议 >= 18）：

```bash
node --version
```

## 7. 日志路径与日志级别

推荐通过脚本查看日志：

```bash
nexus logs prod
nexus logs backend
nexus logs frontend
```

`nexusctl` 默认日志目录：

- 优先：`$NEXUS_STATE_DIR`（未设置时是 `~/.nexus`）
- 回退：`<repo>/.nexus-runtime`

临时打开调试日志：

```bash
LOG_LEVEL=DEBUG node server/index.js
```

## 8. 常见错误

### `EADDRINUSE: address already in use :::3000`

端口被占用。先定位占用进程再停止：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

### `ENOENT`（文件不存在）

通常是会话文件被移动/删除。服务会跳过不可读文件；必要时重启一次可清理监听状态。

### WebSocket 连接失败

确认你连接的是后端端口 `ws://localhost:3000`，并确保后端正在运行。

## 9. 仍无法定位

请附上以下信息再排查：

1. `nexus status` 输出
2. `node --version`
3. 复现步骤
4. 相关日志片段（`nexus logs ...`）

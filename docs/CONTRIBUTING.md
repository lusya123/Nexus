# 贡献指南

## 1. 当前架构

后端采用模块化结构：

- `server/index.js`：流程编排与调度
- `server/parsers/*.js`：工具日志解析（消息 + usage）
- `server/monitors/*.js`：文件监听与进程扫描
- `server/session-manager.js`：会话状态机
- `server/usage/*.js`：用量聚合、定价、外部覆盖
- `server/websocket.js`：协议推送

## 2. 本地开发

推荐使用控制脚本：

```bash
# 启动前后端开发模式
nexus dev-start

# 停止
nexus dev-stop

# 查看日志
nexus logs backend
nexus logs frontend
```

手动方式：

```bash
node server/index.js
npm run dev --prefix client
```

## 3. 测试

```bash
npm test
npm run test:codex
npm run test:usage-parsers
npm run test:usage-manager

# 可选：端到端
node tests/e2e-test.js
```

## 4. 如何新增工具支持

### 4.1 新建 parser

在 `server/parsers/` 下新增 `<tool>.js`，至少实现：

- `parseMessage(line)`
- `parseUsageEvent(line)`（如工具可提供 usage）
- `getSessionId(filePath)`
- `getProjectName(dirPath)`
- `encodeCwd(cwd)`
- 工具根目录常量（如 `MYTOOL_SESSIONS_DIR`）

### 4.2 接入主流程

在 `server/index.js` 中：

1. 导入 parser
2. 在 `checkProcesses()` 中增加该工具的活跃发现
3. 在启动扫描阶段接入目录扫描与 `watchProjectDir`
4. 在 `processFile()` 传入工具名与 parser
5. 确认 `usage_totals` 聚合路径可覆盖该工具

### 4.3 前端显示

在 `client/src/App.tsx` 的 `TOOL_CONFIG` 中添加工具展示配置（label、color、borderColor）。

### 4.4 文档同步

至少更新：

- `README.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/TROUBLESHOOTING.md`

## 5. 提交前自检

1. WebSocket `init` 能返回 `sessions + usageTotals`
2. 新消息能触发 `message_add`
3. 会话状态可走完 `active/idle -> cooling -> session_remove`
4. `usage_totals` 能在消息写入后变化
5. 前端多工具卡片渲染正常

## 6. 约束

- 状态枚举统一小写：`active | idle | cooling | gone`
- WebSocket 消息类型：
  - `init`
  - `session_init`
  - `message_add`
  - `state_change`
  - `session_remove`
  - `usage_totals`
- Parser 层应过滤噪音行，避免污染消息流

# 贡献指南

## 目标

本项目当前采用模块化后端架构：
- `server/index.js` 负责组装与调度
- `server/parsers/*.js` 负责不同工具的 JSONL 解析
- `server/monitors/*.js` 负责文件监听与进程扫描
- `server/session-manager.js` 负责会话状态机
- `server/websocket.js` 负责协议推送

## 本地开发

```bash
# 后端
node server/index.js

# 前端
cd client
npm run dev
```

默认地址：`http://localhost:5173`

## 测试

```bash
# 轻量验证（需要后端已启动）
node tests/verify-phase1.js

# E2E（需要前后端已启动）
node tests/e2e-test.js
```

## 如何新增工具支持

### 1. 新建 parser

在 `server/parsers/` 下新增文件（例如 `mytool.js`），并实现与现有 parser 一致的接口：

- `parseMessage(line)`
- `getSessionId(filePath)`
- `getProjectName(dirPath)`
- `encodeCwd(cwd)`
- 工具根目录常量（如 `MYTOOL_SESSIONS_DIR`）

可参考：
- `server/parsers/claude-code.js`
- `server/parsers/codex.js`
- `server/parsers/openclaw.js`

### 2. 接入主流程

在 `server/index.js` 中：
- 导入新 parser
- 在 `checkProcesses()` 中加入该工具的进程扫描
- 在启动阶段加入该工具目录扫描与 `watchProjectDir` 监听
- 在 `processFile()` 调用中传入对应 parser 与 tool name

### 3. 前端显示

在 `client/src/App.tsx` 的 `TOOL_CONFIG` 中添加新工具展示配置（label/color/borderColor）。

### 4. 文档同步

至少更新：
- `README.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`

## 提交建议

推荐提交前自检：

1. 启动后端并确认 WebSocket `init` 能返回 session 列表
2. 手动触发消息追加，确认收到 `message_add`
3. 关闭对应进程，确认状态流转 `active/idle -> cooling -> gone`
4. 前端确认多工具卡片渲染正常

## 常见约束

- 会话状态使用小写：`active | idle | cooling | gone`
- WebSocket 消息类型使用：`init | session_init | message_add | state_change | session_remove`
- Parser 层应尽量过滤无意义噪音行，避免污染前端消息流

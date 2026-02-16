# 后端架构重构记录

**日期**：2026-02-15
**提交**：065f4c7
**执行者**：AI Agent (Claude Code)

> 历史说明（更新于 2026-02-16）：本文档记录 2026-02-15 当天重构快照。当前代码已继续演进，包含多工具 parser 与 `server/usage/*` 模块，文件行数与模块数量不再与本文完全一致。

## 背景

原有的 `server.js` 是一个 475 行的单体文件，包含了所有后端逻辑：
- WebSocket 服务
- 文件监听
- 进程扫描
- 会话管理
- JSONL 解析

这种结构存在以下问题：
1. **可维护性差**：所有代码混在一起，难以定位和修改
2. **可扩展性弱**：添加新工具支持需要修改大量代码
3. **可测试性低**：模块耦合严重，难以进行单元测试
4. **代码复用难**：功能无法独立复用

## 重构目标

1. **模块化**：按功能职责拆分为独立模块
2. **单一职责**：每个模块只负责一个明确的功能
3. **易扩展**：添加新工具支持只需新增 parser
4. **可测试**：模块独立，便于单元测试

## 新架构

### 目录结构

```
server/
├── index.js                    # 主入口（136 行）
├── websocket.js                # WebSocket 通信（40 行）
├── session-manager.js          # 会话管理（127 行）
├── parsers/
│   └── claude-code.js         # Claude Code 解析（65 行）
└── monitors/
    ├── file-monitor.js        # 文件监听（110 行）
    └── process-monitor.js     # 进程扫描（80 行）
```

### 模块职责

#### server/index.js
- 应用入口点
- 初始化 Express 和 HTTP 服务器
- 协调各模块工作
- 设置定时任务

#### server/websocket.js
- 初始化 WebSocket 服务器
- 管理客户端连接
- 广播消息到所有客户端

#### server/session-manager.js
- 维护会话状态（sessions Map）
- 实现状态机逻辑
- 管理冷却定时器
- 检测空闲会话

#### server/parsers/claude-code.js
- 解析 Claude Code JSONL 格式
- 提取消息内容
- 路径编码/解码
- 提供工具特定的常量

#### server/monitors/file-monitor.js
- 增量读取文件（记录偏移量）
- 监听目录变化（fs.watch）
- 扫描项目目录
- 管理文件监听器

#### server/monitors/process-monitor.js
- 扫描系统进程（ps + lsof）
- 维护活跃进程列表
- 检测进程退出
- 映射进程到项目目录

## 重构过程

### 1. 提取 WebSocket 模块
```javascript
// 从 server.js 提取 WebSocket 初始化和广播逻辑
export function initWebSocket(server, initialSessions) { ... }
export function broadcast(message) { ... }
```

### 2. 提取会话管理模块
```javascript
// 集中管理 sessions Map 和状态转换
export function createSession(...) { ... }
export function setSessionState(...) { ... }
export function checkIdleSessions(...) { ... }
```

### 3. 提取文件监听模块
```javascript
// 文件系统操作和增量读取
export function readIncremental(filePath, parseMessageFn) { ... }
export function watchProjectDir(projectDir, onFileChange) { ... }
```

### 4. 提取进程监控模块
```javascript
// 进程扫描和状态追踪
export function scanProcesses(projectsDir, encodeCwdFn) { ... }
export function getActiveProjectDirs() { ... }
```

### 5. 提取解析器模块
```javascript
// Claude Code 特定的解析逻辑
export function parseMessage(line) { ... }
export function encodeCwd(cwd) { ... }
```

### 6. 重构主入口
```javascript
// 导入所有模块并协调工作
import * as ClaudeCodeParser from './parsers/claude-code.js';
import * as FileMonitor from './monitors/file-monitor.js';
// ...
```

## 测试验证

### 功能测试
- ✅ HTTP 服务：200 OK
- ✅ WebSocket 连接：成功
- ✅ 会话发现：659 个会话
- ✅ 项目扫描：93 个目录
- ✅ 文件监听：93 个目录
- ✅ 进程扫描：正常

### 集成测试
- ✅ 官方验证：Phase 1 verification PASSED (3/3)
- ✅ 前端构建：成功
- ✅ 前后端通信：正常

### 代码统计
- 旧架构：475 行（单文件）
- 新架构：558 行（6 个模块）
- 增加：83 行（主要是模块导出和注释）

## 改进效果

### 1. 可维护性提升
- 每个模块职责清晰，易于理解
- 修改某个功能只需关注对应模块
- 代码组织更加直观

### 2. 可扩展性增强
- 添加新工具支持只需创建新 parser
- 模块间通过接口通信，耦合度低
- 易于添加新的监控策略

### 3. 可测试性改善
- 每个模块可以独立测试
- 依赖注入使得 mock 更容易
- 测试覆盖率更容易提升

### 4. 代码复用
- 文件监听逻辑可复用于其他工具
- 进程监控可扩展支持多种工具
- 会话管理逻辑独立于具体工具

## 后续优化建议

### 短期（Phase 2）
1. 添加 Codex parser（`server/parsers/codex.js`）
2. 添加 OpenClaw parser（`server/parsers/openclaw.js`）
3. 扩展进程监控支持多工具
4. 添加单元测试

### 长期
1. 实现 parser 插件系统
2. 添加配置文件支持
3. 实现日志系统
4. 添加性能监控
5. 支持分布式部署

## 文件变更清单

### 删除
- `server.js` (475 行)

### 新增
- `server/index.js` (136 行)
- `server/websocket.js` (40 行)
- `server/session-manager.js` (127 行)
- `server/parsers/claude-code.js` (65 行)
- `server/monitors/file-monitor.js` (110 行)
- `server/monitors/process-monitor.js` (80 行)

### 修改
- `package.json` - 更新 main 字段
- `start.sh` - 更新启动路径
- `README.md` - 更新项目结构说明
- `docs/ARCHITECTURE.md` - 更新架构文档

## 兼容性

- ✅ 完全向后兼容
- ✅ API 接口不变
- ✅ WebSocket 协议不变
- ✅ 前端无需修改

## 总结

这次重构成功将单体后端拆分为清晰的模块化架构，显著提升了代码的可维护性、可扩展性和可测试性。所有功能测试通过，为后续添加新工具支持（Codex、OpenClaw）奠定了良好基础。

重构遵循了以下原则：
- **单一职责原则**：每个模块只做一件事
- **开闭原则**：对扩展开放，对修改封闭
- **依赖倒置原则**：依赖抽象而非具体实现
- **接口隔离原则**：模块间通过清晰的接口通信

这是一次成功的技术债务清理，为项目的长期发展打下了坚实基础。

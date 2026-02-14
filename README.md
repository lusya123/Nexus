# Nexus - Agent Arena Monitor

Phase 1: 终端墙 - 实时监控本地 Claude Code sessions

## 快速开始

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client
npm install
cd ..
```

### 2. 启动服务

```bash
# 启动后端服务器（终端 1）
node server.js

# 启动前端开发服务器（终端 2）
cd client
npm run dev
```

### 3. 访问应用

打开浏览器访问：http://localhost:5173

## 功能特性

- ✅ **自动发现**：自动扫描并监控所有本地 Claude Code sessions
- ✅ **实时更新**：对话内容实时推送到浏览器
- ✅ **状态管理**：ACTIVE / IDLE / COOLING / GONE 四种状态
- ✅ **优雅动画**：错开入场、弹性动画、呼吸灯效果
- ✅ **零配置**：启动后无需任何额外配置

## 技术栈

- **后端**：Node.js + Express + WebSocket
- **前端**：React + TypeScript + Vite
- **监控**：文件系统监听 + 进程扫描

## 项目结构

```
Nexus/
├── server.js           # 后端服务器
├── package.json        # 后端依赖
├── public/             # 静态文件
│   └── index.html      # 备用 HTML 页面
├── client/             # React 前端
│   ├── src/
│   │   ├── App.tsx     # 主应用组件
│   │   ├── App.css     # 样式和动画
│   │   └── main.tsx    # 入口文件
│   └── package.json    # 前端依赖
└── doc/                # 文档
    └── agent-arena-monitor-spec.md  # 完整规格文档
```

## 工作原理

1. **文件监听**：监控 `~/.claude/projects/` 下的所有 JSONL 文件
2. **增量读取**：只读取文件的新增内容，不重新解析整个文件
3. **进程扫描**：每 15 秒扫描 Claude Code 进程，判断 session 是否活跃
4. **状态机**：根据文件活动和进程状态自动转换 session 状态
5. **实时推送**：通过 WebSocket 将更新推送到浏览器

## Session 状态

- **ACTIVE**：进程在运行 + 文件最近有修改（呼吸灯效果）
- **IDLE**：进程在运行 + 文件一段时间没修改（静止状态）
- **COOLING**：进程已退出，冷却倒计时中（淡出动画）
- **GONE**：冷却期结束，从页面移除

## 开发

### 运行测试

```bash
# 验证 Phase 1 功能
node verify-phase1.js
```

### 查看日志

```bash
# 后端日志
tail -f /tmp/nexus-server.log

# 前端日志
tail -f /tmp/nexus-client.log
```

## Phase 1 完成标准

- [x] 所有 5 个 Step 的单元测试通过
- [x] 服务端和前端都能正常启动
- [x] WebSocket 连接稳定
- [x] 文件监听和增量读取正常
- [x] 进程扫描和状态机正常
- [x] 前端动画流畅

## 下一步计划

- Phase 2：支持 Codex 和 OpenClaw
- Phase 3：体验打磨（点击放大、布局切换、筛选等）

## 许可证

MIT

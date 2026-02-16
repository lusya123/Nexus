# Nexus Client

Nexus 前端基于 React + TypeScript + Vite，用于展示后端实时推送的会话与用量数据。

## 本地开发

```bash
# 在仓库根目录执行
npm install --prefix client
npm run dev --prefix client
```

默认开发地址：`http://localhost:5173`

## 与后端联调

推荐直接使用根目录控制脚本：

```bash
nexus dev-start
```

该命令会同时启动：

- 后端：`http://localhost:3000`
- 前端：`http://localhost:5173`

## 生产构建

```bash
npm run build --prefix client
```

构建产物输出到根目录 `dist/`，由后端静态托管。

## 前端关注点

- WebSocket 连接后处理 `init` 全量快照
- 处理增量事件：`session_init`、`message_add`、`state_change`、`session_remove`、`usage_totals`
- 按 `tool` 渲染工具配色与标签
- 会话状态动画与自动滚动体验

## 相关文档

- `README.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`

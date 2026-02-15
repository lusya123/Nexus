# Nexus Phase 1 - 验收指南

## 当前状态

✅ **Phase 1 核心功能已完成**

- 后端服务器：运行中 (http://localhost:3000)
- 前端应用：运行中 (http://localhost:5173)
- 监控 sessions：24 个活跃/空闲

## 快速启动

```bash
# 方式 1：使用启动脚本（推荐）
./start.sh

# 方式 2：手动启动
# 终端 1
node server.js

# 终端 2
cd client && npm run dev
```

## 验收测试清单

### ✅ 已完成的自动化测试

- [x] Step 1: 服务器基础骨架
- [x] Step 2: 文件发现与监听
- [x] Step 3: 进程扫描
- [x] Step 4: 状态机
- [x] Step 5: React 前端
- [x] WebSocket 连接稳定性
- [x] Session 自动发现
- [x] 增量读取正确性

### 📋 需要手动验证的功能

#### 1. 前端 UI 展示
**步骤**：
1. 打开浏览器访问 http://localhost:5173
2. 验证页面显示 session 卡片网格
3. 验证卡片显示：工具类型、项目名称、状态标签
4. 验证消息列表正确显示 user/assistant 对话

**预期结果**：
- 页面显示深色主题
- 卡片网格布局整齐
- 状态标签颜色正确（ACTIVE=绿色，IDLE=黄色）

#### 2. 实时消息更新
**步骤**：
1. 在当前 Claude Code session 中发送一条消息
2. 观察前端页面的 Nexus 卡片

**预期结果**：
- 新消息立即出现在卡片底部
- 消息列表自动滚动到底部
- 卡片状态变为 ACTIVE（绿色）

#### 3. ACTIVE 状态呼吸灯
**步骤**：
1. 找到状态为 ACTIVE 的 session 卡片
2. 观察卡片边框

**预期结果**：
- 边框有微弱的脉动效果（2 秒周期）
- 蓝色光晕从无到有再到无

#### 4. IDLE 状态转换
**步骤**：
1. 停止在 Claude Code 中发送消息
2. 等待 2 分钟
3. 观察卡片状态变化

**预期结果**：
- 2 分钟后状态从 ACTIVE 变为 IDLE
- 呼吸灯效果停止
- 状态标签变为黄色

#### 5. 新 Session 入场动画
**步骤**：
1. 打开一个新的 Claude Code session（不同项目）
2. 观察前端页面

**预期结果**：
- 新卡片从下方滑入
- 带有轻微过冲效果（弹一下）
- 动画持续约 0.4 秒

#### 6. 多 Session 错开入场
**步骤**：
1. 刷新浏览器页面
2. 观察多个 session 卡片的出现顺序

**预期结果**：
- 卡片依次出现，不是同时涌入
- 每个卡片间隔约 150ms
- 入场顺序稳定

#### 7. Session 退出和淡出
**步骤**：
1. 关闭一个 Claude Code session
2. 等待 15 秒（进程扫描周期）
3. 观察对应卡片

**预期结果**：
- 卡片开始缓慢淡出
- 淡出时间根据活跃时长计算（最少 3 秒）
- 淡出完成后卡片消失

#### 8. 空状态显示
**步骤**：
1. 关闭所有 Claude Code sessions
2. 等待所有卡片淡出
3. 观察页面

**预期结果**：
- 显示空状态提示
- 提示文字："No active Claude Code sessions"
- 副标题："Open a Claude Code session to see it here"

## 性能验证

### 当前性能指标
- 监控 sessions：24 个
- 内存占用：正常
- WebSocket 连接：稳定
- 文件监听：正常

### 压力测试（可选）
1. 同时打开 10+ 个 Claude Code sessions
2. 在多个 session 中快速发送消息
3. 验证页面响应流畅，无卡顿

## 已知限制

1. **只监控 Claude Code**：不支持 Codex 和 OpenClaw（符合 Phase 1 要求）
2. **本地单机**：不支持远程机器监控（符合 Phase 1 要求）
3. **无历史记录**：只显示实时数据（符合 Phase 1 要求）
4. **IDLE 检测延迟**：30 秒检查周期，实际转换可能延迟 0-30 秒

## 完成标准检查

- [x] 所有 5 个 Step 的单元测试通过
- [ ] 4 个全面测试场景全部通过（需要手动验证上述 8 项）
- [ ] E2E 自动化测试通过（需要 Puppeteer MCP server）
- [x] 无明显 bug 或性能问题
- [x] 代码可读性良好，关键逻辑有注释
- [x] 服务端和前端都能正常启动，无报错

## 下一步

1. **完成手动验证**：按照上述清单逐项验证
2. **E2E 测试**：使用 Puppeteer MCP server 执行自动化测试
3. **提交代码**：验证通过后提交到 Git
4. **进入 Phase 2**：添加 Codex 和 OpenClaw 支持

## 故障排查

### 前端无法连接 WebSocket
```bash
# 检查后端是否运行
curl http://localhost:3000

# 查看后端日志
tail -f /tmp/nexus-server.log
```

### 卡片不显示
```bash
# 检查是否有活跃的 Claude Code sessions
ps aux | grep claude | grep -v grep

# 查看服务器日志
tail -f /tmp/nexus-server.log | grep "Session"
```

### 消息不更新
```bash
# 检查文件监听是否正常
tail -f /tmp/nexus-server.log | grep "messages"
```

## 联系方式

如有问题，请查看：
- 完整规格文档：`doc/agent-arena-monitor-spec.md`
- 测试报告：`TEST_REPORT.md`
- README：`README.md`

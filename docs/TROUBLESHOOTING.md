# 故障排查

## WebSocket 连接问题

### 症状：浏览器显示 "disconnected"

**可能原因：**
- 后端服务未启动
- 端口被占用
- WebSocket 连接被防火墙阻止

**解决方法：**

1. 检查后端是否运行：
```bash
curl http://localhost:3000
```

2. 查看服务器日志：
```bash
tail -f /tmp/nexus-server.log
```

3. 检查端口占用：
```bash
lsof -i :3000
```

4. 重启服务：
```bash
pkill -f "node server.js"
./start.sh
```

5. 刷新浏览器页面

## 卡片不显示

### 症状：页面空白，没有 session 卡片

**可能原因：**
- 没有活跃的 Claude Code session
- 文件监听未启动
- 进程扫描失败

**解决方法：**

1. 确认有活跃的 Claude Code session：
```bash
ps aux | grep claude
```

2. 检查 JSONL 文件是否存在：
```bash
ls -la ~/.claude/projects/*/
```

3. 查看服务器日志中的 session 发现记录：
```bash
tail -f /tmp/nexus-server.log | grep -i session
```

4. 手动触发文件修改测试：
```bash
# 在任意 Claude Code session 中发送消息
# 观察浏览器是否有反应
```

## 消息不更新

### 症状：卡片显示但消息不实时更新

**可能原因：**
- 文件监听失败
- 增量读取偏移错误
- WebSocket 推送失败

**解决方法：**

1. 检查文件监听状态（查看日志）：
```bash
tail -f /tmp/nexus-server.log | grep -i watch
```

2. 重启服务清除文件偏移缓存：
```bash
pkill -f "node server.js"
node server.js
```

3. 检查 WebSocket 消息（浏览器控制台）：
```javascript
// 打开浏览器开发者工具 -> Network -> WS
// 查看 WebSocket 消息流
```

## 进程扫描失败

### 症状：Session 在进程退出后不消失

**可能原因：**
- `lsof` 命令权限不足
- 进程扫描间隔过长
- 路径编码错误

**解决方法：**

1. 测试 lsof 命令：
```bash
lsof -c claude -a -d cwd -F pcn 2>/dev/null
```

2. 检查进程扫描日志：
```bash
tail -f /tmp/nexus-server.log | grep -i process
```

3. 手动验证路径编码：
```bash
# 当前工作目录
pwd
# 应该映射到
# ~/.claude/projects/-Users-xxx-your-project/
```

## 性能问题

### 症状：页面卡顿或服务器 CPU 占用高

**可能原因：**
- 大量 session 同时活跃
- 大文件频繁修改
- 内存泄漏

**解决方法：**

1. 检查 session 数量：
```bash
tail -f /tmp/nexus-server.log | grep "Active sessions"
```

2. 检查文件大小：
```bash
find ~/.claude/projects -name "*.jsonl" -exec ls -lh {} \;
```

3. 监控内存使用：
```bash
ps aux | grep "node server.js"
```

4. 重启服务释放内存：
```bash
pkill -f "node server.js"
node server.js
```

## 前端构建问题

### 症状：`npm run dev` 失败

**可能原因：**
- 依赖未安装
- Node 版本不兼容
- 端口 5173 被占用

**解决方法：**

1. 重新安装依赖：
```bash
cd client
rm -rf node_modules package-lock.json
npm install
```

2. 检查 Node 版本（需要 >= 18）：
```bash
node --version
```

3. 检查端口占用：
```bash
lsof -i :5173
```

4. 使用其他端口：
```bash
npm run dev -- --port 5174
```

## 日志调试

### 启用详细日志

修改 `server.js` 中的日志级别：

```javascript
const DEBUG = true;  // 启用调试日志

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`;

  console.log(logMessage);
  fs.appendFileSync('/tmp/nexus-server.log', logMessage + '\n');
}
```

### 查看实时日志

```bash
# 所有日志
tail -f /tmp/nexus-server.log

# 只看错误
tail -f /tmp/nexus-server.log | grep -i error

# 只看 WebSocket
tail -f /tmp/nexus-server.log | grep -i websocket

# 只看 session 变化
tail -f /tmp/nexus-server.log | grep -i session
```

## 常见错误信息

### Error: ENOENT: no such file or directory

**原因**：JSONL 文件被删除或移动

**解决**：重启服务，清除文件监听缓存

### Error: EADDRINUSE

**原因**：端口 3000 已被占用

**解决**：
```bash
lsof -ti :3000 | xargs kill -9
```

### WebSocket connection failed

**原因**：后端未启动或端口不匹配

**解决**：检查 `client/src/App.tsx` 中的 WebSocket URL

## 获取帮助

如果以上方法都无法解决问题：

1. 查看完整日志：`cat /tmp/nexus-server.log`
2. 查看系统信息：`uname -a && node --version`
3. 提交 Issue：https://github.com/yourusername/nexus/issues

提交 Issue 时请包含：
- 操作系统和 Node 版本
- 完整错误日志
- 复现步骤
- 预期行为 vs 实际行为

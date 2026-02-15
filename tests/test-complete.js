import WebSocket from 'ws';

console.log('='.repeat(70));
console.log('Nexus Phase 1 - 完整功能测试');
console.log('='.repeat(70));
console.log('');

const ws = new WebSocket('ws://localhost:3000');

let sessionCount = 0;
let activeSessions = 0;
let messageReceived = false;
let stateChangeReceived = false;

const tests = {
  'WebSocket 连接': false,
  'Init 消息接收': false,
  'Session 发现': false,
  '活跃 Session 检测': false,
  '当前 Session 检测': false,
  '实时消息更新': false,
  '状态变化通知': false
};

function updateTest(name, passed) {
  tests[name] = passed;
  console.log(`${passed ? '✅' : '❌'} ${name}`);
}

ws.on('open', () => {
  updateTest('WebSocket 连接', true);
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'init') {
    updateTest('Init 消息接收', true);

    sessionCount = message.sessions.length;
    updateTest('Session 发现', sessionCount > 0);
    console.log(`   发现 ${sessionCount} 个 sessions`);

    activeSessions = message.sessions.filter(s => s.state === 'active' || s.state === 'idle').length;
    updateTest('活跃 Session 检测', activeSessions > 0);
    console.log(`   其中 ${activeSessions} 个活跃/空闲`);

    const currentSession = message.sessions.find(s => s.name.includes('Nexus'));
    updateTest('当前 Session 检测', !!currentSession);
    if (currentSession) {
      console.log(`   当前 Session: ${currentSession.sessionId.substring(0, 8)}...`);
      console.log(`   状态: ${currentSession.state}`);
      console.log(`   消息数: ${currentSession.messages.length}`);
    }
  } else if (message.type === 'message_add') {
    if (!messageReceived) {
      updateTest('实时消息更新', true);
      messageReceived = true;
      console.log(`   Session: ${message.sessionId.substring(0, 8)}...`);
      console.log(`   角色: ${message.message.role}`);
    }
  } else if (message.type === 'state_change') {
    if (!stateChangeReceived) {
      updateTest('状态变化通知', true);
      stateChangeReceived = true;
      console.log(`   Session: ${message.sessionId.substring(0, 8)}...`);
      console.log(`   新状态: ${message.state}`);
    }
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket 错误:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('');
  console.log('='.repeat(70));
  console.log('测试总结');
  console.log('='.repeat(70));

  const passed = Object.values(tests).filter(v => v).length;
  const total = Object.keys(tests).length;

  console.log(`通过: ${passed}/${total}`);
  console.log('');

  if (passed === total) {
    console.log('🎉 所有核心功能测试通过！');
    console.log('');
    console.log('手动验证步骤：');
    console.log('1. 打开浏览器访问 http://localhost:5173');
    console.log('2. 验证页面显示 session 卡片');
    console.log('3. 在当前 Claude Code 中发送消息，观察实时更新');
    console.log('4. 验证 ACTIVE 状态的呼吸灯效果');
    console.log('5. 等待 2 分钟不发送消息，观察状态变为 IDLE');
  } else {
    console.log('⚠️  部分测试未通过，请检查：');
    Object.entries(tests).forEach(([name, passed]) => {
      if (!passed) {
        console.log(`   - ${name}`);
      }
    });
  }

  ws.close();
  process.exit(passed === total ? 0 : 1);
}, 8000);

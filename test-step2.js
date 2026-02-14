import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

let receivedInit = false;
let sessionCount = 0;

ws.on('open', () => {
  console.log('✅ WebSocket connected');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'init') {
    receivedInit = true;
    sessionCount = message.sessions.length;
    console.log(`✅ Received init message with ${sessionCount} sessions`);

    if (sessionCount > 0) {
      console.log('\nSessions discovered:');
      message.sessions.forEach((session, i) => {
        console.log(`  ${i + 1}. ${session.name} (${session.sessionId.substring(0, 8)}...)`);
        console.log(`     Messages: ${session.messages.length}`);
      });
    }
  } else if (message.type === 'session_init') {
    console.log(`✅ New session: ${message.name} (${message.sessionId.substring(0, 8)}...)`);
    console.log(`   Messages: ${message.messages.length}`);
  } else if (message.type === 'message_add') {
    console.log(`✅ New message in session ${message.sessionId.substring(0, 8)}...`);
    console.log(`   Role: ${message.message.role}`);
    console.log(`   Content: ${message.message.content.substring(0, 50)}...`);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  if (!receivedInit) {
    console.error('❌ No init message received');
    process.exit(1);
  }

  console.log('\n✅ Step 2 PASSED: File discovery and monitoring working');
  console.log(`   - Discovered ${sessionCount} existing sessions`);
  console.log('   - WebSocket message protocol working');
  console.log('\nKeeping connection open to monitor for new messages...');
  console.log('(Send a message in Claude Code to test real-time updates)');
}, 3000);

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

const sessionStates = new Map();

ws.on('open', () => {
  console.log('✅ WebSocket connected\n');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'init') {
    console.log(`📊 Initial state: ${message.sessions.length} sessions`);
    message.sessions.forEach(session => {
      sessionStates.set(session.sessionId, session.state);
      if (session.state === 'active' || session.state === 'idle') {
        console.log(`  - ${session.name.substring(0, 30)} (${session.sessionId.substring(0, 8)}): ${session.state.toUpperCase()}`);
      }
    });
    console.log('');
  } else if (message.type === 'session_init') {
    console.log(`🆕 New session: ${message.name} (${message.sessionId.substring(0, 8)})`);
    console.log(`   State: ${message.state}`);
    sessionStates.set(message.sessionId, message.state);
  } else if (message.type === 'state_change') {
    const oldState = sessionStates.get(message.sessionId) || 'unknown';
    sessionStates.set(message.sessionId, message.state);
    console.log(`🔄 State change: ${message.sessionId.substring(0, 8)}`);
    console.log(`   ${oldState} → ${message.state.toUpperCase()}`);
  } else if (message.type === 'session_remove') {
    console.log(`❌ Session removed: ${message.sessionId.substring(0, 8)}`);
    sessionStates.delete(message.sessionId);
  } else if (message.type === 'message_add') {
    console.log(`💬 New message in ${message.sessionId.substring(0, 8)}: ${message.message.role}`);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

console.log('Monitoring session states...');
console.log('Send messages in Claude Code to test ACTIVE state');
console.log('Wait 2 minutes without activity to test IDLE state');
console.log('Close a Claude Code session to test COOLING → GONE\n');

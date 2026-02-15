#!/usr/bin/env node

import WebSocket from 'ws';

console.log('='.repeat(60));
console.log('Nexus Phase 1 - Final Verification');
console.log('='.repeat(60));
console.log('');

const ws = new WebSocket('ws://localhost:3000');

let testsPassed = 0;
let testsFailed = 0;

function pass(test) {
  console.log(`✅ ${test}`);
  testsPassed++;
}

function fail(test, reason) {
  console.log(`❌ ${test}`);
  if (reason) console.log(`   Reason: ${reason}`);
  testsFailed++;
}

ws.on('open', () => {
  pass('WebSocket connection established');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'init') {
    pass('Received init message');

    if (Array.isArray(message.sessions)) {
      pass(`Session discovery working (${message.sessions.length} sessions found)`);

      const activeSessions = message.sessions.filter(s => s.state === 'active' || s.state === 'idle');
      if (activeSessions.length > 0) {
        pass(`Active sessions detected (${activeSessions.length} active/idle)`);

        const currentSession = activeSessions.find(s => s.name.includes('Nexus'));
        if (currentSession) {
          pass('Current session (Nexus) detected');
          console.log(`   Session ID: ${currentSession.sessionId.substring(0, 8)}...`);
          console.log(`   Messages: ${currentSession.messages.length}`);
          console.log(`   State: ${currentSession.state}`);
        }
      }
    } else {
      fail('Init message missing sessions array');
    }
  } else if (message.type === 'message_add') {
    pass('Real-time message update received');
    console.log(`   Session: ${message.sessionId.substring(0, 8)}...`);
    console.log(`   Role: ${message.message.role}`);
  } else if (message.type === 'state_change') {
    pass('State change notification received');
    console.log(`   Session: ${message.sessionId.substring(0, 8)}...`);
    console.log(`   New state: ${message.state}`);
  }
});

ws.on('error', (error) => {
  fail('WebSocket connection', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('');
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log('');

  if (testsFailed === 0) {
    console.log('🎉 Phase 1 verification PASSED!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Open http://localhost:5173 in your browser');
    console.log('2. Verify the UI displays active sessions');
    console.log('3. Send a message in Claude Code to test real-time updates');
    console.log('4. Close a Claude Code session to test COOLING → GONE transition');
  } else {
    console.log('⚠️  Some tests failed. Please review the errors above.');
  }

  process.exit(testsFailed > 0 ? 1 : 0);
}, 5000);

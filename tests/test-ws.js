import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('✅ WebSocket connected successfully');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('✅ Received message:', message);

  if (message.type === 'init') {
    console.log('✅ Received init message with sessions:', message.sessions);
    console.log('\n✅ Step 1 PASSED: Server and WebSocket working correctly');
    process.exit(0);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  process.exit(1);
});

setTimeout(() => {
  console.error('❌ Timeout: No init message received');
  process.exit(1);
}, 5000);

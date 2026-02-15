import { WebSocketServer } from 'ws';

let wss = null;

// Initialize WebSocket server
export function initWebSocket(server, getSessionsFn) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send current state to newly connected client (dynamically fetch)
    const sessions = getSessionsFn();
    console.log(`Sending ${sessions.length} sessions to client`);

    // Debug: log first session to check format
    if (sessions.length > 0) {
      console.log('Sample session:', JSON.stringify(sessions[0], null, 2));
    }

    ws.send(JSON.stringify({
      type: 'init',
      sessions: sessions
    }));

    ws.on('close', () => {
      console.log('Client disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}

// Broadcast message to all connected clients
export function broadcast(message) {
  if (!wss) return;

  const data = JSON.stringify(message);
  const clientCount = wss.clients.size;

  console.log(`Broadcasting ${message.type} to ${clientCount} clients`);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

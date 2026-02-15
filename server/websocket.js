import { WebSocketServer } from 'ws';

let wss = null;

// Initialize WebSocket server
export function initWebSocket(server, initialSessions) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send current state to newly connected client
    ws.send(JSON.stringify({
      type: 'init',
      sessions: initialSessions
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
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

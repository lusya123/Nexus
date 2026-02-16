import { WebSocketServer } from 'ws';
import { wsLogger } from './utils/logger.js';

let wss = null;

// Initialize WebSocket server
export function initWebSocket(server, getSessionsFn, getUsageTotalsFn = null) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    // Send current state to newly connected client (dynamically fetch)
    const sessions = getSessionsFn();
    const usageTotals = getUsageTotalsFn ? getUsageTotalsFn() : null;

    wsLogger.wsConnection('connected', wss.clients.size);
    wsLogger.debug('Sending initial state to client', { sessionCount: sessions.length });

    ws.send(JSON.stringify({
      type: 'init',
      sessions,
      usageTotals
    }));

    ws.on('close', () => {
      wsLogger.wsConnection('disconnected', wss.clients.size);
    });

    ws.on('error', (error) => {
      wsLogger.error('WebSocket error', { error: error.message });
    });
  });

  return wss;
}

// Broadcast message to all connected clients
export function broadcast(message) {
  if (!wss) return;

  const data = JSON.stringify(message);
  const clientCount = wss.clients.size;

  wsLogger.debug('Broadcasting message', {
    type: message.type,
    clients: clientCount,
    sessionId: message.sessionId?.substring(0, 12)
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

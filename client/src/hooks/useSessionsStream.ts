import { useCallback, useEffect, useRef, useState } from 'react';
import { logger, sessionLogger, wsLogger } from '../utils/logger';
import type { ConnectionStatus, ServerMessage, Session, UsageTotalsPayload } from '../types/nexus';

function createEmptyUsageTotals(): UsageTotalsPayload {
  return {
    scope: 'all_history',
    totals: {
      runningAgents: 0,
      totalTokens: 0,
      totalCostUsd: 0
    },
    byTool: {},
    backfill: {
      status: 'done',
      scannedFiles: 0,
      totalFiles: 0
    },
    updatedAt: Date.now()
  };
}

export function useSessionsStream() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [usageTotals, setUsageTotals] = useState<UsageTotalsPayload>(createEmptyUsageTotals);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  const wsRef = useRef<WebSocket | null>(null);
  const wsTokenRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.type === 'init') {
      const incomingSessions = Array.isArray(message.sessions) ? message.sessions : [];
      const newSessions = new Map<string, Session>();
      incomingSessions.forEach((session) => {
        newSessions.set(session.sessionId, session);
      });
      setSessions(newSessions);

      if (message.usageTotals) {
        setUsageTotals(message.usageTotals);
      }

      logger.info('Initialized sessions', { count: incomingSessions.length });
      return;
    }

    if (message.type === 'session_init') {
      if (!message.sessionId || !message.tool || !message.name || !message.messages) return;

      const session: Session = {
        sessionId: message.sessionId,
        tool: message.tool,
        name: message.name,
        messages: message.messages,
        state: message.state || 'active'
      };

      sessionLogger.sessionInit(session.sessionId, session.tool, session.name, session.messages.length);
      setSessions((prev) => new Map(prev).set(session.sessionId, session));
      return;
    }

    if (message.type === 'message_add') {
      const sessionId = message.sessionId;
      const incomingMessage = message.message;
      if (!sessionId || !incomingMessage) return;

      setSessions((prev) => {
        const session = prev.get(sessionId);
        if (!session) return prev;

        const last = session.messages.length > 0 ? session.messages[session.messages.length - 1] : null;
        if (last && last.role === incomingMessage.role && last.content === incomingMessage.content) {
          return prev;
        }

        const newSessions = new Map(prev);
        sessionLogger.messageAdded(sessionId, incomingMessage.role, incomingMessage.content.length);
        newSessions.set(sessionId, {
          ...session,
          messages: [...session.messages, incomingMessage]
        });
        return newSessions;
      });
      return;
    }

    if (message.type === 'state_change') {
      const sessionId = message.sessionId;
      const nextState = message.state;
      if (!sessionId || !nextState) return;

      setSessions((prev) => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          sessionLogger.sessionStateChange(sessionId, session.state, nextState);
          session.state = nextState;
          newSessions.set(sessionId, { ...session });
        }
        return newSessions;
      });
      return;
    }

    if (message.type === 'session_remove') {
      if (!message.sessionId) return;

      sessionLogger.sessionRemoved(message.sessionId);
      setSessions((prev) => {
        const newSessions = new Map(prev);
        newSessions.delete(message.sessionId as string);
        return newSessions;
      });
      return;
    }

    if (message.type === 'usage_totals') {
      setUsageTotals({
        scope: message.scope || 'all_history',
        totals: {
          runningAgents: Number(message.totals?.runningAgents || 0),
          totalTokens: Number(message.totals?.totalTokens || 0),
          totalCostUsd: Number(message.totals?.totalCostUsd || 0)
        },
        byTool: message.byTool || {},
        backfill: {
          status: message.backfill?.status || 'done',
          scannedFiles: Number(message.backfill?.scannedFiles || 0),
          totalFiles: Number(message.backfill?.totalFiles || 0)
        },
        updatedAt: Number(message.updatedAt || Date.now())
      });
    }
  }, []);

  useEffect(() => {
    const connect = () => {
      const token = ++wsTokenRef.current;

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const ws = new WebSocket('ws://localhost:3000');
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsTokenRef.current !== token) return;
        wsLogger.wsConnected();
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        if (wsTokenRef.current !== token) return;
        const message = JSON.parse(event.data) as ServerMessage;
        wsLogger.wsMessage(message.type, { sessionId: message.sessionId?.substring(0, 12) });
        handleMessage(message);
      };

      ws.onclose = () => {
        if (wsTokenRef.current !== token) return;
        wsLogger.wsDisconnected(true);
        setConnectionStatus('disconnected');
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };

      ws.onerror = (error) => {
        if (wsTokenRef.current !== token) return;
        wsLogger.wsError(error);
      };
    };

    connect();

    return () => {
      wsTokenRef.current += 1;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [handleMessage]);

  return {
    sessions,
    usageTotals,
    connectionStatus
  };
}

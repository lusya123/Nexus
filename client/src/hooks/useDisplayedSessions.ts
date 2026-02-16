import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../types/nexus';

export function useDisplayedSessions(sessions: Map<string, Session>) {
  const [displayedSessionIds, setDisplayedSessionIds] = useState<Set<string>>(new Set());
  const queueRef = useRef<Session[]>([]);
  const previousSessionsRef = useRef<Map<string, Session>>(new Map());

  useEffect(() => {
    const previousSessions = previousSessionsRef.current;

    const sessionsToQueue: Session[] = [];
    sessions.forEach((session, sessionId) => {
      if (!previousSessions.has(sessionId) && (session.state === 'active' || session.state === 'idle')) {
        sessionsToQueue.push(session);
      }
    });

    if (sessionsToQueue.length > 0) {
      queueRef.current.push(...sessionsToQueue);
    }

    previousSessionsRef.current = new Map(sessions);
  }, [sessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (queueRef.current.length > 0) {
        const session = queueRef.current.shift();
        if (!session) return;
        setDisplayedSessionIds((prev) => {
          if (prev.has(session.sessionId)) return prev;
          return new Set([...prev, session.sessionId]);
        });
      }
    }, 150);

    return () => window.clearInterval(interval);
  }, []);

  const visibleSessions = useMemo(() => {
    return Array.from(sessions.values())
      .filter((session) => displayedSessionIds.has(session.sessionId))
      .sort((a, b) => {
        const stateOrder = { active: 0, idle: 1, cooling: 2, gone: 3 };
        const stateCompare = stateOrder[a.state] - stateOrder[b.state];
        if (stateCompare !== 0) return stateCompare;
        return a.name.localeCompare(b.name);
      });
  }, [displayedSessionIds, sessions]);

  return {
    visibleSessions
  };
}

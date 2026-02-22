import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../types/nexus';

type RenderableSession = Session & { state: 'active' | 'idle' };

function isRenderableSession(session: Session): session is RenderableSession {
  return session.state === 'active' || session.state === 'idle';
}

export function useDisplayedSessions(sessions: Map<string, Session>) {
  const [displayedSessionIds, setDisplayedSessionIds] = useState<Set<string>>(new Set());
  const queueRef = useRef<Session[]>([]);
  const previousSessionsRef = useRef<Map<string, Session>>(new Map());

  useEffect(() => {
    const previousSessions = previousSessionsRef.current;

    const renderableSessions: RenderableSession[] = [];
    const renderableIds = new Set<string>();

    sessions.forEach((session) => {
      if (!isRenderableSession(session)) return;
      renderableSessions.push(session);
      renderableIds.add(session.sessionId);
    });

    const sessionsToQueue: Session[] = [];
    renderableSessions.forEach((session) => {
      if (!previousSessions.has(session.sessionId)) {
        sessionsToQueue.push(session);
      }
    });
    sessionsToQueue.sort((a, b) => b.lastModified - a.lastModified);

    if (sessionsToQueue.length > 0) {
      queueRef.current.push(...sessionsToQueue);
    }

    queueRef.current = queueRef.current.filter((session) => renderableIds.has(session.sessionId));

    setDisplayedSessionIds((prev) => {
      let changed = false;
      const next = new Set<string>();

      prev.forEach((sessionId) => {
        if (renderableIds.has(sessionId)) {
          next.add(sessionId);
        } else {
          changed = true;
        }
      });

      return changed ? next : prev;
    });

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
      .filter(isRenderableSession)
      .filter((session) => displayedSessionIds.has(session.sessionId))
      .sort((a, b) => {
        const activityCompare = b.lastModified - a.lastModified;
        if (activityCompare !== 0) return activityCompare;

        const stateOrder = { active: 0, idle: 1 };
        const stateCompare = stateOrder[a.state] - stateOrder[b.state];
        if (stateCompare !== 0) return stateCompare;
        return a.name.localeCompare(b.name);
      });
  }, [displayedSessionIds, sessions]);

  return {
    visibleSessions
  };
}

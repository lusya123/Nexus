import { useEffect, useState, useRef } from 'react'
import './App.css'

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  sessionId: string;
  tool: string;
  name: string;
  messages: Message[];
  state: 'active' | 'idle' | 'cooling' | 'gone';
}

function App() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const entryQueueRef = useRef<Session[]>([]);
  const [displayedSessions, setDisplayedSessions] = useState<Set<string>>(new Set());

  // WebSocket connection
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket('ws://localhost:3000');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
        setTimeout(connect, 2000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Entry queue processor - stagger session entries by 150ms
  useEffect(() => {
    const interval = setInterval(() => {
      if (entryQueueRef.current.length > 0) {
        const session = entryQueueRef.current.shift()!;
        setDisplayedSessions(prev => new Set([...prev, session.sessionId]));
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  const handleMessage = (message: any) => {
    if (message.type === 'init') {
      const newSessions = new Map<string, Session>();
      message.sessions.forEach((session: Session) => {
        newSessions.set(session.sessionId, session);
      });
      setSessions(newSessions);

      entryQueueRef.current = message.sessions.filter(
        (s: Session) => s.state === 'active' || s.state === 'idle'
      );
    } else if (message.type === 'session_init') {
      const session: Session = {
        sessionId: message.sessionId,
        tool: message.tool,
        name: message.name,
        messages: message.messages,
        state: message.state || 'active'
      };

      setSessions(prev => new Map(prev).set(session.sessionId, session));
      entryQueueRef.current.push(session);
    } else if (message.type === 'message_add') {
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(message.sessionId);
        if (session) {
          newSessions.set(message.sessionId, {
            ...session,
            messages: [...session.messages, message.message]
          });
        }
        return newSessions;
      });
    } else if (message.type === 'state_change') {
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(message.sessionId);
        if (session) {
          session.state = message.state;
          newSessions.set(message.sessionId, { ...session });
        }
        return newSessions;
      });
    } else if (message.type === 'session_remove') {
      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.delete(message.sessionId);
        return newSessions;
      });
      setDisplayedSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(message.sessionId);
        return newSet;
      });
    }
  };

  const visibleSessions = Array.from(sessions.values())
    .filter(s => displayedSessions.has(s.sessionId))
    .sort((a, b) => {
      const stateOrder = { active: 0, idle: 1, cooling: 2, gone: 3 };
      const stateCompare = stateOrder[a.state] - stateOrder[b.state];
      if (stateCompare !== 0) return stateCompare;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="app">
      <header className="header">
        <h1>Nexus - Agent Arena Monitor</h1>
        <div className={`status status-${connectionStatus}`}>
          {connectionStatus === 'connected' ? '● Connected' : connectionStatus === 'connecting' ? '○ Connecting...' : '○ Disconnected'}
        </div>
      </header>

      <div className="sessions-grid">
        {visibleSessions.map(session => (
          <SessionCard key={session.sessionId} session={session} />
        ))}
      </div>

      {visibleSessions.length === 0 && connectionStatus === 'connected' && (
        <div className="empty-state">
          <p>No active Claude Code sessions</p>
          <p className="hint">Open a Claude Code session to see it here</p>
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isEntering, setIsEntering] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsEntering(false), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages.length]);

  const cardClass = `session-card ${isEntering ? 'card-entering' : ''} ${session.state === 'active' ? 'card-active' : ''} ${session.state === 'cooling' ? 'card-exiting' : ''}`;

  return (
    <div className={cardClass}>
      <div className="session-header">
        <span className="session-tool">Claude Code</span>
        <span className="session-name">{session.name}</span>
        <span className={`session-state state-${session.state}`}>{session.state.toUpperCase()}</span>
      </div>

      <div className="messages">
        {session.messages.map((msg, idx) => (
          <div key={idx} className={`message message-${msg.role}`}>
            <div className="message-role">{msg.role === 'user' ? 'User' : 'Assistant'}</div>
            <div className="message-content">{msg.content || '...'}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

export default App

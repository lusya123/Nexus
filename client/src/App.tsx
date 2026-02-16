import { useEffect, useState, useRef } from 'react'
import './App.css'
import { logger, wsLogger, sessionLogger } from './utils/logger'

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type MessageKind = 'text' | 'tool_call' | 'tool_output';
type ThemeMode = 'light' | 'dark';

interface Session {
  sessionId: string;
  tool: string;
  name: string;
  messages: Message[];
  state: 'active' | 'idle' | 'cooling' | 'gone';
}

interface UsageToolSummary {
  totalTokens: number;
  totalCostUsd: number;
  runningAgents: number;
}

interface UsageTotalsPayload {
  scope: 'all_history';
  totals: {
    runningAgents: number;
    totalTokens: number;
    totalCostUsd: number;
  };
  byTool: Record<string, UsageToolSummary>;
  backfill: {
    status: 'running' | 'done';
    scannedFiles: number;
    totalFiles: number;
  };
  updatedAt: number;
}

const TOOL_CONFIG: Record<string, { label: string; color: string; borderColor: string }> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#60a5fa',      // 蓝色
    borderColor: '#3b82f6'
  },
  'codex': {
    label: 'Codex',
    color: '#4ade80',      // 绿色
    borderColor: '#22c55e'
  },
  'openclaw': {
    label: 'OpenClaw',
    color: '#c084fc',      // 紫色
    borderColor: '#a855f7'
  }
};

const THEME_STORAGE_KEY = 'nexus-theme-mode';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore localStorage access failures and fallback to system preference.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value || 0)));
}

function formatUsd(value: number): string {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `$${n.toFixed(2)}`;
}

function roundForPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return 0;
  if (precision <= 0) return Math.round(value);
  return Number(value.toFixed(precision));
}

function getAnimationDuration(delta: number, precision: number): number {
  if (delta <= 0) return 0;
  if (precision > 0) {
    if (delta < 0.5) return 260;
    if (delta < 20) return 420;
    return 560;
  }

  if (delta < 10) return 260;
  if (delta < 1000) return 420;
  if (delta < 100000) return 620;
  return 820;
}

interface AnimatedMetricValueProps {
  value: number;
  format: (value: number) => string;
  precision?: number;
}

function AnimatedMetricValue({ value, format, precision = 0 }: AnimatedMetricValueProps) {
  const safeTarget = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [displayValue, setDisplayValue] = useState<number>(() => roundForPrecision(safeTarget, precision));
  const [isAnimating, setIsAnimating] = useState(false);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const rafRef = useRef<number | null>(null);
  const displayedRef = useRef<number>(roundForPrecision(safeTarget, precision));

  useEffect(() => {
    displayedRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    const target = roundForPrecision(safeTarget, precision);
    const from = displayedRef.current;
    const delta = Math.abs(target - from);
    const duration = getAnimationDuration(delta, precision);

    if (delta === 0 || duration === 0) {
      setIsAnimating(false);
      setDisplayValue(target);
      displayedRef.current = target;
      return;
    }

    setDirection(target >= from ? 'up' : 'down');
    setIsAnimating(true);

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextValue = roundForPrecision(from + (target - from) * eased, precision);

      displayedRef.current = nextValue;
      setDisplayValue(nextValue);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayedRef.current = target;
        setDisplayValue(target);
        setIsAnimating(false);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [safeTarget, precision]);

  return (
    <div
      className={`metric-value metric-value-animated ${isAnimating ? `is-animating is-${direction}` : ''}`}
    >
      {format(displayValue)}
    </div>
  );
}

function App() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [usageTotals, setUsageTotals] = useState<UsageTotalsPayload>(createEmptyUsageTotals);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const initial = getInitialTheme();
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', initial);
    }
    return initial;
  });
  const wsRef = useRef<WebSocket | null>(null);
  const wsTokenRef = useRef(0); // Monotonic token to ignore events from stale sockets.
  const reconnectTimerRef = useRef<number | null>(null);
  const entryQueueRef = useRef<Session[]>([]);
  const [displayedSessions, setDisplayedSessions] = useState<Set<string>>(new Set());
  const [showToolEvents, setShowToolEvents] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage failures.
    }
  }, [theme]);

  // WebSocket connection
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
        const message = JSON.parse(event.data);
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
      // Prevent reconnect attempts and ignore any late events from this socket instance.
      wsTokenRef.current++;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
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
      if (message.usageTotals) {
        setUsageTotals(message.usageTotals);
      }
      logger.info('Initialized sessions', { count: message.sessions.length });

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

      sessionLogger.sessionInit(session.sessionId, session.tool, session.name, session.messages.length);
      setSessions(prev => new Map(prev).set(session.sessionId, session));
      entryQueueRef.current.push(session);
    } else if (message.type === 'message_add') {
      setSessions(prev => {
        const session = prev.get(message.sessionId);
        if (!session) return prev;

        const last = session.messages.length > 0 ? session.messages[session.messages.length - 1] : null;
        // Guard against duplicated websocket deliveries (common in dev StrictMode / reconnect races).
        if (last && last.role === message.message.role && last.content === message.message.content) {
          return prev;
        }

        const newSessions = new Map(prev);
          sessionLogger.messageAdded(message.sessionId, message.message.role, message.message.content.length);
        newSessions.set(message.sessionId, {
          ...session,
          messages: [...session.messages, message.message]
        });
        return newSessions;
      });
    } else if (message.type === 'state_change') {
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(message.sessionId);
        if (session) {
          sessionLogger.sessionStateChange(message.sessionId, session.state, message.state);
          session.state = message.state;
          newSessions.set(message.sessionId, { ...session });
        }
        return newSessions;
      });
    } else if (message.type === 'session_remove') {
      sessionLogger.sessionRemoved(message.sessionId);
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
    } else if (message.type === 'usage_totals') {
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
        <div className="header-left">
          <img
            src="/logo-mark-white.png"
            alt="Nexus Logo"
            className={`header-logo ${theme === 'light' ? 'header-logo-light' : ''}`}
          />
          <h1>Nexus - Agent Arena Monitor</h1>
        </div>
        <div className="header-metrics">
          <div className="metric-card">
            <div className="metric-label">Running Agents</div>
            <AnimatedMetricValue
              value={usageTotals.totals.runningAgents}
              format={formatTokens}
            />
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Tokens</div>
            <AnimatedMetricValue
              value={usageTotals.totals.totalTokens}
              format={formatTokens}
            />
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Cost (USD)</div>
            <AnimatedMetricValue
              value={usageTotals.totals.totalCostUsd}
              format={formatUsd}
              precision={2}
            />
          </div>
          {usageTotals.backfill.status === 'running' && (
            <div className="metric-backfill">
              Backfilling history...
              {usageTotals.backfill.totalFiles > 0 ? ` (${usageTotals.backfill.scannedFiles}/${usageTotals.backfill.totalFiles})` : ''}
            </div>
          )}
        </div>
        <div className="header-controls">
          <label className="toggle">
            <input
              type="checkbox"
              checked={theme === 'dark'}
              onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
            />
            <span>Night mode</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showToolEvents}
              onChange={(e) => setShowToolEvents(e.target.checked)}
            />
            <span>Tool events</span>
          </label>
          <div className={`status status-${connectionStatus}`}>
            {connectionStatus === 'connected' ? '● Connected' : connectionStatus === 'connecting' ? '○ Connecting...' : '○ Disconnected'}
          </div>
        </div>
      </header>

      <div className="sessions-grid">
        {visibleSessions.map(session => (
          <SessionCard key={session.sessionId} session={session} showToolEvents={showToolEvents} />
        ))}
      </div>

      {visibleSessions.length === 0 && connectionStatus === 'connected' && (
        <div className="empty-state">
          <p>No active sessions</p>
          <p className="hint">Open a Claude Code, Codex, or OpenClaw session to see it here</p>
        </div>
      )}
    </div>
  );
}

function getMessageKind(content: string): MessageKind {
  const t = (content || '').trim();
  if (t.startsWith('[tool_call]')) return 'tool_call';
  if (t.startsWith('[tool_output]')) return 'tool_output';
  return 'text';
}

function parseToolLine(content: string): { kind: MessageKind; text: string; name?: string; callId?: string; exitCode?: number } {
  const t = (content || '').trim();
  const kind = getMessageKind(t);

  if (kind === 'tool_call') {
    const m = t.match(/^\[tool_call\]\s+([^\s(]+)\s*(.*)$/);
    const name = m?.[1];
    const rest = (m?.[2] || '').trim();
    const callIdMatch = rest.match(/\(([^)]+)\)/);
    const callId = callIdMatch ? callIdMatch[1] : undefined;
    return { kind, text: t.replace(/^\[tool_call\]\s*/, '').trim(), name, callId };
  }

  if (kind === 'tool_output') {
    const exitMatch = t.match(/\bexit=(\d+)\b/);
    const exitCode = exitMatch ? Number(exitMatch[1]) : undefined;
    const callIdMatch = t.match(/^\[tool_output\]\s+([^\s]+)\s+/);
    const callId = callIdMatch ? callIdMatch[1] : undefined;
    return { kind, text: t.replace(/^\[tool_output\]\s*/, '').trim(), callId, exitCode };
  }

  return { kind: 'text', text: t };
}

function ToolEvent({ content }: { content: string }) {
  const info = parseToolLine(content);
  const isError = typeof info.exitCode === 'number' ? info.exitCode !== 0 : false;
  const badgeClass = `tool-badge ${info.kind === 'tool_call' ? 'tool-badge-call' : isError ? 'tool-badge-err' : 'tool-badge-ok'}`;
  const badgeText = info.kind === 'tool_call' ? 'CALL' : typeof info.exitCode === 'number' ? `EXIT ${info.exitCode}` : 'OUT';

  return (
    <div className={`message message-tool ${info.kind === 'tool_call' ? 'message-toolcall' : 'message-tooloutput'}`}>
      <div className="tool-row">
        <span className={badgeClass}>{badgeText}</span>
        <div className="tool-text">{info.text}</div>
      </div>
    </div>
  );
}

function SessionCard({ session, showToolEvents }: { session: Session; showToolEvents: boolean }) {
  const toolConfig = TOOL_CONFIG[session.tool] || TOOL_CONFIG['claude-code'];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isEntering, setIsEntering] = useState(true);

  const visibleMessages = session.messages
    .filter(m => (m.content || '').trim().length > 0)
    .filter(m => showToolEvents || getMessageKind(m.content) === 'text');

  const hiddenToolEventCount = showToolEvents
    ? 0
    : session.messages.filter(m => (m.content || '').trim().length > 0 && getMessageKind(m.content) !== 'text').length;

  useEffect(() => {
    const timer = setTimeout(() => setIsEntering(false), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length]);

  const cardClass = `session-card ${isEntering ? 'card-entering' : ''} ${session.state === 'active' ? 'card-active' : ''} ${session.state === 'cooling' ? 'card-exiting' : ''}`;

  return (
    <div
      className={cardClass}
      style={{
        borderColor: session.state === 'active' ? toolConfig.borderColor : undefined
      }}
    >
      <div className="session-header">
        <span className="session-tool" style={{ color: toolConfig.color }}>
          {toolConfig.label}
        </span>
        <span className="session-name">{session.name}</span>
        <span className={`session-state state-${session.state}`}>{session.state.toUpperCase()}</span>
      </div>

      <div className="messages">
        {visibleMessages.map((msg, idx) => (
          getMessageKind(msg.content) === 'text' ? (
            <div key={idx} className={`message message-${msg.role}`}>
              <div className="message-role">{msg.role === 'user' ? 'User' : 'Assistant'}</div>
              <div className="message-content">{msg.content}</div>
            </div>
          ) : (
            <ToolEvent key={idx} content={msg.content} />
          )
        ))}
        {visibleMessages.length === 0 && hiddenToolEventCount > 0 && (
          <div className="message message-assistant">
            <div className="message-role">Info</div>
            <div className="message-content">
              No text messages yet. Enable Tool events to view {hiddenToolEventCount} tool events.
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

export default App

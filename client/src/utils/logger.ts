// Structured logging utility for Nexus client
// Provides consistent, detailed logs for AI debugging

interface LogMeta {
  [key: string]: unknown;
}

// `erasableSyntaxOnly` forbids enums; keep levels as const data.
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
} as const;

type LevelName = keyof typeof LEVELS;
type Level = (typeof LEVELS)[LevelName];

const LEVEL_NAME_BY_VALUE = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

class Logger {
  private context: string;
  private minLevel: Level;

  constructor(context: string = 'Client') {
    this.context = context;
    this.minLevel = this.getMinLevel();
  }

  private getMinLevel(): Level {
    // In case this is ever evaluated outside a browser context.
    if (typeof window === 'undefined') return LEVELS.INFO;
    const raw = window.localStorage.getItem('nexus_log_level') || 'INFO';
    const key = (raw.toUpperCase() as LevelName);
    return LEVELS[key] ?? LEVELS.INFO;
  }

  private shouldLog(level: Level): boolean {
    return level >= this.minLevel;
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(11, 23);
  }

  private formatMessage(level: Level, message: string, meta?: LogMeta): string {
    const timestamp = this.formatTimestamp();
    const levelName = (LEVEL_NAME_BY_VALUE[level] || 'INFO').padEnd(5);

    let output = `[${timestamp}] ${levelName} [${this.context}] ${message}`;

    if (meta && Object.keys(meta).length > 0) {
      const metaStr = Object.entries(meta)
        .map(([key, value]) => {
          if (value === null || value === undefined) return null;
          const displayValue = typeof value === 'string' && value.length > 100
            ? value.substring(0, 100) + '...'
            : JSON.stringify(value);
          return `${key}=${displayValue}`;
        })
        .filter(Boolean)
        .join(' ');
      if (metaStr) output += ` | ${metaStr}`;
    }

    return output;
  }

  debug(message: string, meta?: LogMeta): void {
    if (!this.shouldLog(LEVELS.DEBUG)) return;
    console.log(this.formatMessage(LEVELS.DEBUG, message, meta));
  }

  info(message: string, meta?: LogMeta): void {
    if (!this.shouldLog(LEVELS.INFO)) return;
    console.log(this.formatMessage(LEVELS.INFO, message, meta));
  }

  warn(message: string, meta?: LogMeta): void {
    if (!this.shouldLog(LEVELS.WARN)) return;
    console.warn(this.formatMessage(LEVELS.WARN, message, meta));
  }

  error(message: string, meta?: LogMeta): void {
    if (!this.shouldLog(LEVELS.ERROR)) return;
    console.error(this.formatMessage(LEVELS.ERROR, message, meta));
  }

  // Specialized logging methods
  wsConnected(): void {
    this.info('WebSocket connected');
  }

  wsDisconnected(willReconnect: boolean = true): void {
    this.warn('WebSocket disconnected', { willReconnect });
  }

  wsError(error: Event): void {
    this.error('WebSocket error', { error: error.type });
  }

  wsMessage(type: string, data?: LogMeta): void {
    this.debug('WebSocket message received', { type, ...data });
  }

  sessionInit(sessionId: string, tool: string, name: string, messageCount: number): void {
    this.info('Session initialized', {
      sessionId: sessionId.substring(0, 12),
      tool,
      name,
      messages: messageCount
    });
  }

  sessionStateChange(sessionId: string, oldState: string, newState: string): void {
    this.info('Session state changed', {
      sessionId: sessionId.substring(0, 12),
      transition: `${oldState} → ${newState}`
    });
  }

  sessionRemoved(sessionId: string): void {
    this.info('Session removed', {
      sessionId: sessionId.substring(0, 12)
    });
  }

  messageAdded(sessionId: string, role: string, contentLength: number): void {
    this.debug('Message added', {
      sessionId: sessionId.substring(0, 12),
      role,
      length: contentLength
    });
  }
}

// Create default logger instances
export const logger = new Logger('App');
export const wsLogger = new Logger('WebSocket');
export const sessionLogger = new Logger('Session');

// Export Logger class for custom instances
export { Logger };

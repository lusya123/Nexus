// Structured logging utility for Nexus server
// Provides consistent, detailed logs for AI debugging

const LOG_LEVELS = {
  DEBUG: { name: 'DEBUG', color: '\x1b[36m', priority: 0 },
  INFO: { name: 'INFO', color: '\x1b[32m', priority: 1 },
  WARN: { name: 'WARN', color: '\x1b[33m', priority: 2 },
  ERROR: { name: 'ERROR', color: '\x1b[31m', priority: 3 }
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

class Logger {
  constructor(context = 'Server') {
    this.context = context;
    this.minLevel = process.env.LOG_LEVEL || 'INFO';
  }

  shouldLog(level) {
    const minPriority = LOG_LEVELS[this.minLevel]?.priority ?? 1;
    return LOG_LEVELS[level].priority >= minPriority;
  }

  formatTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 23);
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = this.formatTimestamp();
    const levelInfo = LOG_LEVELS[level];
    const levelStr = `${levelInfo.color}${levelInfo.name.padEnd(5)}${RESET}`;
    const contextStr = `${DIM}[${this.context}]${RESET}`;

    let output = `${DIM}${timestamp}${RESET} ${levelStr} ${contextStr} ${message}`;

    if (Object.keys(meta).length > 0) {
      const metaStr = Object.entries(meta)
        .map(([key, value]) => {
          if (value === null || value === undefined) return null;
          const displayValue = typeof value === 'string' && value.length > 100
            ? value.substring(0, 100) + '...'
            : value;
          return `${DIM}${key}=${RESET}${displayValue}`;
        })
        .filter(Boolean)
        .join(' ');
      if (metaStr) output += ` ${DIM}|${RESET} ${metaStr}`;
    }

    return output;
  }

  debug(message, meta) {
    if (!this.shouldLog('DEBUG')) return;
    console.log(this.formatMessage('DEBUG', message, meta));
  }

  info(message, meta) {
    if (!this.shouldLog('INFO')) return;
    console.log(this.formatMessage('INFO', message, meta));
  }

  warn(message, meta) {
    if (!this.shouldLog('WARN')) return;
    console.warn(this.formatMessage('WARN', message, meta));
  }

  error(message, meta) {
    if (!this.shouldLog('ERROR')) return;
    console.error(this.formatMessage('ERROR', message, meta));
  }

  // Specialized logging methods for common operations
  sessionDiscovered(sessionId, projectName, toolName, filePath) {
    this.info('Session discovered', {
      sessionId: sessionId.substring(0, 12),
      project: projectName,
      tool: toolName,
      path: filePath
    });
  }

  sessionStateChange(sessionId, oldState, newState, meta = {}) {
    this.info('Session state transition', {
      sessionId: sessionId.substring(0, 12),
      transition: `${oldState} → ${newState}`,
      ...meta
    });
  }

  sessionMessages(sessionId, toolName, count) {
    this.debug('Messages added to session', {
      sessionId: sessionId.substring(0, 12),
      tool: toolName,
      count
    });
  }

  sessionRemoved(sessionId) {
    this.info('Session removed', {
      sessionId: sessionId.substring(0, 12)
    });
  }

  serverStarted(port, sessionCount) {
    this.info(`Nexus server started on http://localhost:${port}`, {
      activeSessions: sessionCount
    });
  }

  processCheck(claudeCount, codexCount, openclawCount) {
    this.debug('Process check completed', {
      claude: claudeCount,
      codex: codexCount,
      openclaw: openclawCount
    });
  }

  fileWatch(action, path, tool) {
    this.debug(`File ${action}`, {
      path,
      tool
    });
  }

  wsConnection(action, clientCount) {
    this.info(`WebSocket ${action}`, {
      clients: clientCount
    });
  }
}

// Create default logger instances
export const logger = new Logger('Nexus');
export const sessionLogger = new Logger('Session');
export const fileLogger = new Logger('FileMonitor');
export const processLogger = new Logger('ProcessMonitor');
export const wsLogger = new Logger('WebSocket');

// Export Logger class for custom instances
export { Logger };

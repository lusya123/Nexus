// Store active sessions
const sessions = new Map();

import fs from 'fs';
import { sessionLogger } from './utils/logger.js';

// Codex doesn't expose reliable per-session process markers; use file mtime as an activity signal.
const CODEX_ACTIVE_MTIME_GRACE_MS = 5 * 60 * 1000; // 5 minutes
// Claude: prefer lsof-mapped active files, but keep recently-updated sessions visible after the process exits.
const CLAUDE_RECENT_MTIME_GRACE_MS = 30 * 60 * 1000; // 30 minutes

function isRecentlyModified(filePath, graceMs) {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) <= graceMs;
  } catch {
    return false;
  }
}

// Clean session object for JSON serialization (remove non-serializable fields)
export function cleanSession(session) {
  const { cooldownTimer, ...cleanedSession } = session;
  return cleanedSession;
}

// Get all sessions
export function getAllSessions() {
  return Array.from(sessions.values()).map(cleanSession);
}

// Get session by ID
export function getSession(sessionId) {
  return sessions.get(sessionId);
}

// Create new session
export function createSession(sessionId, tool, name, filePath, projectDir) {
  const now = Date.now();
  const session = {
    sessionId,
    tool,
    name,
    messages: [],
    filePath,
    projectDir,
    state: 'active',
    startTime: now,
    lastModified: now,
    endTime: null,
    cooldownTimer: null
  };

  sessions.set(sessionId, session);
  return session;
}

// Add messages to session
export function addMessages(sessionId, messages) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.messages.push(...messages);
  session.lastModified = Date.now();
  return true;
}

// Calculate cooldown duration based on active time
function getCooldownDuration(session) {
  const activeSeconds = (session.endTime - session.startTime) / 1000;
  // 10% of active time, clamped between 3 seconds and 5 minutes
  return Math.max(3, Math.min(300, activeSeconds * 0.1)) * 1000;
}

// Set session state
export function setSessionState(sessionId, newState, onStateChange) {
  const session = sessions.get(sessionId);
  if (!session || session.state === newState) {
    return;
  }

  const oldState = session.state;
  session.state = newState;

  // Handle state-specific logic
  if (newState === 'cooling') {
    session.endTime = Date.now();
    const cooldownDuration = getCooldownDuration(session);

    sessionLogger.sessionStateChange(sessionId, oldState, newState, {
      cooldownSeconds: (cooldownDuration / 1000).toFixed(1)
    });

    // Set timer to remove session after cooldown
    session.cooldownTimer = setTimeout(() => {
      setSessionState(sessionId, 'gone', onStateChange);
    }, cooldownDuration);
  } else if (newState === 'gone') {
    // Remove session
    if (session.cooldownTimer) {
      clearTimeout(session.cooldownTimer);
    }
    sessions.delete(sessionId);

    if (onStateChange) {
      onStateChange(sessionId, newState, { removed: true });
    }

    sessionLogger.sessionRemoved(sessionId);
    return;
  } else {
    sessionLogger.sessionStateChange(sessionId, oldState, newState);
  }

  // Notify state change
  if (onStateChange) {
    onStateChange(sessionId, newState, { removed: false });
  }
}

// Check for IDLE sessions (no modification for 2 minutes)
export function checkIdleSessions(onStateChange) {
  const now = Date.now();
  const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes

  for (const [sessionId, session] of sessions.entries()) {
    if (session.state === 'active') {
      const timeSinceModified = now - session.lastModified;
      if (timeSinceModified > IDLE_THRESHOLD) {
        setSessionState(sessionId, 'idle', onStateChange);
      }
    }
  }
}

// Check which sessions have their processes still running
export function checkSessionProcesses(activeProjectDirs, onStateChange, options = {}) {
  const activeOpenClawFiles = options.activeOpenClawFiles || null;
  const activeClaudeFiles = options.activeClaudeFiles || null;

  for (const [sessionId, session] of sessions.entries()) {
    const hasProcess = (session.tool === 'openclaw' && activeOpenClawFiles)
      ? activeOpenClawFiles.has(session.filePath)
      : (session.tool === 'claude-code' && activeClaudeFiles)
        ? (activeClaudeFiles.has(session.filePath) || isRecentlyModified(session.filePath, CLAUDE_RECENT_MTIME_GRACE_MS))
      : (session.tool === 'codex')
        ? isRecentlyModified(session.filePath, CODEX_ACTIVE_MTIME_GRACE_MS)
        : activeProjectDirs.has(session.projectDir);

    if (!hasProcess && (session.state === 'active' || session.state === 'idle')) {
      // Process exited, move to COOLING
      setSessionState(sessionId, 'cooling', onStateChange);
    }
  }
}

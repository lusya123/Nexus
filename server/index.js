import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import modules
import { initWebSocket, broadcast } from './websocket.js';
import * as ClaudeCodeParser from './parsers/claude-code.js';
import * as CodexParser from './parsers/codex.js';
import * as OpenClawParser from './parsers/openclaw.js';
import * as FileMonitor from './monitors/file-monitor.js';
import * as ProcessMonitor from './monitors/process-monitor.js';
import * as SessionManager from './session-manager.js';
import { logger, sessionLogger, fileLogger, processLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Create HTTP server
const server = createServer(app);

// Track active project directories
let activeProjectDirs = new Set();

// Heuristics for "currently running" sessions:
// - Claude Code: prefer `lsof`-discovered open `.jsonl` files per PID. If unavailable, fall back to "newest 1 JSONL per active dir".
// - OpenClaw: treat `.jsonl.lock` files as authoritative "active session" markers.
const CLAUDE_RECENT_MAX_FILES_PER_DIR = 5;
const CLAUDE_RECENT_MTIME_GRACE_MS = 30 * 60 * 1000; // keep recently-updated sessions visible after exit
const CODEX_DISCOVERY_MAX_FILES = 12;
const CODEX_DISCOVERY_MTIME_GRACE_MS = 30 * 60 * 1000; // periodically discover recently-updated Codex sessions

// Process a JSONL file
function processFile(filePath, parser, toolName) {
  // Normalize early so all downstream maps/sets compare correctly.
  filePath = path.resolve(filePath);

  const sessionId = parser.getSessionId(filePath);
  const projectDir = path.resolve(path.dirname(filePath));
  const projectName = parser.getProjectName(path.dirname(filePath));

  // Check if this is a new session
  if (!SessionManager.getSession(sessionId)) {
    const session = SessionManager.createSession(
      sessionId,
      toolName,
      projectName,
      filePath,
      projectDir
    );

    // Read all existing messages
    const parsed = FileMonitor.readIncremental(filePath, parser.parseMessage);
    const appended = SessionManager.addMessages(sessionId, parsed) || [];

    sessionLogger.sessionDiscovered(sessionId, projectName, toolName, filePath);

    // Broadcast new session
    broadcast({
      type: 'session_init',
      sessionId,
      tool: toolName,
      name: projectName,
      messages: appended,
      state: 'active'
    });
  } else {
    // Read incremental messages
    const parsed = FileMonitor.readIncremental(filePath, parser.parseMessage);

    if (parsed.length > 0) {
      const appended = SessionManager.addMessages(sessionId, parsed) || [];

      // Set to ACTIVE if it was IDLE (even if the new content was a deduped retry).
      const session = SessionManager.getSession(sessionId);
      if (session.state === 'idle') {
        SessionManager.setSessionState(sessionId, 'active', handleStateChange);
      }

      if (appended.length > 0) {
        // Broadcast each new message
        appended.forEach(message => {
          broadcast({
            type: 'message_add',
            sessionId,
            message
          });
        });
      }

      sessionLogger.sessionMessages(sessionId, toolName, appended.length);
    }
  }
}

function safeIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isUnderDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function loadClaudeSessionsForProjectDir(projectDir, activeClaudeFiles) {
  const dir = path.resolve(projectDir);
  const activeInDir = [];
  if (activeClaudeFiles && activeClaudeFiles.size > 0) {
    for (const filePath of activeClaudeFiles) {
      if (path.resolve(path.dirname(filePath)) === dir) activeInDir.push(filePath);
    }
  }

  if (activeInDir.length > 0) {
    for (const filePath of activeInDir) {
      processFile(filePath, ClaudeCodeParser, 'claude-code');
    }
    return;
  }

  // Fallback: load a few recently-updated JSONLs so "just finished" sessions still show up,
  // but avoid loading every historical session in the directory.
  const recent = FileMonitor.getRecentSessionFiles(projectDir, {
    maxAgeMs: CLAUDE_RECENT_MTIME_GRACE_MS,
    maxCount: CLAUDE_RECENT_MAX_FILES_PER_DIR
  });
  if (recent.length > 0) {
    for (const filePath of recent) processFile(filePath, ClaudeCodeParser, 'claude-code');
    return;
  }

  // Last resort: show the newest single JSONL.
  const mostRecent = FileMonitor.getMostRecentSession(projectDir);
  if (mostRecent) processFile(mostRecent, ClaudeCodeParser, 'claude-code');
}

function loadOpenClawLockedSessionsInDir(sessionsDir, lockedSessionFiles) {
  for (const filePath of lockedSessionFiles) {
    if (path.resolve(path.dirname(filePath)) !== path.resolve(sessionsDir)) continue;
    processFile(filePath, OpenClawParser, 'openclaw');
  }
}

function discoverRecentCodexFiles() {
  const now = Date.now();
  const candidates = [];

  FileMonitor.scanCodexSessions(
    CodexParser.CODEX_SESSIONS_DIR,
    (filePath) => {
      const resolved = path.resolve(filePath);
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return;
        if ((now - stat.mtimeMs) > CODEX_DISCOVERY_MTIME_GRACE_MS) return;
        candidates.push({ filePath: resolved, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore
      }
    },
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, CodexParser, 'codex')
    ),
    { silent: true }
  );

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.slice(0, CODEX_DISCOVERY_MAX_FILES).map(i => i.filePath);
}

// Handle state changes
function handleStateChange(sessionId, newState, options) {
  if (options.removed) {
    broadcast({
      type: 'session_remove',
      sessionId
    });
  } else {
    broadcast({
      type: 'state_change',
      sessionId,
      state: newState
    });
  }
}

// Check which sessions have their processes still running
async function checkProcesses() {
  const prevActive = activeProjectDirs;

  // Claude Code: map PID -> project dir under `~/.claude/projects/<encoded-cwd>`.
  const claudeProcesses = await ProcessMonitor.scanProcesses(
    'claude',
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    ClaudeCodeParser.encodeCwd
  );
  const claudeActiveDirs = new Set(
    Array.from(claudeProcesses.values()).map(p => p.projectDir).filter(safeIsDir)
  );
  const claudeActiveFilesFromLsof = new Set(
    Array.from(claudeProcesses.values())
      .flatMap(p => (p && Array.isArray(p.sessionFiles)) ? p.sessionFiles : [])
      .map(p => path.resolve(p))
  );
  const claudeActiveFiles = new Set();
  for (const dir of claudeActiveDirs) {
    const dirAbs = path.resolve(dir);
    const lsofInDir = Array.from(claudeActiveFilesFromLsof).filter(p => path.resolve(path.dirname(p)) === dirAbs);
    const recentInDir = FileMonitor.getRecentSessionFiles(dirAbs, {
      maxAgeMs: CLAUDE_RECENT_MTIME_GRACE_MS,
      maxCount: CLAUDE_RECENT_MAX_FILES_PER_DIR
    }).map(p => path.resolve(p));

    const combined = new Set([...lsofInDir, ...recentInDir]);
    if (combined.size === 0) {
      // If we can't map to a file at all, still show something for the active dir.
      const mostRecent = FileMonitor.getMostRecentSession(dirAbs);
      if (mostRecent) claudeActiveFiles.add(path.resolve(mostRecent));
      continue;
    }

    // Keep the set small and biased toward newest files.
    const ranked = Array.from(combined).map(p => {
      try {
        const stat = fs.statSync(p);
        return { p, mtimeMs: stat.mtimeMs };
      } catch {
        return { p, mtimeMs: 0 };
      }
    });
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);
    ranked.slice(0, CLAUDE_RECENT_MAX_FILES_PER_DIR).forEach(({ p }) => claudeActiveFiles.add(p));
  }

  // Codex stores sessions under ~/.codex/sessions/YYYY/MM/DD, not per-CWD folders.
  // Use sessions root as the process-mapping base and rely on lsof-open JSONL files.
  const codexProcesses = await ProcessMonitor.scanProcesses(
    'codex',
    CodexParser.CODEX_SESSIONS_DIR,
    () => ''
  );
  const codexActiveFiles = new Set(
    Array.from(codexProcesses.values())
      .flatMap(p => (p && Array.isArray(p.sessionFiles)) ? p.sessionFiles : [])
      .map(p => path.resolve(p))
  );
  const recentCodexFiles = discoverRecentCodexFiles();
  recentCodexFiles.forEach(p => codexActiveFiles.add(p));
  const codexActiveDirs = new Set(
    Array.from(codexActiveFiles).map(p => path.resolve(path.dirname(p))).filter(safeIsDir)
  );

  // OpenClaw: use `.jsonl.lock` markers to identify currently active sessions.
  const openclawLocked = FileMonitor.findOpenClawLockedSessions(OpenClawParser.OPENCLAW_AGENTS_DIR);
  const openclawActiveDirs = new Set(Array.from(openclawLocked.activeDirs).filter(safeIsDir));
  const openclawActiveFiles = new Set(openclawLocked.sessionFiles.map(p => path.resolve(p)));

  const nextActive = new Set([...claudeActiveDirs, ...codexActiveDirs, ...openclawActiveDirs]);
  activeProjectDirs = nextActive;

  // Load sessions for newly discovered active dirs (this is what makes "all running sessions" show up
  // even if the directory didn't exist when the server started).
  const addedDirs = new Set();
  for (const dir of nextActive) {
    if (!prevActive.has(dir)) addedDirs.add(dir);
  }

  for (const dir of addedDirs) {
    if (isUnderDir(dir, ClaudeCodeParser.CLAUDE_PROJECTS_DIR)) {
      fileLogger.fileWatch('watching', dir, 'claude-code');
      FileMonitor.watchProjectDir(dir, (filePath) => processFile(filePath, ClaudeCodeParser, 'claude-code'));
      loadClaudeSessionsForProjectDir(dir, claudeActiveFiles);
      continue;
    }

    if (isUnderDir(dir, OpenClawParser.OPENCLAW_AGENTS_DIR)) {
      // This should be `.../agents/<agent>/sessions`
      fileLogger.fileWatch('watching', dir, 'openclaw');
      FileMonitor.watchProjectDir(dir, (filePath) => processFile(filePath, OpenClawParser, 'openclaw'));
      loadOpenClawLockedSessionsInDir(dir, openclawLocked.sessionFiles);
      continue;
    }
  }

  processLogger.processCheck(claudeActiveDirs.size, codexActiveDirs.size, openclawActiveDirs.size);

  // Ensure active Codex sessions are loaded even when a new YYYY/MM/DD directory appears
  // after startup (directory watchers are attached only to known day folders).
  for (const filePath of codexActiveFiles) {
    processFile(filePath, CodexParser, 'codex');
  }

  // Also ensure currently locked OpenClaw sessions are loaded at least once (covers the case where
  // a sessions dir was already known but locks appeared before we started watching it).
  for (const filePath of openclawLocked.sessionFiles) {
    processFile(filePath, OpenClawParser, 'openclaw');
  }

  // Check all sessions against the combined active directories
  SessionManager.checkSessionProcesses(nextActive, handleStateChange, {
    activeOpenClawFiles: openclawActiveFiles,
    activeClaudeFiles: claudeActiveFiles,
    activeCodexFiles: codexActiveFiles
  });
}

// Start server
server.listen(PORT, async () => {
  logger.serverStarted(PORT, 0);

  // Initialize WebSocket
  initWebSocket(server, () => SessionManager.getAllSessions());

  // Step 1: Scan processes FIRST to get active project directories
  await checkProcesses();

  const sessionCount = SessionManager.getAllSessions().length;
  logger.info('Initial session load completed', { sessions: sessionCount });

  // Step 2: Watch all project directories for new files
  // Scan all Claude Code projects
  FileMonitor.scanAllProjects(
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    () => {}, // Don't process files during scan
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, ClaudeCodeParser, 'claude-code')
    )
  );

  // Scan Codex sessions
  FileMonitor.scanCodexSessions(
    CodexParser.CODEX_SESSIONS_DIR,
    () => {}, // Don't process files during scan
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, CodexParser, 'codex')
    )
  );

  // Scan OpenClaw agents
  FileMonitor.scanOpenClawAgents(
    OpenClawParser.OPENCLAW_AGENTS_DIR,
    () => {}, // Don't process files during scan
    (projectDir) => FileMonitor.watchProjectDir(projectDir, (filePath) =>
      processFile(filePath, OpenClawParser, 'openclaw')
    )
  );

  // Scan processes every 15 seconds
  setInterval(checkProcesses, 15000);

  // Check for IDLE sessions every 30 seconds
  setInterval(() => {
    SessionManager.checkIdleSessions(handleStateChange);
  }, 30000);
});

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
import * as UsageManager from './usage/usage-manager.js';
import * as PricingService from './usage/pricing-service.js';
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
// - OpenClaw: lock files can be short-lived, so combine `.jsonl.lock` markers with recent file mtime.
const CLAUDE_RECENT_MAX_FILES_PER_DIR = 5;
const CLAUDE_RECENT_MTIME_GRACE_MS = 30 * 60 * 1000; // keep recently-updated sessions visible after exit
const CODEX_DISCOVERY_MAX_FILES = 12;
const CODEX_DISCOVERY_MTIME_GRACE_MS = 30 * 60 * 1000; // periodically discover recently-updated Codex sessions
const OPENCLAW_DISCOVERY_MAX_FILES_PER_AGENT = 3;
const OPENCLAW_DISCOVERY_MAX_FILES = 12;
const OPENCLAW_DISCOVERY_MTIME_GRACE_MS = 6 * 60 * 60 * 1000; // keep long-running/silent OpenClaw sessions visible
const USAGE_BACKFILL_BROADCAST_EVERY = 40;

function broadcastUsageTotals() {
  broadcast({
    type: 'usage_totals',
    ...UsageManager.getUsageTotals()
  });
}

function parseMessagesFromLines(lines, parser) {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  return lines.map(line => parser.parseMessage(line)).filter(Boolean);
}

function ingestUsageFromLines(lines, parser, toolName, sessionId) {
  if (!parser.parseUsageEvent || !Array.isArray(lines) || lines.length === 0) return false;

  let changed = false;
  for (const line of lines) {
    const event = parser.parseUsageEvent(line);
    if (!event) continue;
    const applied = UsageManager.ingestUsageEvent({
      sessionId,
      tool: toolName,
      event,
      calculateCostUsd: PricingService.calculateCostUsd
    });
    if (applied) changed = true;
  }

  return changed;
}

function collectUsageBackfillEntries() {
  const entries = [];
  const seen = new Set();

  const addEntry = (filePath, parser, toolName) => {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    entries.push({ filePath: resolved, parser, toolName });
  };

  FileMonitor.scanAllProjects(
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    (filePath) => addEntry(filePath, ClaudeCodeParser, 'claude-code'),
    () => {}
  );

  FileMonitor.scanCodexSessions(
    CodexParser.CODEX_SESSIONS_DIR,
    (filePath) => addEntry(filePath, CodexParser, 'codex'),
    () => {},
    { silent: true }
  );

  FileMonitor.scanOpenClawAgents(
    OpenClawParser.OPENCLAW_AGENTS_DIR,
    (filePath) => addEntry(filePath, OpenClawParser, 'openclaw'),
    () => {}
  );

  return entries;
}

async function runUsageBackfill() {
  const entries = collectUsageBackfillEntries();
  const totalFiles = entries.length;

  UsageManager.setBackfillProgress({
    status: 'running',
    scannedFiles: 0,
    totalFiles
  });
  broadcastUsageTotals();

  let scannedFiles = 0;
  let usageChangedSinceLastBroadcast = false;

  for (const entry of entries) {
    scannedFiles += 1;
    const { filePath, parser, toolName } = entry;
    const sessionId = parser.getSessionId(filePath);

    let lines = [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      lines = content.split('\n').filter(line => line.trim());
    } catch {
      // Skip unreadable files.
    }

    if (ingestUsageFromLines(lines, parser, toolName, sessionId)) {
      usageChangedSinceLastBroadcast = true;
    }

    const progressChanged = UsageManager.setBackfillProgress({
      status: 'running',
      scannedFiles,
      totalFiles
    });

    if (
      usageChangedSinceLastBroadcast ||
      progressChanged ||
      scannedFiles === totalFiles
    ) {
      if (
        scannedFiles % USAGE_BACKFILL_BROADCAST_EVERY === 0 ||
        scannedFiles === totalFiles
      ) {
        broadcastUsageTotals();
        usageChangedSinceLastBroadcast = false;
      }
    }

    if (scannedFiles % 20 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  UsageManager.setBackfillProgress({
    status: 'done',
    scannedFiles: totalFiles,
    totalFiles
  });
  broadcastUsageTotals();
}

// Process a JSONL file
function processFile(filePath, parser, toolName) {
  // Normalize early so all downstream maps/sets compare correctly.
  filePath = path.resolve(filePath);

  const sessionId = parser.getSessionId(filePath);
  const projectDir = path.resolve(path.dirname(filePath));
  const projectName = parser.getProjectName(path.dirname(filePath));
  const lines = FileMonitor.readIncrementalLines(filePath, 'live-monitor');
  const parsedMessages = parseMessagesFromLines(lines, parser);
  const usageChanged = ingestUsageFromLines(lines, parser, toolName, sessionId);
  let runningChanged = false;

  // Check if this is a new session
  if (!SessionManager.getSession(sessionId)) {
    SessionManager.createSession(
      sessionId,
      toolName,
      projectName,
      filePath,
      projectDir
    );
    runningChanged = UsageManager.upsertLiveSession(sessionId, toolName, 'active');

    // Read and append messages from incremental lines.
    const appended = SessionManager.addMessages(sessionId, parsedMessages) || [];

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
    const session = SessionManager.getSession(sessionId);
    if (session && lines.length > 0 && session.state === 'idle') {
      SessionManager.setSessionState(sessionId, 'active', handleStateChange);
    }

    if (parsedMessages.length > 0) {
      const appended = SessionManager.addMessages(sessionId, parsedMessages) || [];

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

  if (usageChanged || runningChanged) {
    broadcastUsageTotals();
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

function loadOpenClawSessionsInDir(sessionsDir, activeSessionFiles) {
  for (const filePath of activeSessionFiles) {
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

function discoverRecentOpenClawFiles() {
  return FileMonitor.getRecentOpenClawSessionFiles(OpenClawParser.OPENCLAW_AGENTS_DIR, {
    maxAgeMs: OPENCLAW_DISCOVERY_MTIME_GRACE_MS,
    maxCountPerAgent: OPENCLAW_DISCOVERY_MAX_FILES_PER_AGENT,
    maxTotal: OPENCLAW_DISCOVERY_MAX_FILES
  }).map(p => path.resolve(p));
}

// Handle state changes
function handleStateChange(sessionId, newState, options) {
  if (options.removed) {
    broadcast({
      type: 'session_remove',
      sessionId
    });

    if (UsageManager.removeLiveSession(sessionId)) {
      broadcastUsageTotals();
    }
  } else {
    broadcast({
      type: 'state_change',
      sessionId,
      state: newState
    });

    if (UsageManager.setLiveSessionState(sessionId, newState)) {
      broadcastUsageTotals();
    }
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
  const recentOpenClawFiles = discoverRecentOpenClawFiles();
  const openclawActiveFiles = new Set([
    ...openclawLocked.sessionFiles.map(p => path.resolve(p)),
    ...recentOpenClawFiles
  ]);
  const openclawActiveDirs = new Set([
    ...Array.from(openclawLocked.activeDirs),
    ...Array.from(openclawActiveFiles).map(filePath => path.resolve(path.dirname(filePath)))
  ].filter(safeIsDir));

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
      loadOpenClawSessionsInDir(dir, openclawActiveFiles);
      continue;
    }
  }

  processLogger.processCheck(claudeActiveDirs.size, codexActiveDirs.size, openclawActiveDirs.size);

  // Ensure active Codex sessions are loaded even when a new YYYY/MM/DD directory appears
  // after startup (directory watchers are attached only to known day folders).
  for (const filePath of codexActiveFiles) {
    processFile(filePath, CodexParser, 'codex');
  }

  // Also ensure currently active/recent OpenClaw sessions are loaded at least once (covers the case where
  // a sessions dir was already known but no file-change event was observed by watchers).
  for (const filePath of openclawActiveFiles) {
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

  await PricingService.initPricingService();

  // Initialize WebSocket
  initWebSocket(
    server,
    () => SessionManager.getAllSessions(),
    () => UsageManager.getUsageTotals()
  );

  // Step 1: Scan processes FIRST to get active project directories
  await checkProcesses();
  UsageManager.syncLiveSessions(SessionManager.getAllSessions());
  broadcastUsageTotals();

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

  // Build all-history usage totals in the background.
  runUsageBackfill().catch((error) => {
    logger.error('Usage backfill failed', { error: error?.message || String(error) });
    UsageManager.setBackfillProgress({
      status: 'done'
    });
    broadcastUsageTotals();
  });

  // Scan processes every 15 seconds
  setInterval(checkProcesses, 15000);

  // Check for IDLE sessions every 30 seconds
  setInterval(() => {
    SessionManager.checkIdleSessions(handleStateChange);
  }, 30000);

  // Refresh pricing cache in background (24h TTL enforced inside service).
  setInterval(() => {
    PricingService.refreshPricingInBackground().catch(() => {});
  }, 60 * 60 * 1000);
});

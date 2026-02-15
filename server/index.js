import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// Import modules
import { initWebSocket, broadcast } from './websocket.js';
import * as ClaudeCodeParser from './parsers/claude-code.js';
import * as FileMonitor from './monitors/file-monitor.js';
import * as ProcessMonitor from './monitors/process-monitor.js';
import * as SessionManager from './session-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Create HTTP server
const server = createServer(app);

// Process a JSONL file
function processFile(filePath) {
  const sessionId = ClaudeCodeParser.getSessionId(filePath);
  const projectDir = path.dirname(filePath);
  const projectName = ClaudeCodeParser.getProjectName(projectDir);

  // Check if this is a new session
  if (!SessionManager.getSession(sessionId)) {
    console.log(`New session discovered: ${sessionId} (${projectName})`);

    const session = SessionManager.createSession(
      sessionId,
      'claude-code',
      projectName,
      filePath,
      projectDir
    );

    // Read all existing messages
    const messages = FileMonitor.readIncremental(filePath, ClaudeCodeParser.parseMessage);
    SessionManager.addMessages(sessionId, messages);

    // Broadcast new session
    broadcast({
      type: 'session_init',
      sessionId,
      tool: 'claude-code',
      name: projectName,
      messages,
      state: 'active'
    });
  } else {
    // Read incremental messages
    const messages = FileMonitor.readIncremental(filePath, ClaudeCodeParser.parseMessage);

    if (messages.length > 0) {
      SessionManager.addMessages(sessionId, messages);

      // Set to ACTIVE if it was IDLE
      const session = SessionManager.getSession(sessionId);
      if (session.state === 'idle') {
        SessionManager.setSessionState(sessionId, 'active', handleStateChange);
      }

      // Broadcast each new message
      messages.forEach(message => {
        broadcast({
          type: 'message_add',
          sessionId,
          message
        });
      });

      console.log(`Session ${sessionId}: +${messages.length} messages`);
    }
  }
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
  const processes = await ProcessMonitor.scanProcesses(
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    ClaudeCodeParser.encodeCwd
  );

  const activeProjectDirs = ProcessMonitor.getActiveProjectDirs();
  SessionManager.checkSessionProcesses(activeProjectDirs, handleStateChange);
}

// Start server
server.listen(PORT, () => {
  console.log(`Nexus server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
  console.log('');

  // Initialize WebSocket
  initWebSocket(server, SessionManager.getAllSessions());

  // Scan all Claude Code projects
  FileMonitor.scanAllProjects(
    ClaudeCodeParser.CLAUDE_PROJECTS_DIR,
    processFile,
    (projectDir) => FileMonitor.watchProjectDir(projectDir, processFile)
  );

  // Initial process scan
  checkProcesses();

  // Scan processes every 15 seconds
  setInterval(checkProcesses, 15000);

  // Check for IDLE sessions every 30 seconds
  setInterval(() => {
    SessionManager.checkIdleSessions(handleStateChange);
  }, 30000);
});

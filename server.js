import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store active sessions
const sessions = new Map();

// Track file read offsets for incremental reading
const fileOffsets = new Map();

// Track watched directories
const watchers = new Map();

// Track active processes (PID -> project directory)
const activeProcesses = new Map();

// Claude Code projects directory
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Clean session object for JSON serialization (remove non-serializable fields)
function cleanSession(session) {
  const { cooldownTimer, ...cleanedSession } = session;
  return cleanedSession;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send current state to newly connected client
  const sessionList = Array.from(sessions.values()).map(cleanSession);
  ws.send(JSON.stringify({
    type: 'init',
    sessions: sessionList
  }));

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast message to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

// Parse Claude Code JSONL message
function parseClaudeMessage(line) {
  try {
    const obj = JSON.parse(line);

    // Extract user or assistant messages
    if (obj.type === 'user' && obj.message?.role === 'user') {
      const content = obj.message.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: 'user', content: text };
    }

    if (obj.type === 'assistant' && obj.message?.role === 'assistant') {
      const content = obj.message.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: 'assistant', content: text };
    }

    return null;
  } catch (error) {
    // Skip invalid JSON lines
    return null;
  }
}

// Read incremental content from JSONL file
function readIncremental(filePath) {
  try {
    const offset = fileOffsets.get(filePath) || 0;
    const stat = fs.statSync(filePath);

    if (stat.size <= offset) {
      return [];
    }

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    fileOffsets.set(filePath, stat.size);

    const lines = buf.toString('utf-8').split('\n').filter(line => line.trim());
    const messages = lines.map(parseClaudeMessage).filter(Boolean);

    return messages;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Get session ID from file path
function getSessionId(filePath) {
  return path.basename(filePath, '.jsonl');
}

// Get project name from directory path
function getProjectName(dirPath) {
  return path.basename(dirPath);
}

// Process a JSONL file
function processFile(filePath) {
  const sessionId = getSessionId(filePath);
  const projectDir = path.dirname(filePath);
  const projectName = getProjectName(projectDir);

  // Check if this is a new session
  if (!sessions.has(sessionId)) {
    console.log(`New session discovered: ${sessionId} (${projectName})`);

    const now = Date.now();
    const session = {
      sessionId,
      tool: 'claude-code',
      name: projectName,
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

    // Read all existing messages
    const messages = readIncremental(filePath);
    session.messages = messages;

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
    const messages = readIncremental(filePath);

    if (messages.length > 0) {
      const session = sessions.get(sessionId);
      session.messages.push(...messages);
      session.lastModified = Date.now();

      // Set to ACTIVE if it was IDLE
      if (session.state === 'idle') {
        setSessionState(sessionId, 'active');
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

// Scan a project directory for JSONL files
function scanProjectDir(projectDir) {
  try {
    const files = fs.readdirSync(projectDir);

    files.forEach(file => {
      if (file.endsWith('.jsonl')) {
        const filePath = path.join(projectDir, file);
        processFile(filePath);
      }
    });
  } catch (error) {
    console.error(`Error scanning ${projectDir}:`, error.message);
  }
}

// Watch a project directory for changes
function watchProjectDir(projectDir) {
  if (watchers.has(projectDir)) {
    return;
  }

  try {
    const watcher = fs.watch(projectDir, (eventType, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        const filePath = path.join(projectDir, filename);

        if (fs.existsSync(filePath)) {
          processFile(filePath);
        }
      }
    });

    watchers.set(projectDir, watcher);
    console.log(`Watching: ${projectDir}`);
  } catch (error) {
    console.error(`Error watching ${projectDir}:`, error.message);
  }
}

// Encode CWD path to project directory name
function encodeCwd(cwd) {
  // /Users/xxx/project → -Users-xxx-project
  return cwd.replace(/\//g, '-');
}

// Calculate cooldown duration based on active time
function getCooldownDuration(session) {
  const activeSeconds = (session.endTime - session.startTime) / 1000;
  // 10% of active time, clamped between 3 seconds and 5 minutes
  return Math.max(3, Math.min(300, activeSeconds * 0.1)) * 1000;
}

// Set session state and broadcast
function setSessionState(sessionId, newState) {
  const session = sessions.get(sessionId);
  if (!session || session.state === newState) {
    return;
  }

  const oldState = session.state;
  session.state = newState;

  console.log(`Session ${sessionId.substring(0, 8)}: ${oldState} → ${newState}`);

  // Handle state-specific logic
  if (newState === 'cooling') {
    session.endTime = Date.now();
    const cooldownDuration = getCooldownDuration(session);

    console.log(`  Cooldown: ${(cooldownDuration / 1000).toFixed(1)}s`);

    // Set timer to remove session after cooldown
    session.cooldownTimer = setTimeout(() => {
      setSessionState(sessionId, 'gone');
    }, cooldownDuration);
  } else if (newState === 'gone') {
    // Remove session
    if (session.cooldownTimer) {
      clearTimeout(session.cooldownTimer);
    }
    sessions.delete(sessionId);

    broadcast({
      type: 'session_remove',
      sessionId
    });

    console.log(`  Session removed`);
    return;
  }

  // Broadcast state change
  broadcast({
    type: 'state_change',
    sessionId,
    state: newState
  });
}

// Check for IDLE sessions (no modification for 2 minutes)
function checkIdleSessions() {
  const now = Date.now();
  const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes

  for (const [sessionId, session] of sessions.entries()) {
    if (session.state === 'active') {
      const timeSinceModified = now - session.lastModified;
      if (timeSinceModified > IDLE_THRESHOLD) {
        setSessionState(sessionId, 'idle');
      }
    }
  }
}

// Check which sessions have their processes still running
function checkSessionProcesses() {
  // Build a set of project directories that have active processes
  const activeProjectDirs = new Set();
  for (const [pid, info] of activeProcesses.entries()) {
    activeProjectDirs.add(info.projectDir);
  }

  // Check each session
  for (const [sessionId, session] of sessions.entries()) {
    const hasProcess = activeProjectDirs.has(session.projectDir);

    if (!hasProcess && (session.state === 'active' || session.state === 'idle')) {
      // Process exited, move to COOLING
      setSessionState(sessionId, 'cooling');
    }
  }
}

// Scan for active Claude Code processes
async function scanProcesses() {
  try {
    // Get all claude processes (excluding our own server)
    const { stdout } = await execAsync('ps aux | grep " claude" | grep -v grep | grep -v "node server.js"');
    const lines = stdout.trim().split('\n').filter(line => line.trim());

    const newProcesses = new Map();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[1];

      if (!pid) continue;

      try {
        // Get working directory for this process
        const { stdout: lsofOutput } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd`);
        const cwdMatch = lsofOutput.match(/cwd\s+DIR\s+\S+\s+\S+\s+\S+\s+(.+)$/m);

        if (cwdMatch) {
          const cwd = cwdMatch[1].trim();
          const encodedCwd = encodeCwd(cwd);
          const projectDir = path.join(CLAUDE_PROJECTS_DIR, encodedCwd);

          newProcesses.set(pid, { cwd, projectDir });

          // If this is a new process, log it
          if (!activeProcesses.has(pid)) {
            console.log(`Process detected: PID ${pid} → ${cwd}`);
          }
        }
      } catch (error) {
        // Process might have exited or lsof failed
      }
    }

    // Detect processes that have exited
    for (const [pid, info] of activeProcesses.entries()) {
      if (!newProcesses.has(pid)) {
        console.log(`Process exited: PID ${pid} → ${info.cwd}`);
        // Will handle state transition in Step 4
      }
    }

    // Update active processes
    activeProcesses.clear();
    for (const [pid, info] of newProcesses.entries()) {
      activeProcesses.set(pid, info);
    }

    console.log(`Active processes: ${activeProcesses.size}`);

    // Check which sessions have lost their processes
    checkSessionProcesses();
  } catch (error) {
    // No claude processes found or command failed
    if (activeProcesses.size > 0) {
      console.log('No active Claude processes found');
      activeProcesses.clear();
      checkSessionProcesses();
    }
  }
}

// Scan all Claude Code projects
function scanAllProjects() {
  try {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      console.log('Claude projects directory not found');
      return;
    }

    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);

    projectDirs.forEach(dirName => {
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, dirName);

      try {
        const stat = fs.statSync(projectDir);
        if (stat.isDirectory()) {
          scanProjectDir(projectDir);
          watchProjectDir(projectDir);
        }
      } catch (error) {
        // Skip inaccessible directories
      }
    });

    console.log(`Scanned ${projectDirs.length} project directories`);
  } catch (error) {
    console.error('Error scanning projects:', error.message);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Nexus server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
  console.log('');

  // Scan all Claude Code projects
  scanAllProjects();

  // Initial process scan
  scanProcesses();

  // Scan processes every 15 seconds
  setInterval(scanProcesses, 15000);

  // Check for IDLE sessions every 30 seconds
  setInterval(checkIdleSessions, 30000);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');

// ─── Config ───
const PORT = 3000;
const PROCESS_SCAN_INTERVAL = 15000; // 15s
const IDLE_TIMEOUT = 120000; // 2 min → IDLE
const MIN_COOLDOWN = 3000;
const MAX_COOLDOWN = 300000; // 5 min
const COOLDOWN_RATIO = 0.1;
const INITIAL_SCAN_WINDOW = 4 * 60 * 60 * 1000; // 4 hours for initial discovery

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents');

// ─── State ───
const sessions = new Map(); // sessionId → session object
const fileOffsets = new Map(); // filePath → byte offset
const watchers = new Map(); // dirPath → fs.FSWatcher
const activeProcessCWDs = new Set(); // encoded CWD strings with active processes
let wsClients = new Set();

// ─── Session Object ───
function createSession(id, filePath, tool) {
  const projectName = extractProjectName(filePath, tool);
  return {
    id,
    filePath,
    tool,
    name: projectName,
    state: 'active', // active | idle | cooling | gone
    messages: [],
    startTime: Date.now(),
    lastActivity: Date.now(),
    cooldownTimer: null,
    idleTimer: null,
  };
}

function extractProjectName(filePath, tool) {
  if (tool === 'claude-code') {
    // ~/.claude/projects/-Users-xxx-project/uuid.jsonl → project
    const dir = path.dirname(filePath);
    const encoded = path.basename(dir);
    const parts = encoded.split('-').filter(Boolean);
    return parts[parts.length - 1] || encoded;
  }
  if (tool === 'codex') {
    return path.basename(filePath, '.jsonl');
  }
  if (tool === 'openclaw') {
    const parts = filePath.split(path.sep);
    const agentIdx = parts.indexOf('agents');
    return agentIdx >= 0 ? parts[agentIdx + 1] : path.basename(filePath, '.jsonl');
  }
  return path.basename(filePath, '.jsonl');
}


// ─── JSONL Parsers ───
function parseClaudeCodeLine(json) {
  // Claude Code JSONL has nested structure: { type: "user"|"assistant", message: { role, content } }
  // Also handle direct { role, content } format
  let role, rawContent;

  if (json.message && json.message.role) {
    role = json.message.role;
    rawContent = json.message.content;
  } else if (json.role) {
    role = json.role;
    rawContent = json.content;
  } else {
    return null;
  }

  if (role !== 'user' && role !== 'assistant') return null;
  // Skip meta/command messages
  if (json.isMeta) return null;

  let content = '';
  if (typeof rawContent === 'string') {
    // Skip command messages
    if (rawContent.startsWith('<local-command') || rawContent.startsWith('<command-name')) return null;
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent
      .map(c => {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text || '';
        if (c.type === 'tool_use') return `[Tool: ${c.name || 'unknown'}]`;
        if (c.type === 'tool_result') return '[Tool Result]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (!content.trim()) return null;
  return { role, content: content.substring(0, 2000) };
}

function parseCodexLine(json) {
  if (json.type !== 'response_item' || !json.payload) return null;
  const { role } = json.payload;
  if (role !== 'user' && role !== 'assistant') return null;
  let content = '';
  if (Array.isArray(json.payload.content)) {
    content = json.payload.content
      .map(c => c.text || '')
      .filter(Boolean)
      .join('\n');
  } else if (typeof json.payload.content === 'string') {
    content = json.payload.content;
  }
  if (!content.trim()) return null;
  return { role, content: content.substring(0, 2000) };
}

function parseOpenClawLine(json) {
  // OpenClaw: { type: "message", message: { role, content } }
  let role, rawContent;

  if (json.type === 'message' && json.message) {
    role = json.message.role;
    rawContent = json.message.content;
  } else if (json.role) {
    role = json.role;
    rawContent = json.content;
  } else {
    return null;
  }

  if (role !== 'user' && role !== 'assistant') return null;

  let content = '';
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent
      .map(c => {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text || '';
        if (c.type === 'thinking') return ''; // skip thinking blocks
        if (c.type === 'toolCall') return `[Tool: ${c.name || 'unknown'}]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (!content.trim()) return null;
  return { role, content: content.substring(0, 2000) };
}

function parseLine(line, tool) {
  try {
    const json = JSON.parse(line);
    if (tool === 'claude-code') return parseClaudeCodeLine(json);
    if (tool === 'codex') return parseCodexLine(json);
    if (tool === 'openclaw') return parseOpenClawLine(json);
    return null;
  } catch {
    return null;
  }
}


// ─── Incremental File Reading ───
function readIncremental(filePath, tool) {
  const offset = fileOffsets.get(filePath) || 0;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (stat.size <= offset) return [];

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  const messages = [];
  const lines = buf.toString('utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = parseLine(line, tool);
    if (msg) messages.push(msg);
  }
  return messages;
}

// ─── WebSocket Broadcasting ───
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(json);
    }
  }
}

// ─── State Machine ───
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function getCooldownDuration(session) {
  const activeSeconds = (Date.now() - session.startTime) / 1000;
  return clamp(activeSeconds * COOLDOWN_RATIO, MIN_COOLDOWN / 1000, MAX_COOLDOWN / 1000) * 1000;
}

function setSessionState(session, newState) {
  if (session.state === newState) return;
  const oldState = session.state;
  session.state = newState;

  // Clear timers
  if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = null; }
  if (session.cooldownTimer) { clearTimeout(session.cooldownTimer); session.cooldownTimer = null; }

  if (newState === 'active') {
    session.lastActivity = Date.now();
    // Set idle timer
    session.idleTimer = setTimeout(() => {
      if (session.state === 'active') {
        setSessionState(session, 'idle');
      }
    }, IDLE_TIMEOUT);
  }

  if (newState === 'cooling') {
    const cooldown = getCooldownDuration(session);
    session.cooldownTimer = setTimeout(() => {
      setSessionState(session, 'gone');
    }, cooldown);
    broadcast({ type: 'state_change', sessionId: session.id, state: 'cooling', cooldownMs: cooldown });
    return;
  }

  if (newState === 'gone') {
    broadcast({ type: 'session_remove', sessionId: session.id });
    sessions.delete(session.id);
    fileOffsets.delete(session.filePath);
    return;
  }

  broadcast({ type: 'state_change', sessionId: session.id, state: newState });
}

function onFileActivity(session) {
  session.lastActivity = Date.now();
  if (session.state === 'cooling') {
    // Revive
    if (session.cooldownTimer) { clearTimeout(session.cooldownTimer); session.cooldownTimer = null; }
  }
  if (session.state !== 'active') {
    setSessionState(session, 'active');
  } else {
    // Reset idle timer
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.state === 'active') {
        setSessionState(session, 'idle');
      }
    }, IDLE_TIMEOUT);
  }
}


// ─── Session Discovery ───
function sessionIdFromPath(filePath) {
  return filePath; // use full path as unique ID
}

function discoverAndWatch(tool, baseDir, globPattern) {
  if (!fs.existsSync(baseDir)) return;

  function scanDir(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        watchDir(full, tool);
        scanDir(full, depth + 1);
      } else if (entry.name.endsWith('.jsonl')) {
        tryAddSession(full, tool);
      }
    }
  }

  function watchDir(dir, tool) {
    if (watchers.has(dir)) return;
    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename);
        if (filename.endsWith('.jsonl')) {
          handleFileChange(full, tool);
        } else {
          // Might be a new subdirectory
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
              watchDir(full, tool);
              scanDir(full, 0);
            }
          } catch {}
        }
      });
      watchers.set(dir, watcher);
    } catch {}
  }

  watchDir(baseDir, tool);
  scanDir(baseDir, 0);
}

function tryAddSession(filePath, tool) {
  const id = sessionIdFromPath(filePath);
  if (sessions.has(id)) return;

  // Check if file was recently modified (within 30 min for initial scan)
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > INITIAL_SCAN_WINDOW) return;
  } catch { return; }

  const session = createSession(id, filePath, tool);
  const messages = readIncremental(filePath, tool);
  session.messages = messages;
  session.lastActivity = Date.now();
  sessions.set(id, session);

  broadcast({
    type: 'session_init',
    sessionId: id,
    tool,
    name: session.name,
    state: session.state,
    messages: messages.slice(-50), // send last 50 messages
  });

  // Start idle timer
  session.idleTimer = setTimeout(() => {
    if (session.state === 'active') {
      setSessionState(session, 'idle');
    }
  }, IDLE_TIMEOUT);

  console.log(`[+] Session discovered: ${tool} / ${session.name} (${messages.length} msgs)`);
}

function handleFileChange(filePath, tool) {
  const id = sessionIdFromPath(filePath);
  let session = sessions.get(id);

  if (!session) {
    // New session
    tryAddSession(filePath, tool);
    return;
  }

  // Read incremental
  const newMessages = readIncremental(filePath, tool);
  if (newMessages.length > 0) {
    session.messages.push(...newMessages);
    for (const msg of newMessages) {
      broadcast({ type: 'message_add', sessionId: id, message: msg });
    }
    onFileActivity(session);
  }
}


// ─── Process Scanning ───
function scanProcesses() {
  // Step 1: Find all claude PIDs using pgrep (process name is 'claude' but lsof sees 'node')
  execFile('bash', ['-c', 'pgrep -f "^claude" 2>/dev/null'], (err, stdout) => {
    const pids = (stdout || '').trim().split('\n').filter(Boolean);
    if (pids.length === 0) {
      // No claude processes — check all claude-code sessions
      checkSessionsForDeadProcesses(new Set());
      return;
    }

    // Step 2: Get CWD for each PID using lsof
    const pidArg = pids.join(',');
    execFile('bash', ['-c', `lsof -p ${pidArg} -a -d cwd -F pn 2>/dev/null`], (err2, stdout2) => {
      const newCWDs = new Set();
      if (stdout2) {
        const lines = stdout2.split('\n');
        for (const line of lines) {
          if (line.startsWith('n') && line.length > 1) {
            const cwd = line.substring(1);
            // Encode CWD to match Claude's directory naming: /Users/xxx → Users-xxx
            // Claude encodes CWD: /Users/xxx → -Users-xxx (leading dash kept)
            const encoded = cwd.replace(/\//g, '-');
            newCWDs.add(encoded);
          }
        }
      }
      checkSessionsForDeadProcesses(newCWDs);
    });
  });

  // Scan for codex processes
  execFile('bash', ['-c', 'pgrep -f codex 2>/dev/null'], () => {});
  // Scan for openclaw processes
  execFile('bash', ['-c', 'pgrep -f openclaw 2>/dev/null'], () => {});
}

function checkSessionsForDeadProcesses(activeCWDs) {
  activeProcessCWDs.clear();
  for (const cwd of activeCWDs) activeProcessCWDs.add(cwd);

  for (const [id, session] of sessions) {
    if (session.tool !== 'claude-code') continue;
    if (session.state === 'cooling' || session.state === 'gone') continue;

    const dir = path.basename(path.dirname(session.filePath));
    // Check if any active CWD matches this session's project directory
    let hasProcess = false;
    for (const cwd of activeCWDs) {
      if (cwd === dir || dir.startsWith(cwd) || cwd.endsWith(dir)) {
        hasProcess = true;
        break;
      }
    }

    if (!hasProcess) {
      // Grace period: check if file was very recently modified
      try {
        const stat = fs.statSync(session.filePath);
        if (Date.now() - stat.mtimeMs < 30000) continue; // 30s grace
      } catch {}
      console.log(`[-] Process gone for: ${session.name}`);
      setSessionState(session, 'cooling');
    }
  }
}


// ─── HTTP Server ───
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(htmlPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ─── WebSocket Server ───
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[ws] Client connected (${wsClients.size} total)`);

  // Send all current sessions
  for (const [id, session] of sessions) {
    if (session.state === 'gone') continue;
    ws.send(JSON.stringify({
      type: 'session_init',
      sessionId: id,
      tool: session.tool,
      name: session.name,
      state: session.state,
      messages: session.messages.slice(-50),
    }));
  }

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[ws] Client disconnected (${wsClients.size} total)`);
  });
});

// ─── Start ───
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   Nexus - Agent Arena Monitor        ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);

  // Discover sessions for all tools
  discoverAndWatch('claude-code', CLAUDE_PROJECTS_DIR);
  discoverAndWatch('codex', CODEX_SESSIONS_DIR);
  discoverAndWatch('openclaw', OPENCLAW_AGENTS_DIR);

  console.log(`[*] Watching for sessions...`);
  console.log(`[*] Active sessions: ${sessions.size}`);

  // Start process scanning
  setInterval(scanProcesses, PROCESS_SCAN_INTERVAL);
  scanProcesses(); // initial scan
});

import fs from 'fs';
import path from 'path';

// Track file read offsets for incremental reading
const fileOffsets = new Map();

// Track watched directories
const watchers = new Map();

function isJsonlFile(name) {
  return name.endsWith('.jsonl');
}

function isDeletedJsonl(name) {
  // OpenClaw keeps tombstoned sessions as `*.jsonl.deleted.<timestamp>`
  return name.includes('.jsonl.deleted.');
}

function listJsonlFiles(rootDir, { recursive = false } = {}) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isJsonlFile(entry.name) || isDeletedJsonl(entry.name)) continue;
      out.push(fullPath);
    }
  }

  return out;
}

function makeOffsetMapKey(filePath, offsetKey = 'messages') {
  return `${filePath}::${offsetKey}`;
}

// Read incremental raw lines from JSONL file with an independent offset key.
export function readIncrementalLines(filePath, offsetKey = 'messages') {
  try {
    const mapKey = makeOffsetMapKey(filePath, offsetKey);
    const offset = fileOffsets.get(mapKey) || 0;
    const stat = fs.statSync(filePath);

    if (stat.size <= offset) {
      return [];
    }

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    fileOffsets.set(mapKey, stat.size);
    return buf.toString('utf-8').split('\n').filter(line => line.trim());
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Read incremental content from JSONL file
export function readIncremental(filePath, parseMessageFn) {
  const lines = readIncrementalLines(filePath, 'messages');
  return lines.map(parseMessageFn).filter(Boolean);
}

// Watch a project directory for changes
export function watchProjectDir(projectDir, onFileChange) {
  if (watchers.has(projectDir)) {
    return;
  }

  try {
    const watcher = fs.watch(projectDir, (eventType, filename) => {
      if (filename && isJsonlFile(filename) && !isDeletedJsonl(filename)) {
        const filePath = path.join(projectDir, filename);

        if (fs.existsSync(filePath)) {
          onFileChange(filePath);
        }
      }
    });

    watchers.set(projectDir, watcher);
    console.log(`Watching: ${projectDir}`);
  } catch (error) {
    console.error(`Error watching ${projectDir}:`, error.message);
  }
}

// Scan a project directory for JSONL files
export function scanProjectDir(projectDir, onFileFound, options = {}) {
  try {
    const files = listJsonlFiles(projectDir, options);
    files.forEach(filePath => onFileFound(filePath));
  } catch (error) {
    console.error(`Error scanning ${projectDir}:`, error.message);
  }
}

// Get the most recently modified JSONL file in a directory
export function getMostRecentSession(projectDir, options = {}) {
  try {
    const files = listJsonlFiles(projectDir, options);
    let mostRecentFile = null;
    let mostRecentTime = 0;

    files.forEach(filePath => {
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs > mostRecentTime) {
          mostRecentTime = stats.mtimeMs;
          mostRecentFile = filePath;
        }
      } catch {
        // Skip files that can't be accessed
      }
    });

    return mostRecentFile;
  } catch (error) {
    return null;
  }
}

// Get JSONL session files ordered by mtime (newest first)
export function getSessionFilesByMtime(projectDir, options = {}) {
  try {
    const files = listJsonlFiles(projectDir, options);
    const items = [];

    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) continue;
        items.push({ filePath, mtimeMs: stats.mtimeMs });
      } catch {
        // ignore
      }
    }

    items.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return items.map(i => i.filePath);
  } catch {
    return [];
  }
}

// Get recent JSONL session files under a directory.
export function getRecentSessionFiles(projectDir, { maxAgeMs, maxCount, recursive = false }) {
  const now = Date.now();
  const files = getSessionFilesByMtime(projectDir, { recursive });
  const out = [];

  for (const filePath of files) {
    if (out.length >= maxCount) break;
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs <= maxAgeMs) {
        out.push(filePath);
      }
    } catch {
      // ignore
    }
  }

  return out;
}

// OpenClaw: find active session JSONL files by `.jsonl.lock` markers.
// Returns { sessionFiles: string[], activeDirs: Set<string> } where activeDirs are `.../sessions` directories.
export function findOpenClawLockedSessions(agentsDir) {
  const sessionFiles = [];
  const activeDirs = new Set();

  try {
    if (!fs.existsSync(agentsDir)) {
      return { sessionFiles, activeDirs };
    }

    const agents = fs.readdirSync(agentsDir);
    for (const agent of agents) {
      const agentPath = path.join(agentsDir, agent);
      let agentStat;
      try {
        agentStat = fs.statSync(agentPath);
      } catch {
        continue;
      }
      if (!agentStat.isDirectory()) continue;

      const sessionsDir = path.join(agentPath, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;

      let sessionsStat;
      try {
        sessionsStat = fs.statSync(sessionsDir);
      } catch {
        continue;
      }
      if (!sessionsStat.isDirectory()) continue;

      let files;
      try {
        files = fs.readdirSync(sessionsDir);
      } catch {
        continue;
      }

      // A session is considered active if its `.jsonl.lock` exists.
      for (const file of files) {
        if (!file.endsWith('.jsonl.lock')) continue;
        const jsonl = file.slice(0, -'.lock'.length);
        if (!isJsonlFile(jsonl) || isDeletedJsonl(jsonl)) continue;

        const jsonlPath = path.join(sessionsDir, jsonl);
        if (fs.existsSync(jsonlPath)) {
          sessionFiles.push(jsonlPath);
          activeDirs.add(sessionsDir);
        }
      }
    }
  } catch {
    // ignore
  }

  return { sessionFiles, activeDirs };
}

// OpenClaw: find recently-updated session JSONL files under `agents/*/sessions`.
// This is a fallback activity signal because `.jsonl.lock` can be very short-lived.
export function getRecentOpenClawSessionFiles(agentsDir, { maxAgeMs, maxCountPerAgent = 3, maxTotal = 12 }) {
  const now = Date.now();
  const all = [];

  try {
    if (!fs.existsSync(agentsDir)) {
      return [];
    }

    const agents = fs.readdirSync(agentsDir);
    for (const agent of agents) {
      const agentPath = path.join(agentsDir, agent);
      let agentStat;
      try {
        agentStat = fs.statSync(agentPath);
      } catch {
        continue;
      }
      if (!agentStat.isDirectory()) continue;

      const sessionsDir = path.join(agentPath, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;

      let sessionsStat;
      try {
        sessionsStat = fs.statSync(sessionsDir);
      } catch {
        continue;
      }
      if (!sessionsStat.isDirectory()) continue;

      const perAgent = [];
      let files;
      try {
        files = fs.readdirSync(sessionsDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!isJsonlFile(file) || isDeletedJsonl(file)) continue;
        const filePath = path.join(sessionsDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;
          if ((now - stat.mtimeMs) > maxAgeMs) continue;
          perAgent.push({ filePath, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore
        }
      }

      perAgent.sort((a, b) => b.mtimeMs - a.mtimeMs);
      all.push(...perAgent.slice(0, maxCountPerAgent));
    }
  } catch {
    // ignore
  }

  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return all.slice(0, maxTotal).map(i => i.filePath);
}

// Scan all project directories
export function scanAllProjects(projectsDir, onFileFound, onDirFound, options = {}) {
  try {
    if (!fs.existsSync(projectsDir)) {
      console.log('Projects directory not found');
      return;
    }

    const projectDirs = fs.readdirSync(projectsDir);

    projectDirs.forEach(dirName => {
      const projectDir = path.join(projectsDir, dirName);

      try {
        const stat = fs.statSync(projectDir);
        if (stat.isDirectory()) {
          scanProjectDir(projectDir, onFileFound, { recursive: Boolean(options.recursive) });
          onDirFound(projectDir);
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

// Clear file offset (for testing)
export function clearOffset(filePath, offsetKey = null) {
  if (offsetKey) {
    fileOffsets.delete(makeOffsetMapKey(filePath, offsetKey));
    return;
  }

  // Backward-compatible behavior: clear all offsets for this file.
  const prefix = `${filePath}::`;
  for (const key of fileOffsets.keys()) {
    if (key.startsWith(prefix)) {
      fileOffsets.delete(key);
    }
  }
}

// Scan Codex sessions (YYYY/MM/DD directory structure)
export function scanCodexSessions(sessionsDir, onFileFound, onDirFound, options = {}) {
  const silent = Boolean(options.silent);
  try {
    if (!fs.existsSync(sessionsDir)) {
      if (!silent) console.log('Codex sessions directory not found');
      return;
    }

    // Scan YYYY directories
    const years = fs.readdirSync(sessionsDir);

    for (const year of years) {
      const yearPath = path.join(sessionsDir, year);

      try {
        const yearStat = fs.statSync(yearPath);
        if (!yearStat.isDirectory()) continue;

        // Scan MM directories
        const months = fs.readdirSync(yearPath);

        for (const month of months) {
          const monthPath = path.join(yearPath, month);

          try {
            const monthStat = fs.statSync(monthPath);
            if (!monthStat.isDirectory()) continue;

            // Scan DD directories
            const days = fs.readdirSync(monthPath);

            for (const day of days) {
              const dayPath = path.join(monthPath, day);

              try {
                const dayStat = fs.statSync(dayPath);
                if (!dayStat.isDirectory()) continue;

                // Scan JSONL files
                const files = fs.readdirSync(dayPath);
                files.forEach(file => {
                  if (isJsonlFile(file) && !isDeletedJsonl(file)) {
                    const filePath = path.join(dayPath, file);
                    onFileFound(filePath);
                  }
                });

                onDirFound(dayPath);
              } catch (error) {
                // Skip inaccessible day directories
              }
            }
          } catch (error) {
            // Skip inaccessible month directories
          }
        }
      } catch (error) {
        // Skip inaccessible year directories
      }
    }

    if (!silent) console.log('Scanned Codex sessions');
  } catch (error) {
    if (!silent) console.error('Error scanning Codex sessions:', error.message);
  }
}

// Scan OpenClaw agents (agents/*/sessions structure)
export function scanOpenClawAgents(agentsDir, onFileFound, onDirFound) {
  try {
    if (!fs.existsSync(agentsDir)) {
      console.log('OpenClaw agents directory not found');
      return;
    }

    // Scan agents directory
    const agents = fs.readdirSync(agentsDir);

    for (const agent of agents) {
      const agentPath = path.join(agentsDir, agent);

      try {
        const agentStat = fs.statSync(agentPath);
        if (!agentStat.isDirectory()) continue;

        // Scan sessions directory
        const sessionsPath = path.join(agentPath, 'sessions');

        if (fs.existsSync(sessionsPath)) {
          const sessionsStat = fs.statSync(sessionsPath);

          if (sessionsStat.isDirectory()) {
            const files = fs.readdirSync(sessionsPath);
            files.forEach(file => {
              if (isJsonlFile(file) && !isDeletedJsonl(file)) {
                const filePath = path.join(sessionsPath, file);
                onFileFound(filePath);
              }
            });

            onDirFound(sessionsPath);
          }
        }
      } catch (error) {
        // Skip inaccessible agent directories
      }
    }

    console.log('Scanned OpenClaw agents');
  } catch (error) {
    console.error('Error scanning OpenClaw agents:', error.message);
  }
}

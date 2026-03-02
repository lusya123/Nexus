import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const PROCESS_SCAN_COMMAND_TIMEOUT_MS = Number(process.env.NEXUS_PROCESS_SCAN_TIMEOUT_MS || 1200);
const PROCESS_SCAN_MAX_BUFFER = 1024 * 1024;

// Track active processes (PID -> project directory)
const activeProcesses = new Map();

function isUnderDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function extractOpenJsonlFilesFromLsof(lsofOutput, { restrictUnderDir } = {}) {
  const out = new Set();
  const lines = (lsofOutput || '').split('\n');

  // With `lsof -Fn`, file names are emitted as lines like: `n/absolute/path`.
  for (const line of lines) {
    if (!line.startsWith('n')) continue;
    const name = line.slice(1).trim();
    if (!name) continue;
    if (!name.endsWith('.jsonl')) continue;
    if (name.includes('.jsonl.deleted.')) continue;
    const p = path.resolve(name);
    if (restrictUnderDir && !isUnderDir(p, restrictUnderDir)) continue;
    out.add(p);
  }

  return Array.from(out);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match either a bare command (`codex`) or a path component (`/opt/.../codex`).
// Case-insensitive to cover app bundle binaries like `.../MacOS/Codex`.
export function matchesToolProcessCommand(command, toolName) {
  const escaped = escapeRegExp(toolName);
  const re = new RegExp(`(^|[\\s/])${escaped}(?=\\s|$)`, 'i');
  return re.test(String(command || ''));
}

async function runCommand(command, timeout = PROCESS_SCAN_COMMAND_TIMEOUT_MS) {
  try {
    const { stdout } = await execAsync(command, {
      timeout,
      maxBuffer: PROCESS_SCAN_MAX_BUFFER
    });
    return stdout || '';
  } catch {
    return '';
  }
}

function parseCwdFromLsofFn(lsofOutput) {
  const line = String(lsofOutput || '')
    .split('\n')
    .find((item) => item.startsWith('n'));
  return line ? line.slice(1).trim() : '';
}

// Scan for active Claude Code processes
export async function scanProcesses(toolName, projectsDir, encodeCwdFn) {
  try {
    // Use `ps` directly and filter in JS; grep-based matching misses path-style commands.
    const stdout = await runCommand('ps -axo pid=,command=');
    if (!stdout) return new Map();
    const lines = (stdout || '').split('\n').filter(line => line.trim());

    const newProcesses = new Map();

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = match[1];
      const command = match[2];

      if (!pid) continue;
      if (!matchesToolProcessCommand(command, toolName)) continue;

      try {
        // Read cwd using lsof -Fn to avoid grep pipes and keep timeout control.
        const lsofCwdOutput = await runCommand(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`);
        const cwd = parseCwdFromLsofFn(lsofCwdOutput);
        if (!cwd) continue;

        const encodedCwd = encodeCwdFn(cwd);
        const projectDir = path.resolve(path.join(projectsDir, encodedCwd));

        let sessionFiles = [];
        const lsofNames = await runCommand(`lsof -p ${pid} -Fn 2>/dev/null`);
        if (lsofNames) {
          sessionFiles = extractOpenJsonlFilesFromLsof(lsofNames, { restrictUnderDir: projectDir });
        }

        newProcesses.set(pid, { cwd, projectDir, toolName, sessionFiles });

        // If this is a new process, log it
        if (!activeProcesses.has(pid)) {
          console.log(`Process detected: PID ${pid} → ${cwd}`);
          console.log(`  Project dir: ${projectDir}`);
        }
      } catch (error) {
        // Process might have exited or lsof failed
      }
    }

    // Detect processes that have exited (only for this tool's processes)
    const toolProcessPids = new Set();
    for (const [pid, info] of activeProcesses.entries()) {
      // Check if this PID belongs to the current tool by checking if it's in newProcesses
      // or if it was previously tracked for this tool
      if (info.toolName === toolName) {
        toolProcessPids.add(pid);
        if (!newProcesses.has(pid)) {
          console.log(`Process exited: PID ${pid} → ${info.cwd}`);
          activeProcesses.delete(pid);
        }
      }
    }

    // Add or update processes for this tool
    for (const [pid, info] of newProcesses.entries()) {
      activeProcesses.set(pid, { ...info, toolName });
    }

    console.log(`Active ${toolName} processes: ${newProcesses.size}`);

    return newProcesses;
  } catch (error) {
    // Command failed; clear only this tool's tracked processes.
    for (const [pid, info] of activeProcesses.entries()) {
      if (info.toolName === toolName) activeProcesses.delete(pid);
    }
    return new Map();
  }
}

// Get active project directories
export function getActiveProjectDirs() {
  const activeProjectDirs = new Set();
  for (const [, info] of activeProcesses.entries()) {
    activeProjectDirs.add(info.projectDir);
  }
  return activeProjectDirs;
}

// Scan all tool processes
export async function scanAllToolProcesses(tools) {
  const allProcesses = new Map();

  for (const tool of tools) {
    const processes = await scanProcesses(
      tool.processName,
      tool.projectsDir,
      tool.encodeCwdFn
    );

    if (processes.size > 0) {
      allProcesses.set(tool.toolName, processes);
    }
  }

  return allProcesses;
}

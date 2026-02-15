import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

// Track active processes (PID -> project directory)
const activeProcesses = new Map();

// Scan for active Claude Code processes
export async function scanProcesses(toolName, projectsDir, encodeCwdFn) {
  try {
    // Get all processes for the specified tool (excluding our own server)
    const { stdout } = await execAsync(`ps aux | grep " ${toolName}" | grep -v grep | grep -v "node server" | grep -v "node /Users"`);
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
          const encodedCwd = encodeCwdFn(cwd);
          const projectDir = path.resolve(path.join(projectsDir, encodedCwd));

          newProcesses.set(pid, { cwd, projectDir, toolName });

          // If this is a new process, log it
          if (!activeProcesses.has(pid)) {
            console.log(`Process detected: PID ${pid} → ${cwd}`);
            console.log(`  Project dir: ${projectDir}`);
          }
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

    console.log(`Active ${toolName} processes: ${activeProcesses.size}`);

    return newProcesses;
  } catch (error) {
    // No claude processes found or command failed
    if (activeProcesses.size > 0) {
      console.log('No active Claude processes found');
      activeProcesses.clear();
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

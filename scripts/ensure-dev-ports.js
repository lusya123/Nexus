import { execSync } from 'child_process';
import path from 'path';

function run(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

function listListeningPids(port) {
  const out = run(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (!out) return [];
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function getCommand(pid) {
  return run(`ps -p ${pid} -o command=`).trim();
}

function getProcessCwd(pid) {
  const out = run(`lsof -a -p ${pid} -d cwd -Fn`);
  if (!out) return '';
  const line = out.split('\n').find(s => s.startsWith('n'));
  return line ? line.slice(1).trim() : '';
}

function isLikelyNexusBackend(processInfo, repoRoot) {
  // Prefer cwd match (works even when `ps` is restricted and command line is unavailable).
  if (processInfo.cwd === repoRoot) return true;
  if (!processInfo.command) return false;
  if (!processInfo.command.includes(repoRoot)) return false;
  return /\bnode\b.*\bserver\/index\.js\b/.test(processInfo.command);
}

function isLikelyNexusVite(processInfo, repoRoot) {
  const clientRoot = path.join(repoRoot, 'client');
  if (processInfo.cwd === clientRoot) return true;
  if (!processInfo.command) return false;
  if (!processInfo.command.includes(repoRoot)) return false;
  return /\bvite\b/.test(processInfo.command);
}

function terminateIfMatch(port, matcher, repoRoot) {
  const pids = listListeningPids(port);
  const killed = [];

  for (const pid of pids) {
    const processInfo = {
      command: getCommand(pid),
      cwd: getProcessCwd(pid)
    };
    if (!matcher(processInfo, repoRoot)) continue;

    try {
      process.kill(Number(pid), 'SIGTERM');
      killed.push(pid);
    } catch {
      // ignore
    }
  }

  return killed;
}

const repoRoot = process.cwd();
const killedBackend = terminateIfMatch(3000, isLikelyNexusBackend, repoRoot);
const killedFrontend = terminateIfMatch(5173, isLikelyNexusVite, repoRoot);

if (killedBackend.length > 0 || killedFrontend.length > 0) {
  console.log(
    `[dev ports] terminated stale processes: ` +
    `${killedBackend.length > 0 ? `backend(${killedBackend.join(',')})` : ''}` +
    `${killedBackend.length > 0 && killedFrontend.length > 0 ? ' ' : ''}` +
    `${killedFrontend.length > 0 ? `frontend(${killedFrontend.join(',')})` : ''}`
  );
}

import { execSync, spawn } from 'child_process';

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

function getProcessCwd(pid) {
  const out = run(`lsof -a -p ${pid} -d cwd -Fn`);
  if (!out) return '';
  const line = out.split('\n').find(s => s.startsWith('n'));
  return line ? line.slice(1).trim() : '';
}

const repoRoot = process.cwd();
const PORT = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryStopProcess(pid) {
  try {
    process.kill(Number(pid), 'SIGTERM');
  } catch {
    return false;
  }

  await sleep(300);
  const afterTerm = listListeningPids(PORT);
  if (!afterTerm.includes(String(pid))) return true;

  try {
    process.kill(Number(pid), 'SIGKILL');
  } catch {
    return false;
  }

  await sleep(200);
  return !listListeningPids(PORT).includes(String(pid));
}

function startBackend() {
  const child = spawn('node', ['server/index.js'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function main() {
  const listeners = listListeningPids(PORT);

  if (listeners.length > 0) {
    const pid = listeners[0];
    const cwd = getProcessCwd(pid);

    if (cwd === repoRoot) {
      const stopped = await tryStopProcess(pid);
      if (stopped) {
        console.log(`[backend] Restarted existing Nexus backend (previous pid=${pid}).`);
        startBackend();
        return;
      }

      // If we can't stop it (e.g. restricted env), reuse instead of hard-failing.
      console.log(`[backend] Reusing existing Nexus backend on :${PORT} (pid=${pid}).`);
      process.exit(0);
    }

    console.error(
      `[backend] Port ${PORT} is occupied by pid=${pid}${cwd ? ` (cwd=${cwd})` : ''}. ` +
      `Please stop that process or run with a different backend port.`
    );
    process.exit(1);
  }

  startBackend();
}

main().catch((error) => {
  console.error(`[backend] Failed to start backend: ${error?.message || error}`);
  process.exit(1);
});

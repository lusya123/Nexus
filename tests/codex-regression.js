import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseMessage } from '../server/parsers/codex.js';
import { scanCodexSessions } from '../server/monitors/file-monitor.js';
import { matchesToolProcessCommand } from '../server/monitors/process-monitor.js';

let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`✅ ${name}`);
}

function fail(name, error) {
  failed += 1;
  console.log(`❌ ${name}`);
  console.log(`   ${error?.message || error}`);
}

function run(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

run('matchesToolProcessCommand supports path-form codex binaries', () => {
  assert.equal(matchesToolProcessCommand('/opt/homebrew/bin/codex --help', 'codex'), true);
  assert.equal(matchesToolProcessCommand('/Applications/Codex.app/Contents/MacOS/Codex', 'codex'), true);
  assert.equal(matchesToolProcessCommand('/opt/homebrew/bin/codex-agent', 'codex'), false);
});

run('parseMessage supports event_msg user/assistant payloads', () => {
  const userLine = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'user_message', message: 'hello from user' }
  });
  const assistantLine = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'hello from assistant' }
  });

  assert.deepEqual(parseMessage(userLine), { role: 'user', content: 'hello from user' });
  assert.deepEqual(parseMessage(assistantLine), { role: 'assistant', content: 'hello from assistant' });
});

run('scanCodexSessions finds all jsonl files in YYYY/MM/DD directories', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-codex-scan-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const dayDir = path.join(sessionsDir, '2026', '02', '16');
  fs.mkdirSync(dayDir, { recursive: true });

  const fileA = path.join(dayDir, 'rollout-2026-02-16T00-00-00-a.jsonl');
  const fileB = path.join(dayDir, 'custom-session.jsonl');
  fs.writeFileSync(fileA, '');
  fs.writeFileSync(fileB, '');

  const foundFiles = new Set();
  const foundDirs = new Set();

  scanCodexSessions(
    sessionsDir,
    (filePath) => foundFiles.add(path.resolve(filePath)),
    (dirPath) => foundDirs.add(path.resolve(dirPath)),
    { silent: true }
  );

  assert.equal(foundDirs.has(path.resolve(dayDir)), true);
  assert.equal(foundFiles.has(path.resolve(fileA)), true);
  assert.equal(foundFiles.has(path.resolve(fileB)), true);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

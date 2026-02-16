import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as FileMonitor from '../server/monitors/file-monitor.js';

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

function withTempDir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fm-'));
  try {
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run('scanAllProjects recursively includes nested jsonl files', () => {
  withTempDir((tmpRoot) => {
    const projectsDir = path.join(tmpRoot, 'projects');
    const projectA = path.join(projectsDir, 'project-a');
    const nestedDir = path.join(projectA, 'session-1', 'subagents');

    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectA, 'root.jsonl'), '{}\n');
    fs.writeFileSync(path.join(nestedDir, 'agent.jsonl'), '{}\n');
    fs.writeFileSync(path.join(nestedDir, 'skip.jsonl.deleted.1234'), '{}\n');

    const found = [];
    FileMonitor.scanAllProjects(
      projectsDir,
      (filePath) => found.push(path.resolve(filePath)),
      () => {},
      { recursive: true }
    );

    const foundSet = new Set(found);
    assert.equal(foundSet.has(path.resolve(path.join(projectA, 'root.jsonl'))), true);
    assert.equal(foundSet.has(path.resolve(path.join(nestedDir, 'agent.jsonl'))), true);
    assert.equal(
      foundSet.has(path.resolve(path.join(nestedDir, 'skip.jsonl.deleted.1234'))),
      false
    );
  });
});

run('getRecentSessionFiles supports recursive lookup', () => {
  withTempDir((tmpRoot) => {
    const projectDir = path.join(tmpRoot, 'project');
    const nestedDir = path.join(projectDir, 'uuid', 'subagents');

    fs.mkdirSync(nestedDir, { recursive: true });
    const nestedFile = path.join(nestedDir, 'agent.jsonl');
    fs.writeFileSync(nestedFile, '{}\n');

    const recent = FileMonitor.getRecentSessionFiles(projectDir, {
      maxAgeMs: 60_000,
      maxCount: 10,
      recursive: true
    }).map(p => path.resolve(p));

    assert.equal(recent.includes(path.resolve(nestedFile)), true);
  });
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

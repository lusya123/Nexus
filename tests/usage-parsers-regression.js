import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseUsageEvent as parseCodexUsage } from '../server/parsers/codex.js';
import { parseUsageEvent as parseClaudeUsage } from '../server/parsers/claude-code.js';
import { parseUsageEvent as parseOpenClawUsage } from '../server/parsers/openclaw.js';
import { getProjectName as getOpenClawProjectName } from '../server/parsers/openclaw.js';

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

run('codex parser extracts turn_context model', () => {
  const line = JSON.stringify({
    type: 'turn_context',
    payload: { model: 'gpt-5.3-codex' }
  });
  assert.deepEqual(parseCodexUsage(line), {
    kind: 'model',
    model: 'gpt-5.3-codex'
  });
});

run('codex parser extracts token_count snapshot usage', () => {
  const line = JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 20,
          reasoning_output_tokens: 7,
          total_tokens: 120
        }
      }
    }
  });
  assert.deepEqual(parseCodexUsage(line), {
    kind: 'snapshot',
    tokens: {
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 7,
      totalTokens: 120
    }
  });
});

run('claude parser extracts usage event and dedupe key from message.id', () => {
  const line = JSON.stringify({
    uuid: 'fallback-uuid',
    message: {
      id: 'msg_123',
      model: 'claude-opus-4.6',
      usage: {
        input_tokens: 1000,
        output_tokens: 55,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20
      }
    }
  });
  assert.deepEqual(parseClaudeUsage(line), {
    kind: 'delta',
    eventKey: 'msg_123',
    model: 'claude-opus-4.6',
    tokens: {
      inputTokens: 1000,
      outputTokens: 55,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 20
    }
  });
});

run('openclaw parser extracts usage and direct cost', () => {
  const line = JSON.stringify({
    type: 'message',
    id: 'outer-msg',
    message: {
      id: 'inner-msg',
      model: 'gpt-5.3-codex',
      usage: {
        input: 500,
        output: 30,
        cacheRead: 100,
        cacheWrite: 10,
        totalTokens: 640,
        cost: { total: 0.00123 }
      }
    }
  });
  assert.deepEqual(parseOpenClawUsage(line), {
    kind: 'delta',
    eventKey: 'inner-msg',
    model: 'gpt-5.3-codex',
    directCostUsd: 0.00123,
    tokens: {
      inputTokens: 500,
      outputTokens: 30,
      cacheReadInputTokens: 100,
      cacheWriteTokens: 10,
      totalTokens: 640
    }
  });
});

run('openclaw project name prefers session cwd basename over agent folder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-openclaw-'));
  const sessionPath = path.join(tmpDir, 'session.jsonl');
  fs.writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: 'session', id: 's1', cwd: '/Users/alice/work/my-repo' })}\n`,
    'utf8'
  );

  const name = getOpenClawProjectName('/Users/alice/.openclaw/agents/May/sessions', sessionPath);
  assert.equal(name, 'my-repo');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

run('openclaw project name falls back to agent folder when header missing', () => {
  const name = getOpenClawProjectName('/Users/alice/.openclaw/agents/May/sessions', '/tmp/missing.jsonl');
  assert.equal(name, 'May');
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

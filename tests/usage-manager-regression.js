import assert from 'assert';

import * as UsageManager from '../server/usage/usage-manager.js';

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
    UsageManager.__resetForTests();
    fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function fakeCost(model, tokens) {
  if (!model) return null;
  const total = Number(tokens?.totalTokens || 0);
  return total / 1_000_000;
}

run('snapshot mode keeps max codex snapshot', () => {
  const sessionId = 'codex-session';
  const tool = 'codex';

  const first = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'snapshot',
      tokens: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
        totalTokens: 130
      }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(first, true);

  const second = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'snapshot',
      tokens: {
        inputTokens: 90,
        cachedInputTokens: 10,
        outputTokens: 20,
        totalTokens: 110
      }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(second, false);

  const third = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'snapshot',
      tokens: {
        inputTokens: 300,
        cachedInputTokens: 40,
        outputTokens: 50,
        totalTokens: 350
      }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(third, true);

  const totals = UsageManager.getUsageTotals();
  assert.equal(totals.byTool.codex.totalTokens, 390); // totalTokens + cachedInputTokens
});

run('delta mode dedupes and updates by event key', () => {
  const sessionId = 'claude-session';
  const tool = 'claude-code';

  const first = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'delta',
      eventKey: 'msg_1',
      model: 'claude-opus-4.6',
      tokens: { inputTokens: 100, outputTokens: 10 }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(first, true);

  const duplicate = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'delta',
      eventKey: 'msg_1',
      model: 'claude-opus-4.6',
      tokens: { inputTokens: 100, outputTokens: 10 }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(duplicate, false);

  const update = UsageManager.ingestUsageEvent({
    sessionId,
    tool,
    event: {
      kind: 'delta',
      eventKey: 'msg_1',
      model: 'claude-opus-4.6',
      tokens: { inputTokens: 120, outputTokens: 15 }
    },
    calculateCostUsd: fakeCost
  });
  assert.equal(update, true);

  const totals = UsageManager.getUsageTotals();
  assert.equal(totals.byTool['claude-code'].totalTokens, 135);
});

run('running agent count tracks active + idle states', () => {
  const changed = UsageManager.syncLiveSessions([
    { sessionId: 's1', tool: 'codex', state: 'active' },
    { sessionId: 's2', tool: 'claude-code', state: 'idle' },
    { sessionId: 's3', tool: 'openclaw', state: 'cooling' }
  ]);
  assert.equal(changed, true);

  const totals = UsageManager.getUsageTotals();
  assert.equal(totals.totals.runningAgents, 2);
  assert.equal(totals.byTool.codex.runningAgents, 1);
  assert.equal(totals.byTool['claude-code'].runningAgents, 1);
  assert.equal(totals.byTool.openclaw.runningAgents, 0);
});

run('unknown model has token accumulation but zero computed cost', () => {
  UsageManager.ingestUsageEvent({
    sessionId: 'unknown-model',
    tool: 'claude-code',
    event: {
      kind: 'delta',
      eventKey: 'msg_1',
      model: 'some-unknown-model',
      tokens: { inputTokens: 1000, outputTokens: 500 }
    },
    calculateCostUsd: () => null
  });

  const totals = UsageManager.getUsageTotals();
  assert.equal(totals.byTool['claude-code'].totalTokens, 1500);
  assert.equal(totals.byTool['claude-code'].totalCostUsd, 0);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}


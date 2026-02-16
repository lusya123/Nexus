import assert from 'assert';

import * as ExternalUsageService from '../server/usage/external-usage-service.js';

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
    ExternalUsageService.__resetForTests();
    fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

run('applyExternalUsageOverrides replaces claude/codex totals only', () => {
  const base = {
    scope: 'all_history',
    totals: {
      runningAgents: 3,
      totalTokens: 1000,
      totalCostUsd: 10
    },
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 1, runningAgents: 1 },
      'claude-code': { totalTokens: 200, totalCostUsd: 2, runningAgents: 1 },
      openclaw: { totalTokens: 300, totalCostUsd: 3, runningAgents: 1 }
    },
    backfill: { status: 'done', scannedFiles: 1, totalFiles: 1 },
    updatedAt: 123
  };

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 900, totalCostUsd: 9.5, source: 'ccusage' },
    codex: { totalTokens: 800, totalCostUsd: 8.25, source: '@ccusage/codex' },
    updatedAt: 456
  });

  const merged = ExternalUsageService.applyExternalUsageOverrides(base);

  assert.equal(merged.byTool['claude-code'].totalTokens, 900);
  assert.equal(merged.byTool['claude-code'].totalCostUsd, 9.5);
  assert.equal(merged.byTool.codex.totalTokens, 800);
  assert.equal(merged.byTool.codex.totalCostUsd, 8.25);

  assert.equal(merged.byTool.openclaw.totalTokens, 300);
  assert.equal(merged.byTool.openclaw.totalCostUsd, 3);
  assert.equal(merged.totals.runningAgents, 3);

  assert.equal(merged.totals.totalTokens, 2000);
  assert.equal(merged.totals.totalCostUsd, 20.75);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

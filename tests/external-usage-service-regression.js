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

run('live overlay baseline does not reset when only external updatedAt changes', () => {
  const base = {
    scope: 'all_history',
    totals: {
      runningAgents: 1,
      totalTokens: 1000,
      totalCostUsd: 30
    },
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 10, runningAgents: 1 },
      'claude-code': { totalTokens: 100, totalCostUsd: 10, runningAgents: 0 },
      openclaw: { totalTokens: 100, totalCostUsd: 10, runningAgents: 0 }
    },
    backfill: { status: 'done', scannedFiles: 1, totalFiles: 1 },
    updatedAt: 123
  };

  const liveA = {
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 80, runningAgents: 1 },
      'claude-code': { totalTokens: 50, totalCostUsd: 40, runningAgents: 0 }
    }
  };
  const liveB = {
    byTool: {
      codex: { totalTokens: 160, totalCostUsd: 130, runningAgents: 1 },
      'claude-code': { totalTokens: 100, totalCostUsd: 70, runningAgents: 0 }
    }
  };

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 3900, totalCostUsd: 2450, source: 'ccusage' },
    codex: { totalTokens: 4900, totalCostUsd: 2550, source: '@ccusage/codex' },
    updatedAt: 1000
  });

  ExternalUsageService.applyExternalUsageOverrides(base, liveA);
  const withDelta = ExternalUsageService.applyExternalUsageOverrides(base, liveB);

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 3900, totalCostUsd: 2450, source: 'ccusage' },
    codex: { totalTokens: 4900, totalCostUsd: 2550, source: '@ccusage/codex' },
    updatedAt: 2000
  });

  const afterTimestampOnlyRefresh = ExternalUsageService.applyExternalUsageOverrides(base, liveB);
  assert.equal(afterTimestampOnlyRefresh.byTool.codex.totalCostUsd, withDelta.byTool.codex.totalCostUsd);
  assert.equal(
    afterTimestampOnlyRefresh.byTool['claude-code'].totalCostUsd,
    withDelta.byTool['claude-code'].totalCostUsd
  );
});

run('live overlay delta stays monotonic within same external snapshot', () => {
  const base = {
    scope: 'all_history',
    totals: {
      runningAgents: 1,
      totalTokens: 1000,
      totalCostUsd: 30
    },
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 10, runningAgents: 1 },
      'claude-code': { totalTokens: 100, totalCostUsd: 10, runningAgents: 0 },
      openclaw: { totalTokens: 100, totalCostUsd: 10, runningAgents: 0 }
    },
    backfill: { status: 'done', scannedFiles: 1, totalFiles: 1 },
    updatedAt: 123
  };

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 3900, totalCostUsd: 2450, source: 'ccusage' },
    codex: { totalTokens: 4900, totalCostUsd: 2550, source: '@ccusage/codex' },
    updatedAt: 1000
  });

  ExternalUsageService.applyExternalUsageOverrides(base, {
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 80, runningAgents: 1 },
      'claude-code': { totalTokens: 50, totalCostUsd: 40, runningAgents: 0 }
    }
  });

  const high = ExternalUsageService.applyExternalUsageOverrides(base, {
    byTool: {
      codex: { totalTokens: 200, totalCostUsd: 160, runningAgents: 1 },
      'claude-code': { totalTokens: 120, totalCostUsd: 90, runningAgents: 0 }
    }
  });

  const lowerLive = ExternalUsageService.applyExternalUsageOverrides(base, {
    byTool: {
      codex: { totalTokens: 150, totalCostUsd: 120, runningAgents: 1 },
      'claude-code': { totalTokens: 90, totalCostUsd: 70, runningAgents: 0 }
    }
  });

  assert.equal(lowerLive.totals.totalCostUsd, high.totals.totalCostUsd);
  assert.equal(lowerLive.byTool.codex.totalCostUsd, high.byTool.codex.totalCostUsd);
  assert.equal(lowerLive.byTool['claude-code'].totalCostUsd, high.byTool['claude-code'].totalCostUsd);
});

run('all-history totals can correct downward when external snapshot is lower', () => {
  const base = {
    scope: 'all_history',
    totals: {
      runningAgents: 1,
      totalTokens: 1000,
      totalCostUsd: 100
    },
    byTool: {
      codex: { totalTokens: 100, totalCostUsd: 20, runningAgents: 1 },
      'claude-code': { totalTokens: 100, totalCostUsd: 70, runningAgents: 0 },
      openclaw: { totalTokens: 100, totalCostUsd: 10, runningAgents: 0 }
    },
    backfill: { status: 'done', scannedFiles: 1, totalFiles: 1 },
    updatedAt: 123
  };

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 5000, totalCostUsd: 2000, source: 'ccusage' },
    codex: { totalTokens: 5000, totalCostUsd: 1000, source: '@ccusage/codex' },
    updatedAt: 1000
  });
  const high = ExternalUsageService.applyExternalUsageOverrides(base, { byTool: {} });

  ExternalUsageService.__setExternalUsageForTests({
    claudeCode: { totalTokens: 4000, totalCostUsd: 1500, source: 'ccusage' },
    codex: { totalTokens: 4000, totalCostUsd: 900, source: '@ccusage/codex' },
    updatedAt: 2000
  });
  const lower = ExternalUsageService.applyExternalUsageOverrides(base, { byTool: {} });

  assert.equal(lower.totals.totalCostUsd < high.totals.totalCostUsd, true);
  assert.equal(lower.byTool['claude-code'].totalCostUsd < high.byTool['claude-code'].totalCostUsd, true);
  assert.equal(lower.byTool.codex.totalCostUsd < high.byTool.codex.totalCostUsd, true);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

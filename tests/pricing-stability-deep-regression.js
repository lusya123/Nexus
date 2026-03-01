import assert from 'assert';

import * as ExternalUsageService from '../server/usage/external-usage-service.js';

function createBaseTotals() {
  return {
    scope: 'all_history',
    totals: {
      runningAgents: 1,
      totalTokens: 0,
      totalCostUsd: 0
    },
    byTool: {
      codex: { totalTokens: 0, totalCostUsd: 0, runningAgents: 1 },
      'claude-code': { totalTokens: 0, totalCostUsd: 0, runningAgents: 0 },
      openclaw: { totalTokens: 0, totalCostUsd: 0, runningAgents: 0 }
    },
    backfill: { status: 'done', scannedFiles: 0, totalFiles: 0 },
    updatedAt: 1
  };
}

function createRng(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

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

run('deep stability: no cost drop within same external snapshot', () => {
  const rng = createRng(20260301);
  const base = createBaseTotals();

  const snapshot = {
    claudeCost: 2000,
    codexCost: 500,
    claudeTokens: 2_000_000,
    codexTokens: 500_000,
    updatedAt: 1000
  };

  let liveCodex = 0;
  let liveClaude = 0;
  let previousTotal = null;
  let previousSnapshotKey = `${snapshot.claudeCost}:${snapshot.codexCost}`;
  let decreasesWithinSameSnapshot = 0;
  let decreasesAcrossSnapshots = 0;

  for (let i = 0; i < 4000; i += 1) {
    liveCodex = Math.max(0, liveCodex + randInt(rng, -12, 20));
    liveClaude = Math.max(0, liveClaude + randInt(rng, -8, 14));

    // Frequent updatedAt-only changes (same snapshot content)
    if (rng() < 0.2) {
      snapshot.updatedAt += randInt(rng, 1, 30);
    }

    // Occasional external snapshot re-computes (up/down)
    if (rng() < 0.09) {
      const direction = rng() < 0.7 ? 1 : -1;
      snapshot.claudeCost = Math.max(100, Number((snapshot.claudeCost + direction * randInt(rng, 1, 25)).toFixed(6)));
      snapshot.codexCost = Math.max(20, Number((snapshot.codexCost + direction * randInt(rng, 1, 12)).toFixed(6)));
      snapshot.claudeTokens = Math.max(100_000, snapshot.claudeTokens + direction * randInt(rng, 1000, 45000));
      snapshot.codexTokens = Math.max(20_000, snapshot.codexTokens + direction * randInt(rng, 500, 13000));
      snapshot.updatedAt += randInt(rng, 1, 60);
    }

    ExternalUsageService.__setExternalUsageForTests({
      claudeCode: { totalTokens: snapshot.claudeTokens, totalCostUsd: snapshot.claudeCost, source: 'ccusage' },
      codex: { totalTokens: snapshot.codexTokens, totalCostUsd: snapshot.codexCost, source: '@ccusage/codex' },
      updatedAt: snapshot.updatedAt
    });

    const merged = ExternalUsageService.applyExternalUsageOverrides(base, {
      byTool: {
        codex: { totalTokens: liveCodex * 100, totalCostUsd: liveCodex, runningAgents: 1 },
        'claude-code': { totalTokens: liveClaude * 80, totalCostUsd: liveClaude, runningAgents: 1 }
      }
    });

    const total = Number(merged.totals.totalCostUsd || 0);
    const snapshotKey = `${snapshot.claudeCost}:${snapshot.codexCost}`;

    if (previousTotal !== null && snapshotKey === previousSnapshotKey && total + 1e-9 < previousTotal) {
      decreasesWithinSameSnapshot += 1;
    }

    if (previousTotal !== null && snapshotKey !== previousSnapshotKey && total + 1e-9 < previousTotal) {
      decreasesAcrossSnapshots += 1;
    }

    previousTotal = total;
    previousSnapshotKey = snapshotKey;
  }

  assert.equal(decreasesWithinSameSnapshot, 0);
  assert.equal(decreasesAcrossSnapshots > 0, true);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

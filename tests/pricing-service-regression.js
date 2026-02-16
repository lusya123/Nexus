import assert from 'assert';

import * as PricingService from '../server/usage/pricing-service.js';

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
    PricingService.__resetForTests();
    fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

run('fallback pricing resolves claude date-suffixed model', () => {
  const pricing = PricingService.getModelPricing('claude-opus-4-5-20251101');
  assert.equal(Boolean(pricing), true);
  assert.equal(pricing.inputPerMillion, 15);
  assert.equal(pricing.outputPerMillion, 75);
});

run('fallback pricing resolves claude thinking variant', () => {
  const pricing = PricingService.getModelPricing('claude-sonnet-4-5-thinking');
  assert.equal(Boolean(pricing), true);
  assert.equal(pricing.inputPerMillion, 3);
  assert.equal(pricing.outputPerMillion, 15);
});

run('fallback pricing resolves dashed and dotted version aliases', () => {
  const dashed = PricingService.getModelPricing('claude-opus-4-6');
  const dotted = PricingService.getModelPricing('claude-opus-4.6');
  assert.equal(Boolean(dashed), true);
  assert.equal(Boolean(dotted), true);
  assert.equal(dashed.inputPerMillion, dotted.inputPerMillion);
  assert.equal(dashed.outputPerMillion, dotted.outputPerMillion);
});

run('fallback pricing resolves provider-prefixed model names', () => {
  const pricing = PricingService.getModelPricing('anthropic/claude-haiku-4-5-20251001');
  assert.equal(Boolean(pricing), true);
  assert.equal(pricing.inputPerMillion, 1);
  assert.equal(pricing.outputPerMillion, 5);
});

run('calculateCostUsd produces non-zero claude cost offline', () => {
  const cost = PricingService.calculateCostUsd('claude-opus-4-6', {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadInputTokens: 500_000,
    cacheCreationInputTokens: 200_000
  });

  assert.equal(typeof cost, 'number');
  assert.equal(cost > 0, true);
});

console.log('---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

import fs from 'fs';
import path from 'path';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(process.cwd(), '.nexus-runtime', 'pricing-cache.json');

const REMOTE_PRICING_URLS = [
  'https://ccusage.com/api/model-prices.json',
  'https://ccusage.com/api/pricing.json',
  'https://raw.githubusercontent.com/ryoppippi/ccusage/main/packages/core/src/data/model-prices.json'
];

const FALLBACK_PRICING = {
  // Derived from observed OpenClaw usage logs on this machine.
  'gpt-5.3-codex': {
    inputPerMillion: 1.75,
    outputPerMillion: 14,
    cacheReadPerMillion: 0.175
  },
  'gpt-5-codex': {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
    cacheReadPerMillion: 0.125
  }
};

let pricingTable = normalizePricingTable(FALLBACK_PRICING);
let lastFetchedAt = 0;
let refreshPromise = null;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const inputPerMillion = firstFinite(raw, [
    'inputPerMillion',
    'input_per_million',
    'input',
    'prompt',
    'prompt_per_million'
  ]);
  const outputPerMillion = firstFinite(raw, [
    'outputPerMillion',
    'output_per_million',
    'output',
    'completion',
    'completion_per_million'
  ]);
  const cachedInputPerMillion = firstFinite(raw, [
    'cachedInputPerMillion',
    'cached_input_per_million',
    'cached_input',
    'cached'
  ]);
  const cacheReadPerMillion = firstFinite(raw, [
    'cacheReadPerMillion',
    'cache_read_per_million',
    'cache_read'
  ]);
  const cacheWritePerMillion = firstFinite(raw, [
    'cacheWritePerMillion',
    'cache_write_per_million',
    'cache_write'
  ]);
  const reasoningOutputPerMillion = firstFinite(raw, [
    'reasoningOutputPerMillion',
    'reasoning_output_per_million',
    'reasoning_output'
  ]);

  if (
    inputPerMillion === null &&
    outputPerMillion === null &&
    cachedInputPerMillion === null &&
    cacheReadPerMillion === null &&
    cacheWritePerMillion === null &&
    reasoningOutputPerMillion === null
  ) {
    return null;
  }

  return {
    inputPerMillion: inputPerMillion ?? 0,
    outputPerMillion: outputPerMillion ?? 0,
    cachedInputPerMillion: cachedInputPerMillion ?? 0,
    cacheReadPerMillion: cacheReadPerMillion ?? 0,
    cacheWritePerMillion: cacheWritePerMillion ?? 0,
    reasoningOutputPerMillion: reasoningOutputPerMillion ?? 0
  };
}

function firstFinite(raw, keys) {
  for (const key of keys) {
    if (!(key in raw)) continue;
    const n = toFiniteNumber(raw[key]);
    if (n !== null) return n;
  }
  return null;
}

function normalizePricingTable(data) {
  const table = new Map();

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const model = String(item.model || item.modelName || item.name || '').trim().toLowerCase();
      if (!model) continue;
      const entry = normalizeEntry(item);
      if (entry) table.set(model, entry);
    }
    return table;
  }

  if (data && typeof data === 'object') {
    if (Array.isArray(data.models)) {
      return normalizePricingTable(data.models);
    }

    for (const [model, value] of Object.entries(data)) {
      if (!model) continue;
      const entry = normalizeEntry(value);
      if (entry) table.set(String(model).trim().toLowerCase(), entry);
    }
  }

  return table;
}

function getModelAliases(modelName) {
  const raw = String(modelName || '').trim().toLowerCase();
  if (!raw) return [];

  const aliases = new Set([raw]);
  aliases.add(raw.replace(/-20\d{6,}$/g, ''));
  aliases.add(raw.replace(/-(\d)-(\d)(?=-|$)/g, '.$2'));

  return Array.from(aliases).filter(Boolean);
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;

    const fetchedAt = toFiniteNumber(raw.fetchedAt);
    const data = raw.pricingTable;
    if (!data) return null;

    const table = normalizePricingTable(data);
    if (table.size === 0) return null;

    return { fetchedAt: fetchedAt ?? 0, table };
  } catch {
    return null;
  }
}

function writeCache(table, fetchedAt) {
  try {
    const dir = path.dirname(CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      fetchedAt,
      pricingTable: Object.fromEntries(table.entries())
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  } catch {
    // Ignore cache write failures; service remains functional.
  }
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`status_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemotePricing() {
  for (const url of REMOTE_PRICING_URLS) {
    try {
      const data = await fetchWithTimeout(url);
      const table = normalizePricingTable(data);
      if (table.size > 0) {
        return { table, fetchedAt: Date.now() };
      }
    } catch {
      // Try the next URL.
    }
  }

  return null;
}

export function getModelPricing(modelName) {
  if (!modelName) return null;

  for (const alias of getModelAliases(modelName)) {
    const entry = pricingTable.get(alias);
    if (entry) return entry;
  }

  return null;
}

export function calculateCostUsd(modelName, tokens = {}) {
  const pricing = getModelPricing(modelName);
  if (!pricing) return null;

  const inputTokens = Number(tokens.inputTokens || 0);
  const outputTokens = Number(tokens.outputTokens || 0);
  const cachedInputTokens = Number(tokens.cachedInputTokens || 0);
  const cacheReadInputTokens = Number(tokens.cacheReadInputTokens || 0);
  const cacheCreationInputTokens = Number(tokens.cacheCreationInputTokens || 0);
  const cacheWriteTokens = Number(tokens.cacheWriteTokens || 0);

  let total = 0;
  total += (inputTokens * pricing.inputPerMillion) / 1_000_000;
  total += (outputTokens * pricing.outputPerMillion) / 1_000_000;

  const cachedInputRate = pricing.cachedInputPerMillion || pricing.cacheReadPerMillion || 0;
  total += (cachedInputTokens * cachedInputRate) / 1_000_000;

  total += (cacheReadInputTokens * (pricing.cacheReadPerMillion || cachedInputRate || 0)) / 1_000_000;
  total += (cacheCreationInputTokens * (pricing.cacheWritePerMillion || pricing.inputPerMillion || 0)) / 1_000_000;
  total += (cacheWriteTokens * (pricing.cacheWritePerMillion || pricing.inputPerMillion || 0)) / 1_000_000;

  return Number.isFinite(total) ? total : null;
}

export function getPricingMeta() {
  return {
    fetchedAt: lastFetchedAt,
    cachePath: CACHE_PATH,
    modelCount: pricingTable.size
  };
}

export async function refreshPricingInBackground({ force = false } = {}) {
  const now = Date.now();
  if (!force && lastFetchedAt > 0 && (now - lastFetchedAt) < CACHE_TTL_MS) {
    return false;
  }

  if (refreshPromise) {
    await refreshPromise;
    return false;
  }

  refreshPromise = (async () => {
    const remote = await fetchRemotePricing();
    if (!remote) return false;

    pricingTable = remote.table;
    lastFetchedAt = remote.fetchedAt;
    writeCache(pricingTable, lastFetchedAt);
    return true;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function initPricingService() {
  const cached = readCache();
  if (cached && cached.table.size > 0) {
    pricingTable = cached.table;
    lastFetchedAt = cached.fetchedAt;
  }

  refreshPricingInBackground().catch(() => {});
}

export function __resetForTests() {
  pricingTable = normalizePricingTable(FALLBACK_PRICING);
  lastFetchedAt = 0;
  refreshPromise = null;
}


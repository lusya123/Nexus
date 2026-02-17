import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

import { logger } from '../utils/logger.js';

const REFRESH_MIN_INTERVAL_MS = 60 * 1000;
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
const PRICING_HISTORY_COMMITS_TTL_MS = 60 * 60 * 1000;
const PRICING_HISTORY_LOOKBACK_DAYS = 730;
const PRICING_HISTORY_BUCKET_MS = 24 * 60 * 60 * 1000;
const PRICING_HISTORY_MAX_PAGES = 12;
const PRICING_HISTORY_PER_PAGE = 100;
const PRICING_HISTORY_ENTRY_CACHE_MAX = 24;
const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const LITELLM_PRICING_HISTORY_COMMITS_URL =
  'https://api.github.com/repos/BerriAI/litellm/commits';
const LITELLM_PRICING_RAW_BY_SHA_URL_PREFIX =
  'https://raw.githubusercontent.com/BerriAI/litellm';
const PRICING_CACHE_PATH = path.join(process.cwd(), '.nexus-runtime', 'litellm-pricing-cache.json');
const EXTERNAL_USAGE_CACHE_PATH = path.join(process.cwd(), '.nexus-runtime', 'external-usage-cache.json');

const CLAUDE_PROVIDER_PREFIXES = [
  'anthropic/',
  'claude-3-5-',
  'claude-3-',
  'claude-',
  'openai/',
  'azure/',
  'openrouter/openai/'
];

const CODEX_PROVIDER_PREFIXES = ['openai/', 'azure/', 'openrouter/openai/'];
const CODEX_MODEL_ALIASES = new Map([['gpt-5-codex', 'gpt-5']]);
const LEGACY_CODEX_FALLBACK_MODEL = 'gpt-5';
const DEFAULT_TIERED_THRESHOLD = 200_000;

const EMPTY_EXTERNAL = {
  claudeCode: null,
  codex: null,
  updatedAt: 0,
  lastError: null
};

const FALLBACK_PRICING = {
  'gpt-5': {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1.25e-7
  },
  'gpt-5-mini': {
    input_cost_per_token: 2.5e-7,
    output_cost_per_token: 2e-6,
    cache_read_input_token_cost: 2.5e-8
  },
  'claude-opus-4-1': {
    input_cost_per_token: 1.5e-5,
    output_cost_per_token: 7.5e-5,
    cache_creation_input_token_cost: 1.875e-5,
    cache_read_input_token_cost: 1.5e-6
  },
  'claude-sonnet-4': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_creation_input_token_cost: 3.75e-6,
    cache_read_input_token_cost: 3e-7
  },
  'claude-haiku-4': {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 5e-6,
    cache_creation_input_token_cost: 1.25e-6,
    cache_read_input_token_cost: 1e-7
  }
};

let externalUsage = { ...EMPTY_EXTERNAL };
let refreshPromise = null;
let lastAttemptAt = 0;

let pricingState = {
  fetchedAt: 0,
  entries: normalizePricingEntries(FALLBACK_PRICING)
};

let pricingHistoryState = {
  fetchedAt: 0,
  commits: []
};
let pricingHistoryRefreshPromise = null;
const pricingEntriesBySha = new Map();
const pricingEntriesFetchPromisesBySha = new Map();

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(6));
}

function normalizeUsageSummary(value, sourceFallback) {
  if (!value || typeof value !== 'object') return null;
  const totalTokens = Math.round(Number(value.totalTokens || 0));
  const totalCostUsd = roundCost(value.totalCostUsd || 0);
  if (!Number.isFinite(totalTokens) || !Number.isFinite(totalCostUsd)) return null;
  return {
    totalTokens: Math.max(0, totalTokens),
    totalCostUsd: Math.max(0, totalCostUsd),
    source: value.source ? String(value.source) : sourceFallback
  };
}

function readExternalUsageCacheFromDisk() {
  try {
    if (!fs.existsSync(EXTERNAL_USAGE_CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(EXTERNAL_USAGE_CACHE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    const claudeCode = normalizeUsageSummary(raw.claudeCode, 'ccusage');
    const codex = normalizeUsageSummary(raw.codex, '@ccusage/codex');
    if (!claudeCode && !codex) return null;
    return {
      claudeCode,
      codex,
      updatedAt: toFiniteNumber(raw.updatedAt) ?? Date.now(),
      lastError: null
    };
  } catch {
    return null;
  }
}

function writeExternalUsageCacheToDisk(snapshot) {
  try {
    const dir = path.dirname(EXTERNAL_USAGE_CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      EXTERNAL_USAGE_CACHE_PATH,
      JSON.stringify(
        {
          claudeCode: snapshot?.claudeCode || null,
          codex: snapshot?.codex || null,
          updatedAt: snapshot?.updatedAt || Date.now()
        },
        null,
        2
      )
    );
  } catch {
    // cache write failures should not break runtime behavior
  }
}

function normalizePricingEntries(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object') return out;

  for (const [modelName, value] of Object.entries(raw)) {
    if (!modelName || !value || typeof value !== 'object') continue;
    out.set(String(modelName).trim().toLowerCase(), value);
  }
  return out;
}

function readPricingCacheFromDisk() {
  try {
    if (!fs.existsSync(PRICING_CACHE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(PRICING_CACHE_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const fetchedAt = toFiniteNumber(parsed.fetchedAt);
    const entries = normalizePricingEntries(parsed.entries);
    if (entries.size === 0) return null;
    return {
      fetchedAt: fetchedAt ?? 0,
      entries
    };
  } catch {
    return null;
  }
}

function writePricingCacheToDisk(entries, fetchedAt) {
  try {
    const dir = path.dirname(PRICING_CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      PRICING_CACHE_PATH,
      JSON.stringify(
        {
          fetchedAt,
          entries: Object.fromEntries(entries.entries())
        },
        null,
        2
      )
    );
  } catch {
    // cache write failures should not break runtime behavior
  }
}

async function fetchLiteLLMPricing() {
  const response = await fetch(LITELLM_PRICING_URL);
  if (!response.ok) {
    throw new Error(`pricing_fetch_status_${response.status}`);
  }
  const raw = await response.json();
  const entries = normalizePricingEntries(raw);
  if (entries.size === 0) {
    throw new Error('pricing_empty_dataset');
  }
  return {
    fetchedAt: Date.now(),
    entries
  };
}

async function ensurePricingEntries() {
  const now = Date.now();
  if ((now - pricingState.fetchedAt) < PRICING_CACHE_TTL_MS && pricingState.entries.size > 0) {
    return pricingState.entries;
  }

  try {
    const remote = await fetchLiteLLMPricing();
    pricingState = remote;
    writePricingCacheToDisk(remote.entries, remote.fetchedAt);
    return pricingState.entries;
  } catch {
    const cached = readPricingCacheFromDisk();
    if (cached) {
      pricingState = cached;
      return pricingState.entries;
    }
    return pricingState.entries;
  }
}

function toTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Handle Unix seconds and milliseconds.
    return value >= 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isoDateFromMs(value) {
  if (!Number.isFinite(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

async function fetchLiteLLMPricingCommitsSince(sinceMs) {
  const out = [];
  const sinceIso = isoDateFromMs(sinceMs);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Nexus'
  };

  for (let page = 1; page <= PRICING_HISTORY_MAX_PAGES; page += 1) {
    const url = new URL(LITELLM_PRICING_HISTORY_COMMITS_URL);
    url.searchParams.set('path', 'model_prices_and_context_window.json');
    url.searchParams.set('per_page', String(PRICING_HISTORY_PER_PAGE));
    url.searchParams.set('page', String(page));
    if (sinceIso) url.searchParams.set('since', sinceIso);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`pricing_history_commits_status_${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      const sha = asNonEmptyString(row?.sha);
      const committedAt = toTimestampMs(row?.commit?.committer?.date);
      if (!sha || !Number.isFinite(committedAt)) continue;
      out.push({ sha, committedAt });
    }

    if (rows.length < PRICING_HISTORY_PER_PAGE) break;
  }

  out.sort((a, b) => a.committedAt - b.committedAt);

  // Keep one snapshot per UTC day (the latest commit in that day).
  const daily = new Map();
  for (const item of out) {
    const day = new Date(item.committedAt).toISOString().slice(0, 10);
    daily.set(day, item);
  }

  return Array.from(daily.values()).sort((a, b) => a.committedAt - b.committedAt);
}

async function ensurePricingHistoryCommits() {
  const now = Date.now();
  if (
    pricingHistoryState.commits.length > 0 &&
    (now - pricingHistoryState.fetchedAt) < PRICING_HISTORY_COMMITS_TTL_MS
  ) {
    return pricingHistoryState.commits;
  }

  if (pricingHistoryRefreshPromise) return pricingHistoryRefreshPromise;

  pricingHistoryRefreshPromise = (async () => {
    const lookbackMs = now - (PRICING_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    try {
      const commits = await fetchLiteLLMPricingCommitsSince(lookbackMs);
      if (commits.length > 0) {
        pricingHistoryState = {
          fetchedAt: now,
          commits
        };
      } else {
        pricingHistoryState = {
          fetchedAt: now,
          commits: pricingHistoryState.commits
        };
      }
    } catch {
      pricingHistoryState = {
        fetchedAt: now,
        commits: pricingHistoryState.commits
      };
    }

    return pricingHistoryState.commits;
  })();

  try {
    return await pricingHistoryRefreshPromise;
  } finally {
    pricingHistoryRefreshPromise = null;
  }
}

function findCommitAtOrBefore(commits, timestampMs) {
  if (!Array.isArray(commits) || commits.length === 0 || !Number.isFinite(timestampMs)) return null;

  let low = 0;
  let high = commits.length - 1;
  let idx = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ts = commits[mid].committedAt;
    if (ts <= timestampMs) {
      idx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (timestampMs < commits[0].committedAt) return commits[0];
  return commits[idx] || commits[commits.length - 1];
}

async function fetchLiteLLMPricingBySha(sha) {
  const url = `${LITELLM_PRICING_RAW_BY_SHA_URL_PREFIX}/${encodeURIComponent(sha)}/model_prices_and_context_window.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`pricing_history_fetch_status_${response.status}`);
  }
  const raw = await response.json();
  const entries = normalizePricingEntries(raw);
  if (entries.size === 0) {
    throw new Error('pricing_history_empty_dataset');
  }
  return entries;
}

function touchPricingEntriesCache(sha, entries) {
  if (pricingEntriesBySha.has(sha)) {
    pricingEntriesBySha.delete(sha);
  }
  pricingEntriesBySha.set(sha, entries);

  while (pricingEntriesBySha.size > PRICING_HISTORY_ENTRY_CACHE_MAX) {
    const oldestKey = pricingEntriesBySha.keys().next().value;
    if (!oldestKey) break;
    pricingEntriesBySha.delete(oldestKey);
  }
}

async function ensurePricingEntriesBySha(sha) {
  if (!sha) return null;

  const cached = pricingEntriesBySha.get(sha);
  if (cached) {
    touchPricingEntriesCache(sha, cached);
    return cached;
  }

  const pending = pricingEntriesFetchPromisesBySha.get(sha);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const entries = await fetchLiteLLMPricingBySha(sha);
      touchPricingEntriesCache(sha, entries);
      return entries;
    } finally {
      pricingEntriesFetchPromisesBySha.delete(sha);
    }
  })();

  pricingEntriesFetchPromisesBySha.set(sha, promise);
  return promise;
}

function createHistoricalPricingResolver(currentEntries) {
  const commitByBucket = new Map();

  return async ({ modelName, timestampMs, providerPrefixes, aliasLookup = null }) => {
    let selectedEntries = currentEntries;

    if (Number.isFinite(timestampMs)) {
      const bucket = Math.floor(timestampMs / PRICING_HISTORY_BUCKET_MS);
      let commit = commitByBucket.get(bucket);

      if (commit === undefined) {
        const commits = await ensurePricingHistoryCommits();
        commit = findCommitAtOrBefore(commits, timestampMs);
        commitByBucket.set(bucket, commit || null);
      }

      if (commit?.sha) {
        try {
          const historicalEntries = await ensurePricingEntriesBySha(commit.sha);
          if (historicalEntries && historicalEntries.size > 0) {
            selectedEntries = historicalEntries;
          }
        } catch {
          // Keep current pricing as fallback when a historical snapshot fetch fails.
        }
      }
    }

    const historicalMatch = findModelPricing(selectedEntries, modelName, providerPrefixes, aliasLookup);
    if (historicalMatch) return historicalMatch;
    if (selectedEntries !== currentEntries) {
      return findModelPricing(currentEntries, modelName, providerPrefixes, aliasLookup);
    }
    return historicalMatch;
  };
}

function buildPricingCandidates(modelName, providerPrefixes) {
  const base = String(modelName || '').trim().toLowerCase();
  if (!base) return [];
  const candidates = new Set([base]);
  for (const prefix of providerPrefixes) {
    candidates.add(`${prefix}${base}`);
  }
  return Array.from(candidates);
}

function findModelPricing(entries, modelName, providerPrefixes, aliasLookup = null) {
  const rawModel = String(modelName || '').trim().toLowerCase();
  if (!rawModel) return null;

  const tryFind = (name) => {
    for (const candidate of buildPricingCandidates(name, providerPrefixes)) {
      const direct = entries.get(candidate);
      if (direct) return direct;
    }

    const lower = String(name).toLowerCase();
    for (const [key, value] of entries.entries()) {
      if (key.includes(lower) || lower.includes(key)) {
        return value;
      }
    }
    return null;
  };

  const direct = tryFind(rawModel);
  if (direct) return direct;

  if (aliasLookup && aliasLookup.has(rawModel)) {
    return tryFind(aliasLookup.get(rawModel));
  }

  return null;
}

function calculateTieredCost(tokenCount, basePrice, tieredPrice, threshold = DEFAULT_TIERED_THRESHOLD) {
  const tokens = toNumberOrZero(tokenCount);
  if (tokens <= 0) return 0;

  const base = toFiniteNumber(basePrice);
  const tier = toFiniteNumber(tieredPrice);

  if (tokens > threshold && tier !== null) {
    const belowThreshold = Math.min(tokens, threshold);
    const aboveThreshold = Math.max(0, tokens - threshold);
    return (base !== null ? belowThreshold * base : 0) + (aboveThreshold * tier);
  }

  return base !== null ? tokens * base : 0;
}

function calculateClaudeEntryCost(tokens, pricing) {
  if (!pricing || typeof pricing !== 'object') return 0;

  const inputCost = calculateTieredCost(
    tokens.input_tokens,
    pricing.input_cost_per_token,
    pricing.input_cost_per_token_above_200k_tokens
  );
  const outputCost = calculateTieredCost(
    tokens.output_tokens,
    pricing.output_cost_per_token,
    pricing.output_cost_per_token_above_200k_tokens
  );
  const cacheCreationCost = calculateTieredCost(
    tokens.cache_creation_input_tokens,
    pricing.cache_creation_input_token_cost,
    pricing.cache_creation_input_token_cost_above_200k_tokens
  );
  const cacheReadCost = calculateTieredCost(
    tokens.cache_read_input_tokens,
    pricing.cache_read_input_token_cost,
    pricing.cache_read_input_token_cost_above_200k_tokens
  );

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

function calculateCodexDeltaCost(delta, pricing) {
  if (!pricing || typeof pricing !== 'object') return 0;
  const input = toNumberOrZero(delta.inputTokens);
  const cachedInput = Math.min(toNumberOrZero(delta.cachedInputTokens), input);
  const nonCachedInput = Math.max(0, input - cachedInput);
  const output = toNumberOrZero(delta.outputTokens);

  const inputRate = toNumberOrZero(pricing.input_cost_per_token);
  const outputRate = toNumberOrZero(pricing.output_cost_per_token);
  const cachedRate = toFiniteNumber(pricing.cache_read_input_token_cost);
  const effectiveCachedRate = cachedRate !== null ? cachedRate : inputRate;

  return (nonCachedInput * inputRate) + (cachedInput * effectiveCachedRate) + (output * outputRate);
}

function isJsonlFile(name) {
  return String(name || '').endsWith('.jsonl');
}

function isDeletedJsonl(name) {
  return String(name || '').includes('.jsonl.deleted.');
}

function listJsonlFilesRecursively(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isJsonlFile(entry.name) || isDeletedJsonl(entry.name)) continue;
      out.push(fullPath);
    }
  }

  return out;
}

function getClaudeProjectsRoots() {
  const roots = [];
  const seen = new Set();
  const envPathsRaw = String(process.env.CLAUDE_CONFIG_DIR || '').trim();

  const addRootIfValid = (baseDir) => {
    const normalized = path.resolve(baseDir);
    if (seen.has(normalized)) return;
    const projectsDir = path.join(normalized, 'projects');
    if (!fs.existsSync(projectsDir)) return;
    try {
      if (!fs.statSync(projectsDir).isDirectory()) return;
    } catch {
      return;
    }
    seen.add(normalized);
    roots.push(projectsDir);
  };

  if (envPathsRaw) {
    const parts = envPathsRaw.split(',').map(p => p.trim()).filter(Boolean);
    for (const p of parts) addRootIfValid(p);
    return roots;
  }

  addRootIfValid(path.join(os.homedir(), '.config', 'claude'));
  addRootIfValid(path.join(os.homedir(), '.claude'));
  return roots;
}

function getCodexSessionsRoot() {
  const codexHome = String(process.env.CODEX_HOME || '').trim();
  const base = codexHome ? path.resolve(codexHome) : path.join(os.homedir(), '.codex');
  return path.join(base, 'sessions');
}

async function processFileByLine(filePath, onLine) {
  const input = createReadStream(filePath, { encoding: 'utf-8' });
  const reader = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY
  });

  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    await onLine(trimmed, lineNumber);
  }
}

function asNonEmptyString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractModelFromObject(value) {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value;
  const info = payload.info && typeof payload.info === 'object' ? payload.info : null;

  if (info) {
    const infoModel = asNonEmptyString(info.model) || asNonEmptyString(info.model_name);
    if (infoModel) return infoModel;
    if (info.metadata && typeof info.metadata === 'object') {
      const nested = asNonEmptyString(info.metadata.model);
      if (nested) return nested;
    }
  }

  const directModel = asNonEmptyString(payload.model);
  if (directModel) return directModel;

  if (payload.metadata && typeof payload.metadata === 'object') {
    const metadataModel = asNonEmptyString(payload.metadata.model);
    if (metadataModel) return metadataModel;
  }

  return undefined;
}

function normalizeCodexRawUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = value;
  const input = toNumberOrZero(usage.input_tokens);
  const cached = toNumberOrZero(usage.cached_input_tokens ?? usage.cache_read_input_tokens);
  const output = toNumberOrZero(usage.output_tokens);
  const reasoning = toNumberOrZero(usage.reasoning_output_tokens);
  const total = toNumberOrZero(usage.total_tokens);

  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output
  };
}

function subtractCodexRawUsage(current, previous) {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(
      current.cached_input_tokens - (previous?.cached_input_tokens ?? 0),
      0
    ),
    output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
    reasoning_output_tokens: Math.max(
      current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0),
      0
    ),
    total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0)
  };
}

function codexRawToDelta(raw) {
  const total = raw.total_tokens > 0 ? raw.total_tokens : (raw.input_tokens + raw.output_tokens);
  return {
    inputTokens: raw.input_tokens,
    cachedInputTokens: Math.min(raw.cached_input_tokens, raw.input_tokens),
    outputTokens: raw.output_tokens,
    reasoningOutputTokens: raw.reasoning_output_tokens,
    totalTokens: total
  };
}

async function computeClaudeCompatibleTotals(resolvePricingForEvent) {
  const roots = getClaudeProjectsRoots();
  const files = roots.flatMap(root => listJsonlFilesRecursively(root));

  const processedHashes = new Set();
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const filePath of files) {
    await processFileByLine(filePath, async (line) => {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }

      const usage = obj?.message?.usage;
      if (!usage || typeof usage !== 'object') return;
      const inputTokens = toNumberOrZero(usage.input_tokens);
      const outputTokens = toNumberOrZero(usage.output_tokens);
      const cacheCreationInputTokens = toNumberOrZero(usage.cache_creation_input_tokens);
      const cacheReadInputTokens = toNumberOrZero(usage.cache_read_input_tokens);

      const messageId = asNonEmptyString(obj?.message?.id);
      const requestId = asNonEmptyString(obj?.requestId);
      const uniqueHash = messageId && requestId ? `${messageId}:${requestId}` : null;
      if (uniqueHash && processedHashes.has(uniqueHash)) return;
      if (uniqueHash) processedHashes.add(uniqueHash);

      totalTokens += inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;

      const model = asNonEmptyString(obj?.message?.model);
      if (!model) return;
      const timestampMs = toTimestampMs(obj?.timestamp);
      const pricing = await resolvePricingForEvent({
        modelName: model,
        timestampMs,
        providerPrefixes: CLAUDE_PROVIDER_PREFIXES
      });
      totalCostUsd += calculateClaudeEntryCost(
        {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cache_read_input_tokens: cacheReadInputTokens
        },
        pricing
      );
    });
  }

  return {
    totalTokens: Math.round(totalTokens),
    totalCostUsd: roundCost(totalCostUsd),
    source: 'ccusage'
  };
}

async function computeCodexCompatibleTotals(resolvePricingForEvent) {
  const sessionsRoot = getCodexSessionsRoot();
  if (!fs.existsSync(sessionsRoot)) {
    return {
      totalTokens: 0,
      totalCostUsd: 0,
      source: '@ccusage/codex'
    };
  }

  const files = listJsonlFilesRecursively(sessionsRoot);
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const filePath of files) {
    let previousTotals = null;
    let currentModel;
    let currentModelIsFallback = false;

    await processFileByLine(filePath, async (line) => {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }

      if (!obj || typeof obj !== 'object') return;

      if (obj.type === 'turn_context') {
        const contextModel = extractModelFromObject(obj.payload);
        if (contextModel) {
          currentModel = contextModel;
          currentModelIsFallback = false;
        }
        return;
      }

      if (obj.type !== 'event_msg' || obj.payload?.type !== 'token_count') return;
      if (!obj.timestamp) return;

      const info = obj.payload?.info && typeof obj.payload.info === 'object' ? obj.payload.info : {};
      const lastUsage = normalizeCodexRawUsage(info.last_token_usage);
      const totalUsage = normalizeCodexRawUsage(info.total_token_usage);

      let raw = lastUsage;
      if (!raw && totalUsage) {
        raw = subtractCodexRawUsage(totalUsage, previousTotals);
      }
      if (totalUsage) {
        previousTotals = totalUsage;
      }
      if (!raw) return;

      const delta = codexRawToDelta(raw);
      if (
        delta.inputTokens === 0 &&
        delta.cachedInputTokens === 0 &&
        delta.outputTokens === 0 &&
        delta.reasoningOutputTokens === 0
      ) {
        return;
      }

      const extractedModel = extractModelFromObject({ ...(obj.payload || {}), info });
      let fallbackModel = false;
      if (extractedModel) {
        currentModel = extractedModel;
        currentModelIsFallback = false;
      }

      let model = extractedModel || currentModel;
      if (!model) {
        model = LEGACY_CODEX_FALLBACK_MODEL;
        fallbackModel = true;
        currentModel = model;
        currentModelIsFallback = true;
      } else if (!extractedModel && currentModelIsFallback) {
        fallbackModel = true;
      }

      totalTokens += delta.totalTokens;

      const timestampMs = toTimestampMs(obj?.timestamp);
      const pricing = await resolvePricingForEvent({
        modelName: model,
        timestampMs,
        providerPrefixes: CODEX_PROVIDER_PREFIXES,
        aliasLookup: CODEX_MODEL_ALIASES
      });
      totalCostUsd += calculateCodexDeltaCost(delta, pricing);

      if (fallbackModel) {
        // intentionally left blank: fallback flag is only for CLI display in upstream
      }
    });
  }

  return {
    totalTokens: Math.round(totalTokens),
    totalCostUsd: roundCost(totalCostUsd),
    source: '@ccusage/codex'
  };
}

function ensureToolSummary(byTool, toolName) {
  if (!byTool[toolName]) {
    byTool[toolName] = {
      totalTokens: 0,
      totalCostUsd: 0,
      runningAgents: 0
    };
  }
}

function cloneUsageTotals(baseTotals) {
  if (!baseTotals || typeof baseTotals !== 'object') return null;
  const byTool = {};
  for (const [tool, value] of Object.entries(baseTotals.byTool || {})) {
    byTool[tool] = {
      totalTokens: Math.round(Number(value?.totalTokens || 0)),
      totalCostUsd: roundCost(value?.totalCostUsd || 0),
      runningAgents: Math.round(Number(value?.runningAgents || 0))
    };
  }

  return {
    scope: baseTotals.scope || 'all_history',
    totals: {
      runningAgents: Math.round(Number(baseTotals.totals?.runningAgents || 0)),
      totalTokens: Math.round(Number(baseTotals.totals?.totalTokens || 0)),
      totalCostUsd: roundCost(baseTotals.totals?.totalCostUsd || 0)
    },
    byTool,
    backfill: { ...(baseTotals.backfill || {}) },
    updatedAt: baseTotals.updatedAt || Date.now()
  };
}

export function applyExternalUsageOverrides(baseTotals) {
  const merged = cloneUsageTotals(baseTotals);
  if (!merged) return baseTotals;

  const current = getExternalUsageSnapshot();
  ensureToolSummary(merged.byTool, 'claude-code');
  ensureToolSummary(merged.byTool, 'codex');

  if (current.claudeCode) {
    merged.byTool['claude-code'].totalTokens = Math.round(current.claudeCode.totalTokens || 0);
    merged.byTool['claude-code'].totalCostUsd = roundCost(current.claudeCode.totalCostUsd || 0);
  }

  if (current.codex) {
    merged.byTool.codex.totalTokens = Math.round(current.codex.totalTokens || 0);
    merged.byTool.codex.totalCostUsd = roundCost(current.codex.totalCostUsd || 0);
  }

  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const summary of Object.values(merged.byTool)) {
    totalTokens += Math.round(Number(summary.totalTokens || 0));
    totalCostUsd += roundCost(summary.totalCostUsd || 0);
  }

  merged.totals.totalTokens = Math.round(totalTokens);
  merged.totals.totalCostUsd = roundCost(totalCostUsd);
  merged.externalUsage = current;
  return merged;
}

export function getExternalUsageSnapshot() {
  return {
    claudeCode: externalUsage.claudeCode ? { ...externalUsage.claudeCode } : null,
    codex: externalUsage.codex ? { ...externalUsage.codex } : null,
    updatedAt: externalUsage.updatedAt,
    lastError: externalUsage.lastError
  };
}

async function refreshExternalUsageInternal() {
  const pricingEntries = await ensurePricingEntries();
  const resolvePricingForEvent = createHistoricalPricingResolver(pricingEntries);

  const [claudeCode, codex] = await Promise.all([
    computeClaudeCompatibleTotals(resolvePricingForEvent),
    computeCodexCompatibleTotals(resolvePricingForEvent)
  ]);

  const next = {
    claudeCode,
    codex,
    updatedAt: Date.now(),
    lastError: null
  };

  const changed =
    !externalUsage.claudeCode ||
    !externalUsage.codex ||
    externalUsage.claudeCode.totalTokens !== next.claudeCode.totalTokens ||
    externalUsage.claudeCode.totalCostUsd !== next.claudeCode.totalCostUsd ||
    externalUsage.codex.totalTokens !== next.codex.totalTokens ||
    externalUsage.codex.totalCostUsd !== next.codex.totalCostUsd;

  externalUsage = next;
  writeExternalUsageCacheToDisk(next);

  logger.info('External usage refreshed', {
    claudeTokens: next.claudeCode.totalTokens,
    claudeCostUsd: next.claudeCode.totalCostUsd,
    codexTokens: next.codex.totalTokens,
    codexCostUsd: next.codex.totalCostUsd
  });

  return changed;
}

export async function refreshExternalUsage({ force = false } = {}) {
  const now = Date.now();
  if (!force && (now - lastAttemptAt) < REFRESH_MIN_INTERVAL_MS) {
    return false;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  lastAttemptAt = now;
  refreshPromise = (async () => {
    try {
      return await refreshExternalUsageInternal();
    } catch (error) {
      externalUsage = {
        ...externalUsage,
        lastError: error?.message || String(error)
      };
      logger.warn('External usage refresh failed', {
        error: externalUsage.lastError
      });
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function initExternalUsageService() {
  const cached = readExternalUsageCacheFromDisk();
  if (cached) {
    externalUsage = {
      ...externalUsage,
      ...cached,
      lastError: null
    };
  }
  return refreshExternalUsage({ force: true });
}

export function __resetForTests() {
  externalUsage = { ...EMPTY_EXTERNAL };
  refreshPromise = null;
  lastAttemptAt = 0;
  pricingState = {
    fetchedAt: 0,
    entries: normalizePricingEntries(FALLBACK_PRICING)
  };
  pricingHistoryState = {
    fetchedAt: 0,
    commits: []
  };
  pricingHistoryRefreshPromise = null;
  pricingEntriesBySha.clear();
  pricingEntriesFetchPromisesBySha.clear();
}

export function __setExternalUsageForTests(next) {
  externalUsage = {
    claudeCode: next?.claudeCode ? { ...next.claudeCode } : null,
    codex: next?.codex ? { ...next.codex } : null,
    updatedAt: toFiniteNumber(next?.updatedAt) ?? Date.now(),
    lastError: next?.lastError ? String(next.lastError) : null
  };
}

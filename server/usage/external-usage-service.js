import { execFile } from 'child_process';
import { promisify } from 'util';

import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const REFRESH_MIN_INTERVAL_MS = 60 * 1000;
const EXEC_TIMEOUT_MS = 90 * 1000;
const EXEC_MAX_BUFFER = 32 * 1024 * 1024;

const EMPTY_EXTERNAL = {
  claudeCode: null,
  codex: null,
  updatedAt: 0,
  lastError: null
};

let externalUsage = { ...EMPTY_EXTERNAL };
let refreshPromise = null;
let lastAttemptAt = 0;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(6));
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('empty_json_output');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Some CLIs may emit non-JSON lines before/after payload.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('invalid_json_output');
  }
}

async function runNpxJson(commandArgs) {
  const { stdout } = await execFileAsync(
    'npx',
    ['--yes', ...commandArgs],
    {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER
    }
  );

  return parseJsonObject(stdout);
}

function extractClaudeTotals(report) {
  const totals = report?.totals;
  const totalTokens = toFiniteNumber(totals?.totalTokens);
  const totalCostUsd = toFiniteNumber(totals?.totalCost);
  if (totalTokens === null || totalCostUsd === null) {
    throw new Error('invalid_ccusage_totals_shape');
  }

  return {
    totalTokens: Math.round(totalTokens),
    totalCostUsd: roundCost(totalCostUsd),
    source: 'ccusage'
  };
}

function extractCodexTotals(report) {
  const totals = report?.totals;
  const totalTokens = toFiniteNumber(totals?.totalTokens);
  const totalCostUsd = toFiniteNumber(totals?.costUSD);
  if (totalTokens === null || totalCostUsd === null) {
    throw new Error('invalid_ccusage_codex_totals_shape');
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
  const [claudeReport, codexReport] = await Promise.all([
    runNpxJson(['ccusage', 'monthly', '--json', '--mode', 'calculate']),
    runNpxJson(['@ccusage/codex@latest', 'monthly', '--json'])
  ]);

  const claudeCode = extractClaudeTotals(claudeReport);
  const codex = extractCodexTotals(codexReport);

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
  await refreshExternalUsage({ force: true });
}

export function __resetForTests() {
  externalUsage = { ...EMPTY_EXTERNAL };
  refreshPromise = null;
  lastAttemptAt = 0;
}

export function __setExternalUsageForTests(next) {
  externalUsage = {
    claudeCode: next?.claudeCode ? { ...next.claudeCode } : null,
    codex: next?.codex ? { ...next.codex } : null,
    updatedAt: toFiniteNumber(next?.updatedAt) ?? Date.now(),
    lastError: next?.lastError ? String(next.lastError) : null
  };
}

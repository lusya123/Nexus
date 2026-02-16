const usageSessions = new Map();
const liveSessions = new Map();

const DEFAULT_TOOLS = ['codex', 'claude-code', 'openclaw'];
const RUNNING_STATES = new Set(['active', 'idle']);

let backfill = {
  status: 'done',
  scannedFiles: 0,
  totalFiles: 0
};

let updatedAt = Date.now();

function toTokenNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ensureUsageSession(sessionId, tool) {
  if (!usageSessions.has(sessionId)) {
    usageSessions.set(sessionId, {
      sessionId,
      tool,
      model: null,
      snapshot: null,
      deltaEvents: new Map(),
      aggregateTokens: zeroTokens(),
      totalCostUsd: 0
    });
  }

  const session = usageSessions.get(sessionId);
  if (!session.tool && tool) session.tool = tool;
  return session;
}

function zeroTokens() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  };
}

function normalizeSnapshotTokens(tokens = {}) {
  return {
    inputTokens: toTokenNumber(tokens.inputTokens),
    outputTokens: toTokenNumber(tokens.outputTokens),
    cachedInputTokens: toTokenNumber(tokens.cachedInputTokens),
    reasoningOutputTokens: toTokenNumber(tokens.reasoningOutputTokens),
    totalTokens: Number.isFinite(Number(tokens.totalTokens)) ? Number(tokens.totalTokens) : null
  };
}

function normalizeDeltaTokens(tokens = {}) {
  const normalized = {
    inputTokens: toTokenNumber(tokens.inputTokens),
    outputTokens: toTokenNumber(tokens.outputTokens),
    cachedInputTokens: toTokenNumber(tokens.cachedInputTokens),
    cacheReadInputTokens: toTokenNumber(tokens.cacheReadInputTokens),
    cacheCreationInputTokens: toTokenNumber(tokens.cacheCreationInputTokens),
    cacheWriteTokens: toTokenNumber(tokens.cacheWriteTokens),
    reasoningOutputTokens: toTokenNumber(tokens.reasoningOutputTokens)
  };

  const explicitTotal = Number(tokens.totalTokens);
  normalized.totalTokens = Number.isFinite(explicitTotal)
    ? explicitTotal
    : normalized.inputTokens
      + normalized.outputTokens
      + normalized.cachedInputTokens
      + normalized.cacheReadInputTokens
      + normalized.cacheCreationInputTokens
      + normalized.cacheWriteTokens;

  return normalized;
}

function snapshotComparable(snapshot) {
  if (!snapshot) return 0;
  if (snapshot.totalTokens !== null) {
    return snapshot.totalTokens + snapshot.cachedInputTokens;
  }

  return snapshot.inputTokens + snapshot.outputTokens + snapshot.cachedInputTokens;
}

function tokensEqual(a, b) {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.cacheReadInputTokens === b.cacheReadInputTokens &&
    a.cacheCreationInputTokens === b.cacheCreationInputTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.reasoningOutputTokens === b.reasoningOutputTokens &&
    a.totalTokens === b.totalTokens
  );
}

function recomputeSession(session, calculateCostUsd) {
  if (session.snapshot) {
    const snapshot = session.snapshot;
    const totalTokens = snapshot.totalTokens !== null
      ? snapshot.totalTokens + snapshot.cachedInputTokens
      : snapshot.inputTokens + snapshot.outputTokens + snapshot.cachedInputTokens;

    session.aggregateTokens = {
      inputTokens: snapshot.inputTokens,
      outputTokens: snapshot.outputTokens,
      cachedInputTokens: snapshot.cachedInputTokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheWriteTokens: 0,
      reasoningOutputTokens: snapshot.reasoningOutputTokens,
      totalTokens
    };

    const computed = calculateCostUsd ? calculateCostUsd(session.model, session.aggregateTokens) : null;
    session.totalCostUsd = Number.isFinite(computed) ? computed : 0;
    return;
  }

  const aggregate = zeroTokens();
  let directCostUsd = 0;
  let hasDirectCost = false;

  for (const event of session.deltaEvents.values()) {
    const tokens = event.tokens;
    aggregate.inputTokens += tokens.inputTokens;
    aggregate.outputTokens += tokens.outputTokens;
    aggregate.cachedInputTokens += tokens.cachedInputTokens;
    aggregate.cacheReadInputTokens += tokens.cacheReadInputTokens;
    aggregate.cacheCreationInputTokens += tokens.cacheCreationInputTokens;
    aggregate.cacheWriteTokens += tokens.cacheWriteTokens;
    aggregate.reasoningOutputTokens += tokens.reasoningOutputTokens;
    aggregate.totalTokens += tokens.totalTokens;

    if (Number.isFinite(event.directCostUsd)) {
      hasDirectCost = true;
      directCostUsd += Number(event.directCostUsd);
    }
  }

  session.aggregateTokens = aggregate;

  if (session.tool === 'openclaw' && hasDirectCost) {
    session.totalCostUsd = directCostUsd;
    return;
  }

  const computed = calculateCostUsd ? calculateCostUsd(session.model, session.aggregateTokens) : null;
  session.totalCostUsd = Number.isFinite(computed) ? computed : 0;
}

function markUpdated() {
  updatedAt = Date.now();
}

function roundCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(6));
}

function ensureToolSummary(byTool, tool) {
  if (!byTool[tool]) {
    byTool[tool] = {
      totalTokens: 0,
      totalCostUsd: 0,
      runningAgents: 0
    };
  }
}

export function ingestUsageEvent({ sessionId, tool, event, calculateCostUsd }) {
  if (!sessionId || !tool || !event || typeof event !== 'object') return false;

  const session = ensureUsageSession(sessionId, tool);
  const prevTokens = session.aggregateTokens;
  const prevCost = session.totalCostUsd;
  const prevModel = session.model;

  let changed = false;

  if (event.model && event.model !== session.model) {
    session.model = String(event.model);
    changed = true;
  }

  if (event.kind === 'snapshot' && event.tokens) {
    const snapshot = normalizeSnapshotTokens(event.tokens);
    const previousSnapshotValue = snapshotComparable(session.snapshot);
    const nextSnapshotValue = snapshotComparable(snapshot);

    if (!session.snapshot || nextSnapshotValue > previousSnapshotValue) {
      session.snapshot = snapshot;
      changed = true;
    }
  } else if (event.kind === 'delta' && event.tokens) {
    const eventKey = String(event.eventKey || '').trim();
    if (!eventKey) return false;

    const normalizedTokens = normalizeDeltaTokens(event.tokens);
    const normalizedCost = Number.isFinite(Number(event.directCostUsd)) ? Number(event.directCostUsd) : null;
    const previous = session.deltaEvents.get(eventKey);

    if (!previous) {
      session.deltaEvents.set(eventKey, {
        tokens: normalizedTokens,
        directCostUsd: normalizedCost
      });
      changed = true;
    } else if (
      !tokensEqual(previous.tokens, normalizedTokens) ||
      previous.directCostUsd !== normalizedCost
    ) {
      session.deltaEvents.set(eventKey, {
        tokens: normalizedTokens,
        directCostUsd: normalizedCost
      });
      changed = true;
    }
  }

  if (!changed) return false;

  recomputeSession(session, calculateCostUsd);

  if (
    !tokensEqual(prevTokens, session.aggregateTokens) ||
    prevCost !== session.totalCostUsd ||
    prevModel !== session.model
  ) {
    markUpdated();
    return true;
  }

  return false;
}

export function syncLiveSessions(sessions = []) {
  const next = new Map();
  for (const session of sessions) {
    if (!session || !session.sessionId) continue;
    next.set(session.sessionId, {
      tool: session.tool,
      state: session.state
    });
  }

  let changed = false;
  if (next.size !== liveSessions.size) {
    changed = true;
  } else {
    for (const [sessionId, info] of next.entries()) {
      const existing = liveSessions.get(sessionId);
      if (!existing || existing.state !== info.state || existing.tool !== info.tool) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) return false;

  liveSessions.clear();
  for (const [sessionId, info] of next.entries()) {
    liveSessions.set(sessionId, info);
  }
  markUpdated();
  return true;
}

export function upsertLiveSession(sessionId, tool, state) {
  if (!sessionId) return false;
  const existing = liveSessions.get(sessionId);
  const next = { tool, state };
  if (existing && existing.tool === next.tool && existing.state === next.state) {
    return false;
  }

  liveSessions.set(sessionId, next);
  markUpdated();
  return true;
}

export function setLiveSessionState(sessionId, state) {
  if (!sessionId || !liveSessions.has(sessionId)) return false;
  const info = liveSessions.get(sessionId);
  if (info.state === state) return false;
  info.state = state;
  liveSessions.set(sessionId, info);
  markUpdated();
  return true;
}

export function removeLiveSession(sessionId) {
  if (!sessionId) return false;
  const removed = liveSessions.delete(sessionId);
  if (removed) markUpdated();
  return removed;
}

export function setBackfillProgress({ status, scannedFiles, totalFiles }) {
  const next = {
    status: status || backfill.status,
    scannedFiles: Number.isFinite(Number(scannedFiles)) ? Number(scannedFiles) : backfill.scannedFiles,
    totalFiles: Number.isFinite(Number(totalFiles)) ? Number(totalFiles) : backfill.totalFiles
  };

  if (
    next.status === backfill.status &&
    next.scannedFiles === backfill.scannedFiles &&
    next.totalFiles === backfill.totalFiles
  ) {
    return false;
  }

  backfill = next;
  markUpdated();
  return true;
}

export function getUsageTotals() {
  const byTool = {};
  for (const tool of DEFAULT_TOOLS) {
    byTool[tool] = {
      totalTokens: 0,
      totalCostUsd: 0,
      runningAgents: 0
    };
  }

  for (const session of usageSessions.values()) {
    ensureToolSummary(byTool, session.tool);
    byTool[session.tool].totalTokens += Math.round(session.aggregateTokens.totalTokens || 0);
    byTool[session.tool].totalCostUsd += roundCost(session.totalCostUsd || 0);
  }

  let runningAgents = 0;
  for (const [, session] of liveSessions.entries()) {
    if (!RUNNING_STATES.has(session.state)) continue;
    runningAgents += 1;
    ensureToolSummary(byTool, session.tool);
    byTool[session.tool].runningAgents += 1;
  }

  const totals = {
    runningAgents,
    totalTokens: 0,
    totalCostUsd: 0
  };

  for (const summary of Object.values(byTool)) {
    summary.totalTokens = Math.round(summary.totalTokens);
    summary.totalCostUsd = roundCost(summary.totalCostUsd);
    totals.totalTokens += summary.totalTokens;
    totals.totalCostUsd += summary.totalCostUsd;
  }

  totals.totalCostUsd = roundCost(totals.totalCostUsd);

  return {
    scope: 'all_history',
    totals,
    byTool,
    backfill: { ...backfill },
    updatedAt
  };
}

export function __resetForTests() {
  usageSessions.clear();
  liveSessions.clear();
  backfill = {
    status: 'done',
    scannedFiles: 0,
    totalFiles: 0
  };
  updatedAt = Date.now();
}


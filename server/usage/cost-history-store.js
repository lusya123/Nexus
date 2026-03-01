import fs from 'fs';
import path from 'path';

const RUNTIME_DIR = path.join(process.cwd(), '.nexus-runtime');
const IS_TEST_RUNTIME = String(process.argv?.[1] || '').includes(`${path.sep}tests${path.sep}`);
const COST_HISTORY_FILE = IS_TEST_RUNTIME ? 'usage-cost-history.test.jsonl' : 'usage-cost-history.jsonl';
const COST_HISTORY_PATH = path.join(RUNTIME_DIR, COST_HISTORY_FILE);

let entriesCache = null;
let sequence = 0;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLimit(value, fallback = 200, max = 2000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded <= 0) return fallback;
  return Math.min(rounded, max);
}

function parseStoredLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureLoaded() {
  if (entriesCache) return;

  entriesCache = [];
  sequence = 0;

  try {
    if (!fs.existsSync(COST_HISTORY_PATH)) return;
    const text = fs.readFileSync(COST_HISTORY_PATH, 'utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      const parsed = parseStoredLine(line);
      if (!parsed) continue;
      entriesCache.push(parsed);

      const seq = toFiniteNumber(parsed.sequence);
      if (seq !== null && seq > sequence) {
        sequence = seq;
      }
    }

    if (sequence === 0) {
      sequence = entriesCache.length;
    }
  } catch {
    // Ignore load failure; keep cache empty for runtime safety.
    entriesCache = [];
    sequence = 0;
  }
}

function cloneEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    ...entry,
    event: entry.event && typeof entry.event === 'object' ? { ...entry.event } : null,
    tokens: entry.tokens && typeof entry.tokens === 'object' ? { ...entry.tokens } : null,
    cost: entry.cost && typeof entry.cost === 'object' ? { ...entry.cost } : null,
    pricing: entry.pricing && typeof entry.pricing === 'object' ? { ...entry.pricing } : null
  };
}

export function appendCostHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  ensureLoaded();

  const now = Date.now();
  sequence += 1;

  const normalized = {
    sequence,
    recordedAt: toFiniteNumber(entry.recordedAt) ?? now,
    sessionId: entry.sessionId ? String(entry.sessionId) : null,
    tool: entry.tool ? String(entry.tool) : null,
    model: entry.model ? String(entry.model) : null,
    event: entry.event && typeof entry.event === 'object' ? {
      kind: entry.event.kind ? String(entry.event.kind) : null,
      eventKey: entry.event.eventKey ? String(entry.event.eventKey) : null
    } : null,
    tokens: entry.tokens && typeof entry.tokens === 'object' ? { ...entry.tokens } : null,
    cost: entry.cost && typeof entry.cost === 'object' ? { ...entry.cost } : null,
    pricing: entry.pricing && typeof entry.pricing === 'object' ? { ...entry.pricing } : null
  };

  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.appendFileSync(COST_HISTORY_PATH, `${JSON.stringify(normalized)}\n`);
  } catch {
    // Keep runtime behavior intact when history persistence fails.
  }

  entriesCache.push(normalized);
  return cloneEntry(normalized);
}

export function getCostHistory({ limit = 200, sessionId = null, tool = null } = {}) {
  ensureLoaded();

  const normalizedLimit = normalizeLimit(limit);
  const sessionFilter = sessionId ? String(sessionId) : null;
  const toolFilter = tool ? String(tool) : null;

  const out = [];
  for (let idx = entriesCache.length - 1; idx >= 0; idx -= 1) {
    const entry = entriesCache[idx];
    if (sessionFilter && entry.sessionId !== sessionFilter) continue;
    if (toolFilter && entry.tool !== toolFilter) continue;

    out.push(cloneEntry(entry));
    if (out.length >= normalizedLimit) break;
  }

  return out;
}

export function getCostHistoryMeta() {
  ensureLoaded();
  return {
    path: COST_HISTORY_PATH,
    totalRecords: entriesCache.length
  };
}

export function __resetForTests() {
  entriesCache = [];
  sequence = 0;

  try {
    fs.unlinkSync(COST_HISTORY_PATH);
  } catch {
    // ignore when missing
  }
}

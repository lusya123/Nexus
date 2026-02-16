import path from 'path';
import os from 'os';
import fs from 'fs';

// OpenClaw agents 目录
export const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents');

function readFilePrefix(filePath, maxBytes = 64 * 1024) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function getSessionNameFromFile(filePath) {
  if (!filePath) return null;

  const text = readFilePrefix(filePath);
  if (!text) return null;

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);
      if (obj?.type !== 'session') continue;

      const explicitName = typeof obj.name === 'string' ? obj.name.trim() : '';
      if (explicitName) return explicitName;

      const cwd = typeof obj.cwd === 'string' ? obj.cwd.trim() : '';
      if (!cwd) return null;

      const normalized = cwd.replace(/[\\/]+$/, '');
      const base = path.basename(normalized);
      if (base && base !== '.' && base !== path.sep) return base;
      return normalized || cwd;
    } catch {
      continue;
    }
  }

  return null;
}

function safeSnippet(s, maxLen = 180) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  if (maxLen <= 3) return t.slice(0, maxLen);
  return `${t.slice(0, maxLen - 3)}...`;
}

function extractTextParts(content) {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter(item => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text);
}

function summarizeToolCall(item) {
  const name = item?.name ? String(item.name) : 'unknown_tool';
  const id = item?.id ? String(item.id) : '';
  const idPart = id ? ` (${id.slice(0, 12)}...)` : '';
  return `[tool_call] ${name}${idPart}`.trim();
}

function summarizeToolResult(msg) {
  const toolName = msg?.toolName ? String(msg.toolName) : 'unknown_tool';
  const callId = msg?.toolCallId ? String(msg.toolCallId) : '';
  const idPart = callId ? ` ${callId.slice(0, 12)}...` : '';
  const text = extractTextParts(msg?.content).join('\n');
  const firstLine = (text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  const linePart = safeSnippet(firstLine, 140);
  return `[tool_output]${idPart} ${toolName}${linePart ? ` ${linePart}` : ''}`.trim();
}

// 解析 OpenClaw JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // OpenClaw v3 format (observed locally):
    // - meta: { type:"session"|... }
    // - message: { type:"message", message:{ role:"user"|"assistant"|"toolResult", content:[...] } }
    if (obj.type === 'message' && obj.message && typeof obj.message === 'object') {
      const msg = obj.message;
      const role = msg.role;

      if (role === 'user' || role === 'assistant') {
        const parts = extractTextParts(msg.content);
        const text = parts.join('\n').trim();
        if (text) return { role, content: text };

        // If the assistant message is purely tool plumbing, surface as tool events.
        if (Array.isArray(msg.content)) {
          const toolCalls = msg.content.filter(i => i && typeof i === 'object' && i.type === 'toolCall');
          if (toolCalls.length > 0) {
            const summary = toolCalls.map(summarizeToolCall).join('\n').trim();
            if (summary) return { role: 'assistant', content: summary };
          }
        }

        return null;
      }

      if (role === 'toolResult') {
        const summary = summarizeToolResult(msg);
        return summary ? { role: 'assistant', content: summary } : null;
      }
    }

    // Legacy/simple format: { role:"user"|"assistant", content:"..."|[...] }
    if (obj.role === 'user' || obj.role === 'assistant') {
      const text = extractTextParts(obj.content).join('\n').trim();
      return text ? { role: obj.role, content: text } : null;
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Parse usage/model events from OpenClaw JSONL.
// Usage typically lives on `obj.message.usage` for `type: "message"` rows.
export function parseUsageEvent(line) {
  try {
    const obj = JSON.parse(line);
    if (obj?.type !== 'message') return null;

    const message = obj?.message;
    if (!message || typeof message !== 'object') return null;

    const usage = message.usage;
    if (!usage || typeof usage !== 'object') return null;

    const eventKey = message.id || obj.id;
    if (!eventKey) return null;

    const costTotal = usage?.cost?.total;

    return {
      kind: 'delta',
      eventKey: String(eventKey),
      model: message.model ? String(message.model) : null,
      directCostUsd: Number.isFinite(Number(costTotal)) ? Number(costTotal) : null,
      tokens: {
        inputTokens: Number(usage.input || 0),
        outputTokens: Number(usage.output || 0),
        cacheReadInputTokens: Number(usage.cacheRead || 0),
        cacheWriteTokens: Number(usage.cacheWrite || 0),
        totalTokens: Number.isFinite(Number(usage.totalTokens))
          ? Number(usage.totalTokens)
          : undefined
      }
    };
  } catch {
    return null;
  }
}

// 从文件路径提取 Session ID
export function getSessionId(filePath) {
  return path.basename(filePath, '.jsonl');
}

// 从目录路径提取项目名称
export function getProjectName(dirPath, filePath) {
  // Prefer per-session metadata in the file header to avoid collapsing all
  // sessions under the same agent directory label.
  const sessionName = getSessionNameFromFile(filePath);
  if (sessionName) return sessionName;

  // 从 agents/{agentName}/sessions 提取 agentName
  const parts = dirPath.split(path.sep);
  const sessionsIndex = parts.lastIndexOf('sessions');

  if (sessionsIndex > 0) {
    return parts[sessionsIndex - 1];
  }

  return path.basename(path.dirname(dirPath));
}

// 编码工作目录为目录名
export function encodeCwd(cwd) {
  return cwd.replace(/\//g, '-');
}

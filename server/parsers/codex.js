import path from 'path';
import os from 'os';

// Codex sessions 目录
export const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');

function safeSnippet(s, maxLen = 140) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  if (maxLen <= 3) return t.slice(0, maxLen);
  return `${t.slice(0, maxLen - 3)}...`;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  // Codex message content items are typically { type: "input_text"|"output_text", text: "..." }.
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string') parts.push(item.text);
  }
  return parts.join('\n');
}

function summarizeFunctionCall(payload) {
  const name = payload?.name ? String(payload.name) : 'unknown_tool';
  const callId = payload?.call_id ? String(payload.call_id) : '';
  const idPart = callId ? ` (${callId.slice(0, 12)}...)` : '';
  return `[tool_call] ${name}${idPart}`;
}

function summarizeFunctionCallOutput(payload) {
  const callId = payload?.call_id ? String(payload.call_id) : '';
  const output = payload?.output ? String(payload.output) : '';

  // Common tool outputs begin with "Exit code: N".
  const exitCodeMatch = output.match(/Exit code:\s*(\d+)/);
  const exitPart = exitCodeMatch ? ` exit=${exitCodeMatch[1]}` : '';

  const firstMeaningfulLine = output
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0) || '';

  const linePart = safeSnippet(firstMeaningfulLine, 120);
  const idPart = callId ? ` ${callId.slice(0, 12)}...` : '';

  return `[tool_output]${idPart}${exitPart}${linePart ? ` ${linePart}` : ''}`.trim();
}

// 解析 Codex JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // Newer Codex logs include event messages:
    // { type:"event_msg", payload:{ type:"user_message"|"agent_message", message:"..." } }
    if (obj.type === 'event_msg' && obj.payload) {
      const payload = obj.payload;
      if (payload.type === 'user_message' && typeof payload.message === 'string') {
        const text = payload.message.trim();
        return text ? { role: 'user', content: text } : null;
      }
      if (payload.type === 'agent_message' && typeof payload.message === 'string') {
        const text = payload.message.trim();
        return text ? { role: 'assistant', content: text } : null;
      }
    }

    // Codex 格式:
    // - message: { type:"response_item", payload:{ type:"message", role:"user|assistant", content:[{type:"input_text|output_text", text:"..."}] } }
    // - tool calls: { type:"response_item", payload:{ type:"function_call", name:"...", arguments:"...", call_id:"..." } }
    // - tool outputs: { type:"response_item", payload:{ type:"function_call_output", call_id:"...", output:"..." } }
    if (obj.type === 'response_item' && obj.payload) {
      const payload = obj.payload;

      if (payload.type === 'function_call') {
        return { role: 'assistant', content: summarizeFunctionCall(payload) };
      }

      if (payload.type === 'function_call_output') {
        return { role: 'assistant', content: summarizeFunctionCallOutput(payload) };
      }

      // Some Codex logs include non-chat "reasoning" items; surface summary as a short assistant note.
      if (payload.type === 'reasoning' && Array.isArray(payload.summary)) {
        const text = payload.summary
          .filter(i => i?.type === 'summary_text' && typeof i.text === 'string')
          .map(i => i.text)
          .join('\n')
          .trim();
        if (text) return { role: 'assistant', content: safeSnippet(text, 200) };
        return null;
      }

      if (!payload.role) return null;
      const role = payload.role;

      if (role !== 'user' && role !== 'assistant') {
        return null;
      }

      const text = extractTextFromContent(payload.content).trim();
      // Empty / non-text content lines are noise in the UI (often tool plumbing); skip them.
      if (!text) return null;

      return { role, content: text };
    }

    return null;
  } catch (error) {
    return null;
  }
}

// 从文件路径提取 Session ID
export function getSessionId(filePath) {
  const filename = path.basename(filePath, '.jsonl');
  // 从 rollout-{timestamp}-{uuid}.jsonl 提取 uuid
  const match = filename.match(/^rollout-\d+-(.+)$/);
  return match ? match[1] : filename;
}

// 从目录路径提取项目名称
export function getProjectName(dirPath) {
  // 从 YYYY/MM/DD 路径提取，返回 "YYYY-MM-DD"
  const parts = dirPath.split(path.sep);
  const year = parts[parts.length - 3];
  const month = parts[parts.length - 2];
  const day = parts[parts.length - 1];

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }

  return path.basename(dirPath);
}

// 编码工作目录为目录名
export function encodeCwd(cwd) {
  return cwd.replace(/\//g, '-');
}

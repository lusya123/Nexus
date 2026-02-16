import path from 'path';
import os from 'os';

// Claude Code projects directory
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Parse Claude Code JSONL message
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // Extract user or assistant messages
    if (obj.type === 'user' && obj.message?.role === 'user') {
      const content = obj.message.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: 'user', content: text };
    }

    if (obj.type === 'assistant' && obj.message?.role === 'assistant') {
      const content = obj.message.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: 'assistant', content: text };
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Parse usage/model events from Claude Code JSONL.
// Uses `message.id` as the primary dedupe key, falling back to `uuid`.
export function parseUsageEvent(line) {
  try {
    const obj = JSON.parse(line);
    const message = obj?.message;
    if (!message || typeof message !== 'object') return null;

    const usage = message.usage;
    if (!usage || typeof usage !== 'object') return null;

    const eventKey = message.id || obj.uuid;
    if (!eventKey) return null;

    return {
      kind: 'delta',
      eventKey: String(eventKey),
      model: message.model ? String(message.model) : null,
      tokens: {
        inputTokens: Number(usage.input_tokens || 0),
        outputTokens: Number(usage.output_tokens || 0),
        cacheReadInputTokens: Number(usage.cache_read_input_tokens || 0),
        cacheCreationInputTokens: Number(usage.cache_creation_input_tokens || 0)
      }
    };
  } catch {
    return null;
  }
}

// Encode CWD path to project directory name
export function encodeCwd(cwd) {
  // /Users/xxx/project → -Users-xxx-project
  return cwd.replace(/\//g, '-');
}

// Get session ID from file path
export function getSessionId(filePath) {
  return path.basename(filePath, '.jsonl');
}

// Get project name from directory path
export function getProjectName(dirPath) {
  return path.basename(dirPath);
}

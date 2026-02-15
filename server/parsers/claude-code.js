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

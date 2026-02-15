import path from 'path';
import os from 'os';

// Codex sessions 目录
export const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');

// 解析 Codex JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // Codex 格式: type == "response_item" && payload.role == "user/assistant"
    if (obj.type === 'response_item' && obj.payload?.role) {
      const role = obj.payload.role;

      if (role !== 'user' && role !== 'assistant') {
        return null;
      }

      const content = obj.payload.content;
      let text = '';

      // content 是数组，提取 type === 'text' 的 text 字段
      if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      } else if (typeof content === 'string') {
        text = content;
      }

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

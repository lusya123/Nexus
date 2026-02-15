import path from 'path';
import os from 'os';

// OpenClaw agents 目录
export const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents');

// 解析 OpenClaw JSONL 消息
export function parseMessage(line) {
  try {
    const obj = JSON.parse(line);

    // OpenClaw 格式最简单: role == "user" 或 role == "assistant"
    if (obj.role === 'user' || obj.role === 'assistant') {
      const content = obj.content;
      let text = '';

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }

      return { role: obj.role, content: text };
    }

    return null;
  } catch (error) {
    return null;
  }
}

// 从文件路径提取 Session ID
export function getSessionId(filePath) {
  return path.basename(filePath, '.jsonl');
}

// 从目录路径提取项目名称
export function getProjectName(dirPath) {
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

import type { MessageKind } from '../types/nexus';

export function getMessageKind(content: string): MessageKind {
  const t = (content || '').trim();
  if (t.startsWith('[tool_call]')) return 'tool_call';
  if (t.startsWith('[tool_output]')) return 'tool_output';
  return 'text';
}

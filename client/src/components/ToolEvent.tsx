import type { MessageKind } from '../types/nexus';
import { getMessageKind } from '../utils/message-kind';

function parseToolLine(content: string): { kind: MessageKind; text: string; name?: string; callId?: string; exitCode?: number } {
  const t = (content || '').trim();
  const kind = getMessageKind(t);

  if (kind === 'tool_call') {
    const m = t.match(/^\[tool_call\]\s+([^\s(]+)\s*(.*)$/);
    const name = m?.[1];
    const rest = (m?.[2] || '').trim();
    const callIdMatch = rest.match(/\(([^)]+)\)/);
    const callId = callIdMatch ? callIdMatch[1] : undefined;
    return { kind, text: t.replace(/^\[tool_call\]\s*/, '').trim(), name, callId };
  }

  if (kind === 'tool_output') {
    const exitMatch = t.match(/\bexit=(\d+)\b/);
    const exitCode = exitMatch ? Number(exitMatch[1]) : undefined;
    const callIdMatch = t.match(/^\[tool_output\]\s+([^\s]+)\s+/);
    const callId = callIdMatch ? callIdMatch[1] : undefined;
    return { kind, text: t.replace(/^\[tool_output\]\s*/, '').trim(), callId, exitCode };
  }

  return { kind: 'text', text: t };
}

export function ToolEvent({ content }: { content: string }) {
  const info = parseToolLine(content);
  const isError = typeof info.exitCode === 'number' ? info.exitCode !== 0 : false;
  const badgeClass = `tool-badge ${info.kind === 'tool_call' ? 'tool-badge-call' : isError ? 'tool-badge-err' : 'tool-badge-ok'}`;
  const badgeText = info.kind === 'tool_call' ? 'CALL' : typeof info.exitCode === 'number' ? `EXIT ${info.exitCode}` : 'OUT';

  return (
    <div className={`message message-tool ${info.kind === 'tool_call' ? 'message-toolcall' : 'message-tooloutput'}`}>
      <div className="tool-row">
        <span className={badgeClass}>{badgeText}</span>
        <div className="tool-text">{info.text}</div>
      </div>
    </div>
  );
}

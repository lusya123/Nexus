import { useEffect, useRef, useState } from 'react';
import { TOOL_CONFIG } from '../constants/tools';
import type { Session } from '../types/nexus';

interface DenseSessionCardProps {
  session: Session;
}

export function DenseSessionCard({ session }: DenseSessionCardProps) {
  const toolConfig = TOOL_CONFIG[session.tool] || TOOL_CONFIG['claude-code'];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isEntering, setIsEntering] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsEntering(false), 400);
    return () => window.clearTimeout(timer);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [session.messages.length]);

  // Build recent messages with role info for color coding
  const recentMessages = session.messages
    .slice(-20)
    .filter((m) => (m.content || '').trim().length > 0);

  const cardClass = [
    'dense-card',
    isEntering ? 'card-entering' : '',
    session.state === 'active' ? 'dense-card-active' : '',
    session.state === 'cooling' ? 'card-exiting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass} style={{ '--tool-color': toolConfig.color, '--tool-border': toolConfig.borderColor } as React.CSSProperties}>
      {/* Tool color indicator bar */}
      <div className="dense-card-bar" style={{ background: toolConfig.color }} />

      <div className="dense-card-header">
        <span className="dense-card-tool" style={{ color: toolConfig.color }}>
          {toolConfig.label}
        </span>
        <span className="dense-card-name">{session.name}</span>
      </div>

      {/* Terminal-like text surface with role colors */}
      <div className="dense-card-terminal" ref={scrollRef}>
        {recentMessages.length > 0 ? (
          recentMessages.map((m, i) => (
            <span key={i} className={`dense-text-${m.role}`}>{m.content.trim()}{'\n'}</span>
          ))
        ) : (
          <span className="dense-text-waiting">Waiting...</span>
        )}
      </div>

      {/* Activity indicator */}
      {session.state === 'active' && <div className="dense-card-pulse" style={{ background: toolConfig.color }} />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { TOOL_CONFIG } from '../constants/tools';
import type { Session } from '../types/nexus';
import { getMessageKind } from '../utils/message-kind';
import { MarkdownLite } from './MarkdownLite';
import { ToolEvent } from './ToolEvent';

interface SessionCardProps {
  session: Session;
  showToolEvents: boolean;
}

export function SessionCard({ session, showToolEvents }: SessionCardProps) {
  const toolConfig = TOOL_CONFIG[session.tool] || TOOL_CONFIG['claude-code'];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isEntering, setIsEntering] = useState(true);

  const visibleMessages = session.messages
    .filter((message) => (message.content || '').trim().length > 0)
    .filter((message) => showToolEvents || getMessageKind(message.content) === 'text');

  const hiddenToolEventCount = showToolEvents
    ? 0
    : session.messages.filter((message) => (message.content || '').trim().length > 0 && getMessageKind(message.content) !== 'text').length;

  useEffect(() => {
    const timer = window.setTimeout(() => setIsEntering(false), 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length]);

  const cardClass = `session-card ${isEntering ? 'card-entering' : ''} ${session.state === 'active' ? 'card-active' : ''} ${session.state === 'cooling' ? 'card-exiting' : ''}`;

  return (
    <div
      className={cardClass}
      style={{
        borderColor: session.state === 'active' ? toolConfig.borderColor : undefined
      }}
    >
      <div className="session-header">
        <span className="session-tool" style={{ color: toolConfig.color }}>
          {toolConfig.label}
        </span>
        <span className="session-name">{session.name}</span>
        <span className={`session-state state-${session.state}`}>{session.state.toUpperCase()}</span>
      </div>

      <div className="messages">
        {visibleMessages.map((message, idx) => (
          getMessageKind(message.content) === 'text' ? (
            <div key={idx} className={`message message-${message.role}`}>
              <div className="message-role">{message.role === 'user' ? 'User' : 'Assistant'}</div>
              <div className="message-content">
                <MarkdownLite content={message.content} />
              </div>
            </div>
          ) : (
            <ToolEvent key={idx} content={message.content} />
          )
        ))}
        {visibleMessages.length === 0 && hiddenToolEventCount > 0 && (
          <div className="message message-assistant">
            <div className="message-role">Info</div>
            <div className="message-content">
              No text messages yet. Enable Tool events to view {hiddenToolEventCount} tool events.
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

import { useState } from 'react';
import './App.css';
import { HeaderMetrics } from './components/HeaderMetrics';
import { SessionCard } from './components/SessionCard';
import { useDisplayedSessions } from './hooks/useDisplayedSessions';
import { useSessionsStream } from './hooks/useSessionsStream';
import { useThemeMode } from './hooks/useThemeMode';

function App() {
  const { sessions, usageTotals, connectionStatus } = useSessionsStream();
  const { theme, handleThemeTogglePointerDown, handleThemeToggleChange } = useThemeMode();
  const { visibleSessions } = useDisplayedSessions(sessions);
  const [showToolEvents, setShowToolEvents] = useState(false);

  return (
    <div className="app">
      <HeaderMetrics
        theme={theme}
        usageTotals={usageTotals}
        connectionStatus={connectionStatus}
        showToolEvents={showToolEvents}
        onThemeTogglePointerDown={handleThemeTogglePointerDown}
        onThemeToggleChange={handleThemeToggleChange}
        onShowToolEventsChange={setShowToolEvents}
      />

      <div className="sessions-grid">
        {visibleSessions.map((session) => (
          <SessionCard key={session.sessionId} session={session} showToolEvents={showToolEvents} />
        ))}
      </div>

      {visibleSessions.length === 0 && connectionStatus === 'connected' && (
        <div className="empty-state">
          <p>No active sessions</p>
          <p className="hint">Open a Claude Code, Codex, or OpenClaw session to see it here</p>
        </div>
      )}
    </div>
  );
}

export default App;

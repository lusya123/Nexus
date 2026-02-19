import { useState } from 'react';
import './App.css';
import { DenseSessionCard } from './components/DenseSessionCard';
import { HeaderMetrics } from './components/HeaderMetrics';
import { SessionCard } from './components/SessionCard';
import { useDisplayedSessions } from './hooks/useDisplayedSessions';
import { useSessionsStream } from './hooks/useSessionsStream';
import { useThemeMode } from './hooks/useThemeMode';
import type { ViewMode } from './types/nexus';

function App() {
  const { sessions, usageTotals, connectionStatus } = useSessionsStream();
  const { theme, handleThemeTogglePointerDown, handleThemeToggleChange } = useThemeMode();
  const { visibleSessions } = useDisplayedSessions(sessions);
  const [showToolEvents, setShowToolEvents] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('normal');

  return (
    <div className="app">
      <HeaderMetrics
        theme={theme}
        usageTotals={usageTotals}
        connectionStatus={connectionStatus}
        showToolEvents={showToolEvents}
        viewMode={viewMode}
        onThemeTogglePointerDown={handleThemeTogglePointerDown}
        onThemeToggleChange={handleThemeToggleChange}
        onShowToolEventsChange={setShowToolEvents}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'normal' ? (
        <div className="sessions-grid">
          {visibleSessions.map((session) => (
            <SessionCard key={session.sessionId} session={session} showToolEvents={showToolEvents} />
          ))}
        </div>
      ) : (
        <div className="sessions-grid-dense">
          {visibleSessions.map((session) => (
            <DenseSessionCard key={session.sessionId} session={session} showToolEvents={showToolEvents} />
          ))}
        </div>
      )}

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

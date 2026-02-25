import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { TOOL_DISPLAY_ORDER } from '../constants/tools';
import type { BreakdownMetric, ConnectionStatus, ThemeMode, UsageTotalsPayload, ViewMode } from '../types/nexus';
import { formatTokens, formatUsd, getToolLabel } from '../utils/formatters';
import { AnimatedMetricValue } from './AnimatedMetricValue';

interface HeaderMetricsProps {
  theme: ThemeMode;
  usageTotals: UsageTotalsPayload;
  connectionStatus: ConnectionStatus;
  showToolEvents: boolean;
  viewMode: ViewMode;
  onThemeTogglePointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onThemeToggleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onShowToolEventsChange: (checked: boolean) => void;
  onViewModeChange: (mode: ViewMode) => void;
}

export function HeaderMetrics({
  theme,
  usageTotals,
  connectionStatus,
  showToolEvents,
  viewMode,
  onThemeTogglePointerDown,
  onThemeToggleChange,
  onShowToolEventsChange,
  onViewModeChange
}: HeaderMetricsProps) {
  const [hoveredBreakdownMetric, setHoveredBreakdownMetric] = useState<BreakdownMetric | null>(null);
  const [pinnedBreakdownMetric, setPinnedBreakdownMetric] = useState<BreakdownMetric | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.metric-card-interactive')) {
        setPinnedBreakdownMetric(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinnedBreakdownMetric(null);
        setHoveredBreakdownMetric(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const orderedTools = useMemo(() => {
    return [
      ...TOOL_DISPLAY_ORDER,
      ...Object.keys(usageTotals.byTool).filter(
        (tool) => !TOOL_DISPLAY_ORDER.includes(tool as typeof TOOL_DISPLAY_ORDER[number])
      )
    ];
  }, [usageTotals.byTool]);

  const toolBreakdown = useMemo(() => {
    return orderedTools.map((tool) => {
      const summary = usageTotals.byTool[tool];
      return {
        tool,
        label: getToolLabel(tool),
        totalTokens: Number(summary?.totalTokens || 0),
        totalCostUsd: Number(summary?.totalCostUsd || 0)
      };
    });
  }, [orderedTools, usageTotals.byTool]);

  const activeBreakdownMetric = pinnedBreakdownMetric ?? hoveredBreakdownMetric;
  const costPrecision = usageTotals.totals.runningAgents > 0 ? 4 : 2;

  const handleBreakdownCardClick = (metric: BreakdownMetric) => {
    setPinnedBreakdownMetric((prev) => (prev === metric ? null : metric));
  };

  const handleBreakdownCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, metric: BreakdownMetric) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleBreakdownCardClick(metric);
      return;
    }

    if (event.key === 'Escape') {
      setPinnedBreakdownMetric(null);
      setHoveredBreakdownMetric(null);
    }
  };

  return (
    <header className="header sticky top-0 z-50 flex flex-wrap items-center justify-between gap-5 border-b-[3px] border-[var(--color-border)] bg-[var(--color-bg-primary)] px-10 py-8">
      <div className="header-left flex items-center gap-4">
        <img
          src="/logo-mark-white.png"
          alt="Nexus Logo"
          className={`header-logo block h-[34px] w-auto object-contain ${theme === 'light' ? 'header-logo-light' : ''}`}
        />
        <h1>Nexus</h1>
      </div>

      <div className="header-metrics flex min-w-[420px] flex-1 flex-col gap-2.5 max-md:order-3 max-md:min-w-0 max-md:w-full">
        <div className="metric-cards-grid grid w-full grid-cols-3 gap-2.5 max-md:grid-cols-1">
          <div className="metric-card metric-card-summary flex min-h-[86px] flex-col justify-start border-2 border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5">
            <div className="metric-label">Running Agents</div>
            <AnimatedMetricValue
              value={usageTotals.totals.runningAgents}
              format={formatTokens}
            />
          </div>

          <div
            className={`metric-card metric-card-summary metric-card-interactive relative flex min-h-[86px] cursor-pointer flex-col justify-start border-2 border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5 ${activeBreakdownMetric === 'tokens' ? 'is-open' : ''}`}
            role="button"
            tabIndex={0}
            aria-expanded={activeBreakdownMetric === 'tokens'}
            aria-haspopup="dialog"
            onMouseEnter={() => setHoveredBreakdownMetric('tokens')}
            onMouseLeave={() => setHoveredBreakdownMetric((prev) => (prev === 'tokens' ? null : prev))}
            onClick={() => handleBreakdownCardClick('tokens')}
            onKeyDown={(event) => handleBreakdownCardKeyDown(event, 'tokens')}
          >
            <div className="metric-label">Total Tokens</div>
            <AnimatedMetricValue
              value={usageTotals.totals.totalTokens}
              format={formatTokens}
            />
            {activeBreakdownMetric === 'tokens' && (
              <div className="metric-hover-breakdown" role="dialog" aria-label="Total tokens breakdown by tool">
                <div className="metric-hover-breakdown-title">By Tool</div>
                {toolBreakdown.map((item) => (
                  <div key={`tokens-hover-${item.tool}`} className="metric-hover-breakdown-row">
                    <span className="metric-hover-breakdown-label">{item.label}</span>
                    <span className="metric-hover-breakdown-value">{formatTokens(item.totalTokens)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className={`metric-card metric-card-summary metric-card-interactive relative flex min-h-[86px] cursor-pointer flex-col justify-start border-2 border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5 ${activeBreakdownMetric === 'cost' ? 'is-open' : ''}`}
            role="button"
            tabIndex={0}
            aria-expanded={activeBreakdownMetric === 'cost'}
            aria-haspopup="dialog"
            onMouseEnter={() => setHoveredBreakdownMetric('cost')}
            onMouseLeave={() => setHoveredBreakdownMetric((prev) => (prev === 'cost' ? null : prev))}
            onClick={() => handleBreakdownCardClick('cost')}
            onKeyDown={(event) => handleBreakdownCardKeyDown(event, 'cost')}
          >
            <div className="metric-label">Total Cost (USD)</div>
            <AnimatedMetricValue
              value={usageTotals.totals.totalCostUsd}
              format={(value) => formatUsd(value, costPrecision)}
              precision={costPrecision}
            />
            {activeBreakdownMetric === 'cost' && (
              <div className="metric-hover-breakdown" role="dialog" aria-label="Total cost breakdown by tool">
                <div className="metric-hover-breakdown-title">By Tool</div>
                {toolBreakdown.map((item) => (
                  <div key={`cost-hover-${item.tool}`} className="metric-hover-breakdown-row">
                    <span className="metric-hover-breakdown-label">{item.label}</span>
                    <span className="metric-hover-breakdown-value">{formatUsd(item.totalCostUsd, costPrecision)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {usageTotals.backfill.status === 'running' && (
          <div className="metric-backfill">
            Backfilling history...
            {usageTotals.backfill.totalFiles > 0 ? ` (${usageTotals.backfill.scannedFiles}/${usageTotals.backfill.totalFiles})` : ''}
          </div>
        )}
      </div>

      <div className="header-controls flex items-center gap-6 max-md:w-full max-md:justify-between">
        <button
          className={`view-mode-btn ${viewMode === 'dense' ? 'view-mode-btn-active' : ''}`}
          onClick={() => onViewModeChange(viewMode === 'normal' ? 'dense' : 'normal')}
          title={viewMode === 'normal' ? 'Switch to dense mode' : 'Switch to normal mode'}
          aria-label={viewMode === 'normal' ? 'Switch to dense mode' : 'Switch to normal mode'}
        >
          {viewMode === 'normal' ? '⊞ Dense' : '⊟ Normal'}
        </button>

        <label className="toggle">
          <input
            type="checkbox"
            checked={theme === 'dark'}
            onPointerDown={onThemeTogglePointerDown}
            onChange={onThemeToggleChange}
          />
          <span>Night mode</span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={showToolEvents}
            onChange={(event) => onShowToolEventsChange(event.target.checked)}
          />
          <span>Tool events</span>
        </label>

        <div className={`status status-${connectionStatus}`}>
          {connectionStatus === 'connected' ? '● Connected' : connectionStatus === 'connecting' ? '○ Connecting...' : '○ Disconnected'}
        </div>
      </div>
    </header>
  );
}

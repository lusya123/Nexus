import { useMemo, useState } from 'react';
import type { UsageDailyModelPoint, UsageDailyPoint, UsageTotalsPayload } from '../types/nexus';
import { formatTokens, formatUsd } from '../utils/formatters';

interface UsageBreakdownPanelProps {
  usageTotals: UsageTotalsPayload;
}

type BreakdownMetric = 'tokens' | 'cost';

type ChartLine = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

type PieItem = {
  label: string;
  value: number;
  color: string;
  percent: number;
};

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function buildLinePath(values: number[], xAt: (index: number) => number, yAt: (value: number) => number): string {
  if (values.length === 0) return '';
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index)} ${yAt(value)}`).join(' ');
}

function toPieArcPath(cx: number, cy: number, radius: number, startAngleDeg: number, endAngleDeg: number): string {
  const toPoint = (angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  const start = toPoint(startAngleDeg);
  const end = toPoint(endAngleDeg);
  const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    'Z'
  ].join(' ');
}

function UsageLineChart({
  dates,
  metric,
  lines
}: {
  dates: string[];
  metric: BreakdownMetric;
  lines: ChartLine[];
}) {
  const width = 760;
  const height = 230;
  const padding = { left: 64, right: 14, top: 16, bottom: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...lines.flatMap((line) => line.values));
  const yTicks = 4;
  const xDenominator = Math.max(dates.length - 1, 1);
  const valueFormatter = metric === 'tokens'
    ? (value: number) => formatTokens(value)
    : (value: number) => formatUsd(value, 4);

  const xAt = (index: number) => padding.left + (index / xDenominator) * chartWidth;
  const yAt = (value: number) => padding.top + chartHeight - ((Math.max(0, value) / maxValue) * chartHeight);

  return (
    <div className="usage-chart-wrap">
      <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} usage trend`}>
        {Array.from({ length: yTicks + 1 }).map((_, index) => {
          const ratio = index / yTicks;
          const y = padding.top + (chartHeight * ratio);
          const tickValue = maxValue * (1 - ratio);
          return (
            <g key={`grid-${index}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="usage-chart-grid"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="usage-chart-axis">
                {valueFormatter(tickValue)}
              </text>
            </g>
          );
        })}

        {lines.map((line) => (
          <path
            key={line.key}
            d={buildLinePath(line.values, xAt, yAt)}
            fill="none"
            stroke={line.color}
            strokeWidth={line.key === 'total' ? 3 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {dates.length > 0 && (
          <>
            <text x={padding.left} y={height - 10} textAnchor="start" className="usage-chart-axis">
              {formatDateLabel(dates[0])}
            </text>
            <text x={padding.left + (chartWidth / 2)} y={height - 10} textAnchor="middle" className="usage-chart-axis">
              {formatDateLabel(dates[Math.floor((dates.length - 1) / 2)])}
            </text>
            <text x={width - padding.right} y={height - 10} textAnchor="end" className="usage-chart-axis">
              {formatDateLabel(dates[dates.length - 1])}
            </text>
          </>
        )}
      </svg>

      <div className="usage-chart-legend">
        {lines.map((line) => (
          <div key={`legend-${line.key}`} className="usage-chart-legend-item">
            <span className="usage-chart-legend-dot" style={{ background: line.color }} />
            <span className="usage-chart-legend-label">{line.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsagePieChart({
  metric,
  items
}: {
  metric: BreakdownMetric;
  items: PieItem[];
}) {
  const size = 230;
  const center = size / 2;
  const radius = 86;
  const valueFormatter = metric === 'tokens'
    ? (value: number) => formatTokens(value)
    : (value: number) => formatUsd(value, 4);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="usage-pie-wrap">
      <svg className="usage-pie-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${metric} distribution by model`}>
        {items.length === 1 ? (
          <circle cx={center} cy={center} r={radius} fill={items[0].color} />
        ) : (
          items.map((item, index) => {
            const start = items.slice(0, index).reduce((sum, current) => sum + current.percent, 0) * 360;
            const end = start + (item.percent * 360);
            return (
              <path
                key={`pie-${item.label}`}
                d={toPieArcPath(center, center, radius, start, end)}
                fill={item.color}
              />
            );
          })
        )}

        <circle cx={center} cy={center} r={44} fill="var(--color-bg-primary)" />
        <text x={center} y={center - 4} textAnchor="middle" className="usage-pie-total-label">
          Total
        </text>
        <text x={center} y={center + 18} textAnchor="middle" className="usage-pie-total-value">
          {valueFormatter(total)}
        </text>
      </svg>

      <div className="usage-pie-legend">
        {items.map((item) => (
          <div key={`pie-legend-${item.label}`} className="usage-pie-legend-item">
            <span className="usage-chart-legend-dot" style={{ background: item.color }} />
            <span className="usage-pie-legend-model">{item.label}</span>
            <span className="usage-pie-legend-number">{valueFormatter(item.value)}</span>
            <span className="usage-pie-legend-percent">{(item.percent * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildLines({
  metric,
  dates,
  daily,
  dailyByModel,
  models
}: {
  metric: BreakdownMetric;
  dates: string[];
  daily: UsageDailyPoint[];
  dailyByModel: UsageDailyModelPoint[];
  models: string[];
}): ChartLine[] {
  const valueKey = metric === 'tokens' ? 'totalTokens' : 'totalCostUsd';
  const dailyMap = new Map(daily.map((item) => [item.date, Number(item[valueKey] || 0)]));
  const dailyModelMap = new Map(dailyByModel.map((item) => [`${item.date}::${item.model}`, Number(item[valueKey] || 0)]));

  const lines: ChartLine[] = [
    {
      key: 'total',
      label: 'Total',
      color: CHART_COLORS[0],
      values: dates.map((date) => dailyMap.get(date) || 0)
    }
  ];

  models.forEach((model, index) => {
    lines.push({
      key: model,
      label: model,
      color: CHART_COLORS[(index + 1) % CHART_COLORS.length],
      values: dates.map((date) => dailyModelMap.get(`${date}::${model}`) || 0)
    });
  });

  return lines;
}

function buildPieItems(metric: BreakdownMetric, byModel: UsageTotalsPayload['detailed']['byModel']): PieItem[] {
  const valueKey = metric === 'tokens' ? 'totalTokens' : 'totalCostUsd';
  const ranked = byModel
    .map((item) => ({
      label: item.model,
      value: Number(item[valueKey] || 0)
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (ranked.length === 0) return [];

  const top = ranked.slice(0, 5);
  const others = ranked.slice(5).reduce((sum, item) => sum + item.value, 0);
  const raw = others > 0 ? [...top, { label: 'Others', value: others }] : top;
  const total = raw.reduce((sum, item) => sum + item.value, 0) || 1;

  return raw.map((item, index) => ({
    ...item,
    color: CHART_COLORS[index % CHART_COLORS.length],
    percent: item.value / total
  }));
}

export function UsageBreakdownPanel({ usageTotals }: UsageBreakdownPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const daily = usageTotals.detailed?.daily || [];
  const byModel = usageTotals.detailed?.byModel || [];
  const dailyByModel = usageTotals.detailed?.dailyByModel || [];

  const hasUsageBreakdown = daily.length > 0;

  const chartDates = useMemo(() => daily.map((item) => item.date).sort((a, b) => a.localeCompare(b)), [daily]);
  const recentDaily = useMemo(() => daily.slice(-10).reverse(), [daily]);

  const tokenRankedModels = useMemo(
    () => byModel
      .filter((item) => Number(item.totalTokens) > 0)
      .sort((a, b) => Number(b.totalTokens) - Number(a.totalTokens)),
    [byModel]
  );

  const costRankedModels = useMemo(
    () => byModel
      .filter((item) => Number(item.totalCostUsd) > 0)
      .sort((a, b) => Number(b.totalCostUsd) - Number(a.totalCostUsd)),
    [byModel]
  );

  const topTokenModels = useMemo(
    () => tokenRankedModels
      .slice(0, 5)
      .map((item) => item.model),
    [tokenRankedModels]
  );

  const topCostModels = useMemo(
    () => costRankedModels
      .slice(0, 5)
      .map((item) => item.model),
    [costRankedModels]
  );

  const tokenLines = useMemo(
    () => buildLines({
      metric: 'tokens',
      dates: chartDates,
      daily,
      dailyByModel,
      models: topTokenModels
    }),
    [chartDates, daily, dailyByModel, topTokenModels]
  );

  const costLines = useMemo(
    () => buildLines({
      metric: 'cost',
      dates: chartDates,
      daily,
      dailyByModel,
      models: topCostModels
    }),
    [chartDates, daily, dailyByModel, topCostModels]
  );

  const tokenPieItems = useMemo(() => buildPieItems('tokens', byModel), [byModel]);
  const costPieItems = useMemo(() => buildPieItems('cost', byModel), [byModel]);

  if (!hasUsageBreakdown) {
    return null;
  }

  return (
    <>
      <div className="usage-breakdown-toggle">
        <button className="usage-breakdown-toggle-btn" onClick={() => setIsOpen((prev) => !prev)}>
          {isOpen ? 'Hide Detailed Usage' : 'Show Detailed Usage'}
        </button>
      </div>

      {isOpen && (
        <section className="usage-breakdown">
          <div className="usage-breakdown-card">
            <div className="usage-breakdown-title">Tokens by Day + Model</div>
            <UsageLineChart dates={chartDates} metric="tokens" lines={tokenLines} />
            <div className="usage-breakdown-grids">
              <div className="usage-breakdown-grid">
                <div className="usage-breakdown-subtitle">Model Share (Pie)</div>
                <UsagePieChart metric="tokens" items={tokenPieItems} />
              </div>

              <div className="usage-breakdown-grid">
                <div className="usage-breakdown-subtitle">Model Ranking (DESC)</div>
                {tokenRankedModels.slice(0, 10).map((item) => (
                  <div key={`tokens-model-${item.model}`} className="usage-breakdown-row">
                    <span>{item.model}</span>
                    <span>{formatTokens(item.totalTokens)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="usage-breakdown-grid">
              <div className="usage-breakdown-subtitle">Recent Daily</div>
              {recentDaily.map((item) => (
                <div key={`tokens-day-${item.date}`} className="usage-breakdown-row">
                  <span>{item.date}</span>
                  <span>{formatTokens(item.totalTokens)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="usage-breakdown-card">
            <div className="usage-breakdown-title">Cost by Day + Model (USD)</div>
            <UsageLineChart dates={chartDates} metric="cost" lines={costLines} />
            <div className="usage-breakdown-grids">
              <div className="usage-breakdown-grid">
                <div className="usage-breakdown-subtitle">Model Share (Pie)</div>
                <UsagePieChart metric="cost" items={costPieItems} />
              </div>

              <div className="usage-breakdown-grid">
                <div className="usage-breakdown-subtitle">Model Ranking (DESC)</div>
                {costRankedModels.slice(0, 10).map((item) => (
                  <div key={`cost-model-${item.model}`} className="usage-breakdown-row">
                    <span>{item.model}</span>
                    <span>{formatUsd(item.totalCostUsd, 4)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="usage-breakdown-grid">
              <div className="usage-breakdown-subtitle">Recent Daily</div>
              {recentDaily.map((item) => (
                <div key={`cost-day-${item.date}`} className="usage-breakdown-row">
                  <span>{item.date}</span>
                  <span>{formatUsd(item.totalCostUsd, 4)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

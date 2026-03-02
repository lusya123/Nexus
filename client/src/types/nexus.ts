export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export type MessageKind = 'text' | 'tool_call' | 'tool_output';
export type ThemeMode = 'light' | 'dark';
export type ViewMode = 'normal' | 'dense';
export type BreakdownMetric = 'tokens' | 'cost';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type ThemeTransitionOrigin = {
  x: number;
  y: number;
};

export type ThemeViewTransitionApi = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

export interface Session {
  sessionId: string;
  tool: string;
  name: string;
  messages: Message[];
  state: 'active' | 'idle' | 'cooling' | 'gone';
  lastModified: number;
}

export interface UsageToolSummary {
  totalTokens: number;
  totalCostUsd: number;
  runningAgents: number;
}

export interface UsageDailyPoint {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
}

export interface UsageModelPoint {
  model: string;
  totalTokens: number;
  totalCostUsd: number;
}

export interface UsageDailyModelPoint {
  date: string;
  model: string;
  totalTokens: number;
  totalCostUsd: number;
}

export interface UsageDetailedBreakdown {
  daily: UsageDailyPoint[];
  byModel: UsageModelPoint[];
  dailyByModel: UsageDailyModelPoint[];
}

export interface UsageTotalsPayload {
  scope: 'all_history';
  totals: {
    runningAgents: number;
    totalTokens: number;
    totalCostUsd: number;
  };
  byTool: Record<string, UsageToolSummary>;
  detailed: UsageDetailedBreakdown;
  backfill: {
    status: 'running' | 'done';
    scannedFiles: number;
    totalFiles: number;
  };
  updatedAt: number;
}

export interface ServerMessage {
  type: string;
  sessionId?: string;
  tool?: string;
  name?: string;
  state?: Session['state'];
  lastModified?: number;
  message?: Message;
  messages?: Message[];
  sessions?: Session[];
  usageTotals?: UsageTotalsPayload;
  scope?: UsageTotalsPayload['scope'];
  totals?: UsageTotalsPayload['totals'];
  byTool?: UsageTotalsPayload['byTool'];
  detailed?: UsageTotalsPayload['detailed'];
  backfill?: UsageTotalsPayload['backfill'];
  updatedAt?: number;
}

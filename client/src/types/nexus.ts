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

export interface UsageTotalsPayload {
  scope: 'all_history';
  totals: {
    runningAgents: number;
    totalTokens: number;
    totalCostUsd: number;
  };
  byTool: Record<string, UsageToolSummary>;
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
  backfill?: UsageTotalsPayload['backfill'];
  updatedAt?: number;
}

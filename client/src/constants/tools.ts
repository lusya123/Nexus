export const TOOL_CONFIG: Record<string, { label: string; color: string; borderColor: string }> = {
  'claude-code': {
    label: 'Claude Code',
    color: '#60a5fa',
    borderColor: '#3b82f6'
  },
  codex: {
    label: 'Codex',
    color: '#4ade80',
    borderColor: '#22c55e'
  },
  openclaw: {
    label: 'OpenClaw',
    color: '#c084fc',
    borderColor: '#a855f7'
  }
};

export const TOOL_DISPLAY_ORDER = ['claude-code', 'codex', 'openclaw'] as const;

export const THEME_STORAGE_KEY = 'nexus-theme-mode';

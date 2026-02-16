import { TOOL_CONFIG } from '../constants/tools';

export function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value || 0)));
}

export function formatUsd(value: number): string {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `$${n.toFixed(2)}`;
}

export function getToolLabel(tool: string): string {
  return TOOL_CONFIG[tool]?.label || tool;
}

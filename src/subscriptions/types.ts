export type SubscriptionKey = 'claude-code' | 'codex';

export interface SubscriptionLimit {
  id: string;
  label: string;
  remainingFraction: number;
  resetTime: Date | null;
  windowMinutes: number | null;
}

export interface SubscriptionUsage {
  key: SubscriptionKey;
  name: string;
  description: string;
  account: string | null;
  source: string;
  limits: SubscriptionLimit[];
  error: string | null;
  lastUpdatedAt: Date | null;
}

export function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseResetTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

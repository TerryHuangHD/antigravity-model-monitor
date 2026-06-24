import { FetchAvailableModelsResponse } from '../api/cloudCodeClient';

export interface ModelEntry {
  modelId: string;
  label: string;
  remainingFraction: number;
  resetTime: Date | null;
}

export interface FamilyGroup {
  key: string;            // stable identifier (e.g. "claude", "gemini")
  autoName: string;       // capitalized display (e.g. "Claude", "Gemini")
  members: ModelEntry[];  // sorted by label
  minRemainingFraction: number;
}

export interface ParsedSnapshot {
  groups: FamilyGroup[];
  totalModelCount: number;
}

/**
 * Family detection rules aligned with Antigravity's built-in quota dashboard.
 * The official UI rolls model rows up into two cards: Gemini, and Claude/GPT.
 */
const FAMILY_RULES: Array<{ key: string; display: string; pattern: RegExp }> = [
  { key: 'gemini', display: 'Gemini Models', pattern: /\bgemini\b/ },
];

function detectFamily(entry: ModelEntry): { key: string; display: string } {
  const haystack = (entry.label + ' ' + entry.modelId).toLowerCase();
  if (/\bmodel_placeholder_m(?:47|37|36)\b/.test(haystack)) {
    return { key: 'gemini', display: 'Gemini Models' };
  }
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(haystack)) return { key: rule.key, display: rule.display };
  }
  return { key: 'claude-gpt', display: 'Claude and GPT models' };
}

// Antigravity's local language server (GetUserStatus) reports a single quota window
// per model: the one that is currently binding. When the five-hour limit is the
// active constraint the resetTime is hours away; when the weekly limit binds it is
// days away. We label the limit from that reset window rather than fabricating two
// separate rows, because only one window is ever present in the data.
const FIVE_HOUR_WINDOW_MAX_MS = 6 * 60 * 60 * 1000;

function limitLabel(resetTime: Date | null, now: number): string {
  if (!resetTime) return 'Quota';
  return resetTime.getTime() - now <= FIVE_HOUR_WINDOW_MAX_MS ? 'Five Hour Limit' : 'Weekly Limit';
}

function getLowestLimit(items: ModelEntry[]): { remainingFraction: number; resetTime: Date | null } {
  if (items.length === 0) return { remainingFraction: 1, resetTime: null };
  let minItem = items[0];
  for (const item of items) {
    if (item.remainingFraction < minItem.remainingFraction) {
      minItem = item;
    } else if (item.remainingFraction === minItem.remainingFraction) {
      if (item.resetTime && (!minItem.resetTime || item.resetTime > minItem.resetTime)) {
        minItem = item;
      }
    }
  }
  return {
    remainingFraction: minItem.remainingFraction,
    resetTime: minItem.resetTime
  };
}

export function parseSnapshot(response: FetchAvailableModelsResponse, now: number = Date.now()): ParsedSnapshot {
  const models = response.models ?? {};
  const entries: ModelEntry[] = [];

  for (const [key, info] of Object.entries(models)) {
    if (!info || info.disabled) continue;
    const q = info.quotaInfo;
    if (!q || typeof q.remainingFraction !== 'number') continue;
    if (q.remainingFraction < 0 || q.remainingFraction > 1) continue;

    let resetTime: Date | null = null;
    if (q.resetTime) {
      const parsed = new Date(q.resetTime);
      if (!Number.isNaN(parsed.getTime())) resetTime = parsed;
    }

    entries.push({
      modelId: info.model || key,
      label: (info.displayName ?? '').trim() || key,
      remainingFraction: q.remainingFraction,
      resetTime
    });
  }

  return { groups: groupByFamily(entries, now), totalModelCount: entries.length };
}

export function groupByFamily(entries: ModelEntry[], now: number = Date.now()): FamilyGroup[] {
  const byFamily = new Map<string, { display: string; entries: ModelEntry[] }>();

  for (const entry of entries) {
    const family = detectFamily(entry);
    const bucket = byFamily.get(family.key) ?? { display: family.display, entries: [] };
    bucket.entries.push(entry);
    byFamily.set(family.key, bucket);
  }

  const groups: FamilyGroup[] = [];
  for (const [key, bucket] of byFamily) {
    const binding = getLowestLimit(bucket.entries);
    const members: ModelEntry[] = [
      {
        modelId: `${key}-limit`,
        label: limitLabel(binding.resetTime, now),
        remainingFraction: binding.remainingFraction,
        resetTime: binding.resetTime
      }
    ];
    groups.push({
      key,
      autoName: bucket.display,
      members,
      minRemainingFraction: binding.remainingFraction
    });
  }

  groups.sort((a, b) => a.minRemainingFraction - b.minRemainingFraction);

  return groups;
}

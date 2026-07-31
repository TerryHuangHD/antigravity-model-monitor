import { FetchAvailableModelsResponse } from '../api/cloudCodeClient';

export interface ModelEntry {
  modelId: string;
  label: string;
  remainingFraction: number;
  resetTime: Date | null;
}

export interface QuotaSummaryBucket {
  bucketId: string;
  displayName: string;
  description: string | null;
  window: string | null;
  remainingFraction: number;
  resetTime: Date | null;
}

export interface QuotaSummaryGroup {
  displayName: string;
  description: string | null;
  buckets: QuotaSummaryBucket[];
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

function detectSummaryFamily(group: QuotaSummaryGroup, index: number): { key: string; display: string } {
  const display = group.displayName.trim();
  const haystack = `${display} ${group.buckets.map((bucket) => bucket.bucketId).join(' ')}`.toLowerCase();
  if (/\bgemini\b/.test(haystack)) return { key: 'gemini', display: display || 'Gemini Models' };
  if (/\bclaude\b|\bgpt\b|\b3p(?:-|\b)/.test(haystack)) {
    return { key: 'claude-gpt', display: display || 'Claude and GPT models' };
  }

  const slug = display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { key: slug || `quota-group-${index + 1}`, display: display || `Quota Group ${index + 1}` };
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

/**
 * Converts Antigravity's authoritative quota-summary buckets into the same view
 * model used by the status bar and panel. Unlike model-level quotaInfo, this
 * endpoint exposes the five-hour and weekly windows independently.
 */
export function parseQuotaSummary(summaryGroups: QuotaSummaryGroup[]): ParsedSnapshot {
  const groups: FamilyGroup[] = [];
  let totalLimitCount = 0;

  for (let index = 0; index < summaryGroups.length; index++) {
    const summaryGroup = summaryGroups[index];
    if (summaryGroup.buckets.length === 0) continue;

    const family = detectSummaryFamily(summaryGroup, index);
    const members = summaryGroup.buckets.map((bucket, bucketIndex): ModelEntry => ({
      modelId: bucket.bucketId || `${family.key}-${bucket.window || bucketIndex + 1}`,
      label: bucket.displayName || bucket.window || 'Quota',
      remainingFraction: bucket.remainingFraction,
      resetTime: bucket.resetTime
    }));
    const minRemainingFraction = members.reduce(
      (lowest, member) => Math.min(lowest, member.remainingFraction),
      1
    );

    totalLimitCount += members.length;
    groups.push({
      key: family.key,
      autoName: family.display,
      members,
      minRemainingFraction
    });
  }

  groups.sort((a, b) => a.minRemainingFraction - b.minRemainingFraction);
  return { groups, totalModelCount: totalLimitCount };
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

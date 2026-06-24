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
 * Family detection rules. Order matters — first match wins.
 * Patterns are matched against the lower-cased display label first, then the
 * lower-cased model id, so the API's `displayName` drives the bucket when present.
 */
const FAMILY_RULES: Array<{ key: string; display: string; pattern: RegExp }> = [
  { key: 'gemini',  display: 'Gemini Models',  pattern: /\bgemini\b/ },
];

function detectFamily(entry: ModelEntry): { key: string; display: string } {
  const haystack = (entry.label + ' ' + entry.modelId).toLowerCase();
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(haystack)) return { key: rule.key, display: rule.display };
  }
  return { key: 'claude-gpt', display: 'Claude and GPT models' };
}

function isWeeklyLimitModel(entry: ModelEntry): boolean {
  const haystack = (entry.label + ' ' + entry.modelId).toLowerCase();
  return haystack.includes('low') || haystack.includes('extra-low') || haystack.includes('medium') || haystack.includes('sonnet');
}

export function parseSnapshot(response: FetchAvailableModelsResponse): ParsedSnapshot {
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

  return { groups: groupByFamily(entries), totalModelCount: entries.length };
}

export function groupByFamily(entries: ModelEntry[]): FamilyGroup[] {
  const geminiEntries: ModelEntry[] = [];
  const claudeGptEntries: ModelEntry[] = [];

  for (const entry of entries) {
    const family = detectFamily(entry);
    if (family.key === 'gemini') {
      geminiEntries.push(entry);
    } else {
      claudeGptEntries.push(entry);
    }
  }

  const buildGroup = (key: string, displayName: string, groupEntries: ModelEntry[]): FamilyGroup => {
    const weeklyEntries = groupEntries.filter(isWeeklyLimitModel);
    const fiveHourEntries = groupEntries.filter(e => !isWeeklyLimitModel(e));

    const getLimit = (items: ModelEntry[]): { remainingFraction: number; resetTime: Date | null } => {
      if (items.length === 0) return { remainingFraction: 1.0, resetTime: null };
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
    };

    const weekly = getLimit(weeklyEntries);
    const fiveHour = getLimit(fiveHourEntries);

    const members: ModelEntry[] = [
      {
        modelId: `${key}-5hour`,
        label: 'Five Hour Limit',
        remainingFraction: fiveHour.remainingFraction,
        resetTime: fiveHour.resetTime
      },
      {
        modelId: `${key}-weekly`,
        label: 'Weekly Limit',
        remainingFraction: weekly.remainingFraction,
        resetTime: weekly.resetTime
      }
    ];

    const minRemaining = Math.min(weekly.remainingFraction, fiveHour.remainingFraction);

    return {
      key,
      autoName: displayName,
      members,
      minRemainingFraction: minRemaining
    };
  };

  const groups: FamilyGroup[] = [];
  if (geminiEntries.length > 0) {
    groups.push(buildGroup('gemini', 'Gemini Models', geminiEntries));
  }
  if (claudeGptEntries.length > 0) {
    groups.push(buildGroup('claude-gpt', 'Claude and GPT models', claudeGptEntries));
  }

  groups.sort((a, b) => a.minRemainingFraction - b.minRemainingFraction);

  return groups;
}

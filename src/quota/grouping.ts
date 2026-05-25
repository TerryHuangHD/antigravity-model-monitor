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
  { key: 'claude',  display: 'Claude',  pattern: /\bclaude\b/ },
  { key: 'gemini',  display: 'Gemini',  pattern: /\bgemini\b/ },
  { key: 'gpt-oss', display: 'GPT-OSS', pattern: /\bgpt[-_ ]?oss\b/ },
  { key: 'gpt',     display: 'GPT',     pattern: /\bgpt\b/ },
  { key: 'llama',   display: 'Llama',   pattern: /\bllama\b/ },
  { key: 'mistral', display: 'Mistral', pattern: /\bmistral\b/ }
];

function detectFamily(entry: ModelEntry): { key: string; display: string } {
  const haystack = (entry.label + ' ' + entry.modelId).toLowerCase();
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(haystack)) return { key: rule.key, display: rule.display };
  }
  return { key: 'other', display: 'Other' };
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
  const buckets = new Map<string, { display: string; members: ModelEntry[] }>();

  for (const entry of entries) {
    const family = detectFamily(entry);
    const bucket = buckets.get(family.key);
    if (bucket) bucket.members.push(entry);
    else buckets.set(family.key, { display: family.display, members: [entry] });
  }

  const groups: FamilyGroup[] = [];
  for (const [key, bucket] of buckets.entries()) {
    bucket.members.sort((a, b) => a.label.localeCompare(b.label));
    const minRemaining = bucket.members.reduce(
      (m, e) => Math.min(m, e.remainingFraction),
      Infinity
    );
    groups.push({
      key,
      autoName: bucket.display,
      members: bucket.members,
      minRemainingFraction: Number.isFinite(minRemaining) ? minRemaining : 0
    });
  }

  // Sort: lowest remaining first so the most urgent family is leftmost in the
  // status bar. "Other" trails so well-known families sort first when tied.
  groups.sort((a, b) => {
    if (a.minRemainingFraction !== b.minRemainingFraction) {
      return a.minRemainingFraction - b.minRemainingFraction;
    }
    if (a.key === 'other') return 1;
    if (b.key === 'other') return -1;
    return a.autoName.localeCompare(b.autoName);
  });

  return groups;
}

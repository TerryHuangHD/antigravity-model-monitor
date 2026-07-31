import { ParsedSnapshot } from '../quota/grouping';
import { CustomNamesStore } from '../state/customNames';
import { SubscriptionUsage } from './types';

export interface AntigravityPresentationMeta {
  account: string | null;
  description: string | null;
  error: string | null;
  lastUpdatedAt: Date | null;
}

export interface MonitorContent {
  id: string;
  originalLabel: string;
  customName: string | null;
  name: string;
  hidden: boolean;
  remainingFraction: number;
  resetTime: Date | null;
  windowMinutes: number | null;
}

export interface MonitorSubscription {
  key: string;
  originalName: string;
  customName: string | null;
  name: string;
  hidden: boolean;
  description: string;
  account: string | null;
  source: string;
  error: string | null;
  lastUpdatedAt: Date | null;
  contents: MonitorContent[];
}

const EXTERNAL_DEFAULTS: Array<Pick<MonitorSubscription, 'key' | 'originalName' | 'description' | 'source'>> = [
  {
    key: 'claude-code',
    originalName: 'Claude Code',
    description: 'Claude subscription usage shared with Claude Code.',
    source: 'Claude Code OAuth usage'
  },
  {
    key: 'codex',
    originalName: 'Codex',
    description: 'ChatGPT Codex subscription usage from the local Codex app server.',
    source: 'codex app-server'
  }
];

export function buildMonitorSubscriptions(
  snapshot: ParsedSnapshot | null,
  externalUsages: readonly SubscriptionUsage[],
  names: CustomNamesStore,
  antigravity: AntigravityPresentationMeta
): MonitorSubscription[] {
  const subscriptions: MonitorSubscription[] = [
    buildAntigravitySubscription(snapshot, names, antigravity),
    ...EXTERNAL_DEFAULTS.map((defaults) => buildExternalSubscription(
      externalUsages.find((usage) => usage.key === defaults.key),
      defaults,
      names
    ))
  ];
  return names.orderSubscriptions(subscriptions);
}

function buildAntigravitySubscription(
  snapshot: ParsedSnapshot | null,
  names: CustomNamesStore,
  meta: AntigravityPresentationMeta
): MonitorSubscription {
  const contents: MonitorContent[] = [];
  const customizations = names.snapshot();
  for (const group of snapshot?.groups ?? []) {
    const storedGroupName = customizations.groups[group.key]?.trim();
    const legacyGroupName = storedGroupName
      ? normalizeDurationCase(storedGroupName)
      : compactQuotaLabel(group.autoName);
    for (const member of names.orderModels(group.key, group.members)) {
      const id = `antigravity:${group.key}:${member.modelId}`;
      const storedMemberName = customizations.models[member.modelId]?.trim();
      const legacyMemberName = storedMemberName
        ? normalizeDurationCase(storedMemberName)
        : compactQuotaLabel(member.label);
      const originalLabel = `${legacyGroupName} · ${legacyMemberName}`;
      const customName = customizations.contentNames[id] ?? null;
      const hiddenOverride = names.getContentHiddenOverride(id);
      contents.push({
        id,
        originalLabel,
        customName,
        name: names.getContentName(id, originalLabel),
        hidden: hiddenOverride ?? (
          names.isGroupHidden(group.key) || names.isModelHidden(member.modelId)
        ),
        remainingFraction: member.remainingFraction,
        resetTime: member.resetTime,
        windowMinutes: inferWindowMinutes(member.label)
      });
    }
  }

  return createSubscription({
    key: 'antigravity',
    originalName: 'Antigravity',
    description: meta.description || 'Antigravity model quota usage.',
    account: meta.account,
    source: 'Antigravity local language server',
    error: meta.error,
    lastUpdatedAt: meta.lastUpdatedAt,
    contents: names.orderContents('antigravity', contents)
  }, names);
}

function buildExternalSubscription(
  usage: SubscriptionUsage | undefined,
  defaults: Pick<MonitorSubscription, 'key' | 'originalName' | 'description' | 'source'>,
  names: CustomNamesStore
): MonitorSubscription {
  const customizations = names.snapshot();
  const contents = (usage?.limits ?? []).map((limit): MonitorContent => {
    const id = `${defaults.key}:${limit.id}`;
    const customName = customizations.contentNames[id] ?? null;
    const originalLabel = compactQuotaLabel(limit.label);
    return {
      id,
      originalLabel,
      customName,
      name: names.getContentName(id, originalLabel),
      hidden: names.isContentHidden(id),
      remainingFraction: limit.remainingFraction,
      resetTime: limit.resetTime,
      windowMinutes: limit.windowMinutes
    };
  });

  return createSubscription({
    ...defaults,
    account: usage?.account ?? null,
    error: usage?.error ?? null,
    lastUpdatedAt: usage?.lastUpdatedAt ?? null,
    contents: names.orderContents(defaults.key, contents)
  }, names);
}

function createSubscription(
  value: Omit<MonitorSubscription, 'customName' | 'name' | 'hidden'>,
  names: CustomNamesStore
): MonitorSubscription {
  const snapshot = names.snapshot();
  return {
    ...value,
    customName: snapshot.subscriptionNames[value.key] ?? null,
    name: names.getSubscriptionName(value.key, value.originalName),
    hidden: names.isSubscriptionHidden(value.key)
  };
}

function inferWindowMinutes(label: string): number | null {
  if (/five hour/i.test(label)) return 5 * 60;
  if (/weekly/i.test(label)) return 7 * 24 * 60;
  return null;
}

function compactQuotaLabel(label: string): string {
  return label
    .replace(/\bFive Hour Limit(?:\s*\(5H\))?/gi, '5h')
    .replace(/\bWeekly Limit(?:\s*\(7D\))?/gi, '7d')
    .replace(/\bWeekly\s+(.+?)\s+Limit(?:\s*\(7D\))?/gi, '$1 7d')
    .replace(/\b5H(?:\s+Limit)?\b/gi, '5h')
    .replace(/\b7D(?:\s+Limit)?\b/gi, '7d');
}

function normalizeDurationCase(label: string): string {
  return label
    .replace(/\b5H\b/g, '5h')
    .replace(/\b7D\b/g, '7d');
}

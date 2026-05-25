import * as vscode from 'vscode';
import { QuotaError, QuotaUpdate } from '../quota/refreshManager';
import { CustomNamesStore } from '../state/customNames';
import { FamilyGroup, ModelEntry } from '../quota/grouping';

export interface ThresholdConfig {
  warning: number;
  critical: number;
  notificationsEnabled: boolean;
  showCredits?: boolean;
}

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private latest: QuotaUpdate = {
    snapshot: null,
    availableCredits: null,
    error: null,
    lastUpdatedAt: null,
    isLoading: false
  };
  private notify = new Map<string, 'warning' | 'critical' | null>();

  constructor(
    private readonly names: CustomNamesStore,
    private thresholds: ThresholdConfig
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'agModelMonitor.openPanel';
    this.item.text = '$(sync~spin) AG Monitor';
    this.item.tooltip = 'Antigravity Model Monitor — loading...';
    this.item.show();
  }

  setThresholds(t: ThresholdConfig) {
    this.thresholds = t;
    this.render();
  }

  applyUpdate(update: QuotaUpdate) {
    this.latest = update;
    this.maybeNotify(update);
    this.render();
  }

  dispose() {
    this.item.dispose();
  }

  render() {
    const { latest, names, thresholds } = this;

    if (latest.error && !latest.snapshot) {
      this.item.text = `$(warning) AG Monitor`;
      this.item.tooltip = buildErrorTooltip(latest.error);
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }

    const snapshot = latest.snapshot;
    if (!snapshot || snapshot.groups.length === 0) {
      this.item.text = latest.isLoading ? `$(sync~spin) AG Monitor` : `$(warning) AG Monitor`;
      this.item.tooltip = snapshot ? 'No model quota data available.' : 'Loading…';
      this.item.backgroundColor = snapshot ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      return;
    }

    const visibleGroups = filterVisible(snapshot.groups, names);

    if (visibleGroups.length === 0) {
      // Everything hidden by the user — keep the bar visible but minimal.
      this.item.text = '$(eye-closed) AG Monitor';
      this.item.tooltip = buildAllHiddenTooltip(latest.availableCredits, latest.lastUpdatedAt);
      this.item.backgroundColor = undefined;
      return;
    }

    this.item.text = formatStatusBarText(visibleGroups, latest.availableCredits, names, thresholds);
    this.item.tooltip = buildTooltip(visibleGroups, latest.availableCredits, names, latest.lastUpdatedAt, latest.error);

    const overallPct = Math.round(visibleGroups[0].effectiveMinFraction * 100);
    this.item.backgroundColor = pickBackground(overallPct, thresholds);
  }

  private maybeNotify(update: QuotaUpdate) {
    if (!this.thresholds.notificationsEnabled || !update.snapshot) return;
    for (const group of update.snapshot.groups) {
      if (this.names.isGroupHidden(group.key)) continue;
      const visibleMembers = group.members.filter((m) => !this.names.isModelHidden(m.modelId));
      if (visibleMembers.length === 0) continue;
      const minFraction = visibleMembers.reduce((m, e) => Math.min(m, e.remainingFraction), Infinity);
      const pct = (Number.isFinite(minFraction) ? minFraction : 0) * 100;
      const level: 'critical' | 'warning' | null =
        pct <= this.thresholds.critical ? 'critical' :
          pct <= this.thresholds.warning ? 'warning' :
            null;
      const previous = this.notify.get(group.key) ?? null;
      this.notify.set(group.key, level);
      if (level && previous !== level) {
        const name = this.names.getGroupName(group.key, group.autoName);
        const message = level === 'critical'
          ? `Antigravity quota critical: ${name} at ${Math.round(pct)}% remaining.`
          : `Antigravity quota low: ${name} at ${Math.round(pct)}% remaining.`;
        if (level === 'critical') void vscode.window.showWarningMessage(message);
        else void vscode.window.showInformationMessage(message);
      }
    }
  }
}

// A FamilyGroup pruned to its visible members, with the recomputed min.
interface VisibleGroup {
  key: string;
  autoName: string;
  members: ModelEntry[];
  effectiveMinFraction: number;
}

function filterVisible(groups: FamilyGroup[], names: CustomNamesStore): VisibleGroup[] {
  const out: VisibleGroup[] = [];
  for (const g of groups) {
    if (names.isGroupHidden(g.key)) continue;
    const members = g.members.filter((m) => !names.isModelHidden(m.modelId));
    if (members.length === 0) continue;
    const min = members.reduce((acc, m) => Math.min(acc, m.remainingFraction), Infinity);
    out.push({
      key: g.key,
      autoName: g.autoName,
      members,
      effectiveMinFraction: Number.isFinite(min) ? min : 0
    });
  }
  out.sort((a, b) => a.effectiveMinFraction - b.effectiveMinFraction);
  return out;
}

function formatStatusBarText(
  groups: VisibleGroup[],
  credits: number | null,
  names: CustomNamesStore,
  thresholds: ThresholdConfig
): string {
  const parts: string[] = [];
  if (thresholds.showCredits && credits != null) parts.push(`$(rocket) Credits: ${formatNumber(credits)}`);
  for (const group of groups) {
    const pct = Math.round(group.effectiveMinFraction * 100);
    const dot = pickDot(pct, thresholds);
    const name = names.getGroupName(group.key, group.autoName);
    parts.push(`${dot} ${name}: ${pct}%`);
  }
  return parts.join('  ');
}

function pickDot(pct: number, t: ThresholdConfig): string {
  if (pct <= t.critical) return '🔴';
  if (pct <= t.warning) return '🟡';
  return '🟢';
}

function pickBackground(pct: number, t: ThresholdConfig): vscode.ThemeColor | undefined {
  if (pct <= t.critical) return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (pct <= t.warning) return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
}

function buildErrorTooltip(error: QuotaError): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown('### $(rocket) Antigravity Model Monitor\n\n');
  md.appendMarkdown(`**Error:** ${escapeMd(error.message)}\n\n`);
  md.appendMarkdown(`[Retry](command:agModelMonitor.refresh) · [Show logs](command:agModelMonitor.showLogs)`);
  return md;
}

function buildAllHiddenTooltip(credits: number | null, lastUpdatedAt: Date | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown('### $(rocket) Antigravity Model Monitor\n\n');
  if (credits != null) md.appendMarkdown(`$(database) **Credits:** ${formatNumber(credits)}\n\n`);
  md.appendMarkdown('_All families are hidden. Open the panel to show some._\n\n');
  if (lastUpdatedAt) md.appendMarkdown(`_Updated ${formatRelative(lastUpdatedAt, true)}._\n\n`);
  md.appendMarkdown('Click to open the management panel.');
  return md;
}

function buildTooltip(
  groups: VisibleGroup[],
  credits: number | null,
  names: CustomNamesStore,
  lastUpdatedAt: Date | null,
  error: QuotaError | null
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown('### $(rocket) Antigravity Model Monitor\n\n');

  if (credits != null) {
    md.appendMarkdown(`$(database) **Credits:** ${formatNumber(credits)}\n\n`);
  }

  for (const group of groups) {
    const groupName = names.getGroupName(group.key, group.autoName);
    md.appendMarkdown(`**${escapeMd(groupName)}**\n\n`);
    md.appendMarkdown('| | Model | | Remaining | Reset |\n');
    md.appendMarkdown('|---|---|---|---:|---|\n');
    for (const member of group.members /* already filtered to visible */) {
      const label = names.getModelName(member.modelId, member.label);
      const pct = member.remainingFraction * 100;
      const dot = renderDotIcon(pct);
      const bar = renderBar(member.remainingFraction);
      const pctText = formatPercent(pct);
      const reset = member.resetTime ? formatReset(member.resetTime) : '—';
      md.appendMarkdown(`| ${dot} | ${escapeMd(label)} | \`${bar}\` | ${pctText} | ${escapeMd(reset)} |\n`);
    }
    md.appendMarkdown('\n');
  }

  if (error) {
    md.appendMarkdown(`> ⚠️ Last refresh failed: ${escapeMd(error.message)}\n\n`);
  }

  const updatedAt = lastUpdatedAt ? `Updated ${formatRelative(lastUpdatedAt, true)}` : 'Loading…';
  md.appendMarkdown(`_${escapeMd(updatedAt)} · click to open the management panel._`);
  return md;
}

function renderDotIcon(pct: number): string {
  if (pct <= 10) return '🔴';
  if (pct <= 30) return '🟡';
  return '🟢';
}

function renderBar(fraction: number, width = 12): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const full = Math.round(clamped * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

function formatPercent(pct: number): string {
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(2)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatReset(resetTime: Date): string {
  const diffMs = resetTime.getTime() - Date.now();
  if (diffMs <= 0) return 'available';
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatRelative(date: Date, past = false): string {
  const diffMs = date.getTime() - Date.now();
  const ago = past || diffMs <= 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days > 0) label = `${days}d ${hours % 24}h`;
  else if (hours > 0) label = `${hours}h ${minutes % 60}m`;
  else if (minutes > 0) label = `${minutes}m`;
  else label = `${Math.max(1, Math.floor(abs / 1000))}s`;
  return ago ? `${label} ago` : `in ${label}`;
}

function escapeMd(s: string): string {
  return s.replace(/[|<>*_`[\]\\]/g, (c) => `\\${c}`);
}

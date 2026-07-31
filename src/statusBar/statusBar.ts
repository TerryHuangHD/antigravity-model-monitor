import * as vscode from 'vscode';
import { QuotaUpdate } from '../quota/refreshManager';
import { CustomNamesStore } from '../state/customNames';
import { buildMonitorSubscriptions, MonitorContent, MonitorSubscription } from '../subscriptions/presentation';

export interface ThresholdConfig {
  warning: number;
  critical: number;
  notificationsEnabled: boolean;
  showCredits?: boolean;
}

interface VisibleSubscription extends MonitorSubscription {
  contents: MonitorContent[];
}

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private latest: QuotaUpdate = {
    snapshot: null,
    availableCredits: null,
    subscriptions: [],
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
    this.item.text = '$(sync~spin) Subscription Usage';
    this.item.tooltip = 'AI Subscription Usage Monitor — loading...';
    this.item.show();
  }

  setThresholds(thresholds: ThresholdConfig): void {
    this.thresholds = thresholds;
    this.render();
  }

  applyUpdate(update: QuotaUpdate): void {
    this.latest = update;
    this.maybeNotify(update);
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  render(): void {
    const subscriptions = this.buildSubscriptions();
    const visible = visibleSubscriptions(subscriptions);
    const hasUsage = visible.some((subscription) => subscription.contents.length > 0);

    if (!hasUsage) {
      if (this.latest.isLoading) {
        this.item.text = '$(sync~spin) Subscription Usage';
        this.item.tooltip = 'Reading local subscription usage…';
        this.item.backgroundColor = undefined;
        return;
      }

      const errors = collectErrors(visible);
      this.item.text = errors.length > 0 ? '$(warning) Subscription Usage' : '$(eye-closed) Subscription Usage';
      this.item.tooltip = errors.length > 0
        ? buildErrorTooltip(errors)
        : buildAllHiddenTooltip(this.latest.lastUpdatedAt);
      this.item.backgroundColor = errors.length > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
      return;
    }

    this.item.text = formatStatusBarText(
      visible,
      this.latest.availableCredits,
      this.thresholds
    );
    this.item.tooltip = buildTooltip(visible, this.thresholds, this.latest.lastUpdatedAt);

    const fractions = visible.flatMap((subscription) => subscription.contents.map((content) => content.remainingFraction));
    const overallPercent = Math.round(Math.min(...fractions) * 100);
    this.item.backgroundColor = pickBackground(overallPercent, this.thresholds);
  }

  private maybeNotify(update: QuotaUpdate): void {
    if (!this.thresholds.notificationsEnabled) return;
    for (const subscription of visibleSubscriptions(this.buildSubscriptions(update))) {
      for (const content of subscription.contents) {
        this.notifyIfCrossed(
          `${subscription.key}:${content.id}`,
          `${subscription.name} ${content.name}`,
          content.remainingFraction
        );
      }
    }
  }

  private notifyIfCrossed(key: string, label: string, fraction: number): void {
    const percent = fraction * 100;
    const level: 'critical' | 'warning' | null =
      percent <= this.thresholds.critical ? 'critical' :
        percent <= this.thresholds.warning ? 'warning' :
          null;
    const previous = this.notify.get(key) ?? null;
    this.notify.set(key, level);
    if (!level || previous === level) return;

    const message = level === 'critical'
      ? `${label} is critical at ${Math.round(percent)}% remaining.`
      : `${label} is low at ${Math.round(percent)}% remaining.`;
    if (level === 'critical') void vscode.window.showWarningMessage(message);
    else void vscode.window.showInformationMessage(message);
  }

  private buildSubscriptions(update: QuotaUpdate = this.latest): MonitorSubscription[] {
    return buildMonitorSubscriptions(
      update.snapshot,
      update.subscriptions,
      this.names,
      {
        account: null,
        description: null,
        error: update.error?.message ?? null,
        lastUpdatedAt: update.lastUpdatedAt
      }
    );
  }
}

function visibleSubscriptions(subscriptions: MonitorSubscription[]): VisibleSubscription[] {
  return subscriptions
    .filter((subscription) => !subscription.hidden)
    .map((subscription) => ({
      ...subscription,
      contents: subscription.contents.filter((content) => !content.hidden)
    }));
}

function formatStatusBarText(
  subscriptions: VisibleSubscription[],
  credits: number | null,
  thresholds: ThresholdConfig
): string {
  const parts: string[] = [];
  for (const subscription of subscriptions) {
    if (subscription.key === 'antigravity' && thresholds.showCredits && credits != null) {
      parts.push(`$(rocket) ${subscription.name} Credits: ${formatNumber(credits)}`);
    }
    for (const content of subscription.contents) {
      const percent = Math.round(content.remainingFraction * 100);
      const label = content.customName ? content.name : shortContentName(content.name);
      parts.push(`${pickDot(percent, thresholds)} ${subscription.name} ${label}: ${percent}%`);
    }
  }
  return parts.join('  ');
}

function buildErrorTooltip(errors: string[]): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = true;
  markdown.appendMarkdown('### $(pulse) AI Subscription Usage\n\n');
  for (const error of errors) markdown.appendMarkdown(`- ${escapeMd(error)}\n`);
  markdown.appendMarkdown('\n[Retry](command:agModelMonitor.refresh) · [Show logs](command:agModelMonitor.showLogs)');
  return markdown;
}

function buildAllHiddenTooltip(lastUpdatedAt: Date | null): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = true;
  markdown.supportThemeIcons = true;
  markdown.appendMarkdown('### $(pulse) AI Subscription Usage\n\n');
  markdown.appendMarkdown('_No visible usage limits. Open the dashboard to review subscription and content visibility._\n\n');
  if (lastUpdatedAt) markdown.appendMarkdown(`_Updated ${formatRelative(lastUpdatedAt, true)}._\n\n`);
  markdown.appendMarkdown('Click to open the dashboard.');
  return markdown;
}

function buildTooltip(
  subscriptions: VisibleSubscription[],
  thresholds: ThresholdConfig,
  lastUpdatedAt: Date | null
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = true;
  markdown.supportThemeIcons = true;
  markdown.appendMarkdown('### $(pulse) AI Subscription Usage\n\n');

  for (const subscription of subscriptions) {
    markdown.appendMarkdown(`#### ${escapeMd(subscription.name)}\n\n`);
    if (subscription.account) markdown.appendMarkdown(`_${escapeMd(formatPlan(subscription.account))}_\n\n`);
    for (const content of subscription.contents) appendContent(markdown, content, thresholds);
    if (subscription.error) {
      const prefix = subscription.contents.length > 0 ? 'Last refresh failed' : 'Unavailable';
      markdown.appendMarkdown(`> ⚠️ ${prefix}: ${escapeMd(subscription.error)}\n\n`);
    }
  }

  markdown.appendMarkdown('---\n\n');
  const updatedAt = lastUpdatedAt ? `Updated ${formatRelative(lastUpdatedAt, true)}` : 'Refreshing sources…';
  markdown.appendMarkdown(`_${escapeMd(updatedAt)}_\n\n`);
  markdown.appendMarkdown('[$(dashboard) Open dashboard](command:agModelMonitor.openPanel) · [$(refresh) Refresh now](command:agModelMonitor.refresh)');
  return markdown;
}

function appendContent(
  markdown: vscode.MarkdownString,
  content: MonitorContent,
  thresholds: ThresholdConfig
): void {
  const percent = content.remainingFraction * 100;
  const bar = renderBar(content.remainingFraction, 16);
  markdown.appendMarkdown(`> ${pickDot(percent, thresholds)} **${escapeMd(content.name)}** · **${formatPercent(percent)} remaining**  \n`);
  markdown.appendMarkdown(`> \`${bar}\`  \n`);
  if (content.resetTime) {
    const reset = formatResetDetails(content.resetTime);
    markdown.appendMarkdown(reset.available
      ? '> $(check) Available now\n\n'
      : `> $(clock) Resets in **${escapeMd(reset.relative)}** · \`${escapeMd(reset.absolute)}\`\n\n`);
  } else {
    markdown.appendMarkdown('> $(clock) Reset time unavailable\n\n');
  }
}

function collectErrors(subscriptions: VisibleSubscription[]): string[] {
  return subscriptions
    .filter((subscription) => subscription.error)
    .map((subscription) => `${subscription.name}: ${subscription.error}`);
}

function shortContentName(name: string): string {
  return name
    .replace(/Five Hour Limit/gi, '5h')
    .replace(/Weekly Limit/gi, '7d')
    .replace(/\b5H\b/gi, '5h')
    .replace(/\b7D\b/gi, '7d');
}

function pickDot(percent: number, thresholds: ThresholdConfig): string {
  if (percent <= thresholds.critical) return '🔴';
  if (percent <= thresholds.warning) return '🟡';
  return '🟢';
}

function pickBackground(percent: number, thresholds: ThresholdConfig): vscode.ThemeColor | undefined {
  if (percent <= thresholds.critical) return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (percent <= thresholds.warning) return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
}

function renderBar(fraction: number, width = 12): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const full = Math.round(clamped * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatResetDetails(resetTime: Date): { available: boolean; relative: string; absolute: string } {
  const diffMs = resetTime.getTime() - Date.now();
  if (diffMs <= 0) return { available: true, relative: '', absolute: '' };
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const pad = (value: number) => value.toString().padStart(2, '0');
  const absolute = `${resetTime.getMonth() + 1}/${resetTime.getDate()} ${pad(resetTime.getHours())}:${pad(resetTime.getMinutes())}`;
  const relative = days > 0
    ? `${days}d ${hours % 24}h`
    : hours > 0
      ? `${hours}h ${minutes % 60}m`
      : `${minutes}m`;
  return { available: false, relative, absolute };
}

function formatRelative(date: Date, past = false): string {
  const diffMs = date.getTime() - Date.now();
  const ago = past || diffMs <= 0;
  const absolute = Math.abs(diffMs);
  const minutes = Math.floor(absolute / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const label = days > 0
    ? `${days}d ${hours % 24}h`
    : hours > 0
      ? `${hours}h ${minutes % 60}m`
      : minutes > 0
        ? `${minutes}m`
        : `${Math.max(1, Math.floor(absolute / 1000))}s`;
  return ago ? `${label} ago` : `in ${label}`;
}

function formatPlan(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function escapeMd(value: string): string {
  return value.replace(/[|<>*_`[\]\\]/g, (character) => `\\${character}`);
}

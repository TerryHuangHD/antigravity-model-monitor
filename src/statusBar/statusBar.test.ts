import * as vscode from 'vscode';
import { CustomNamesStore } from '../state/customNames';
import { StatusBarController } from './statusBar';

class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  keys(): readonly string[] { return [...this.store.keys()]; }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? this.store.get(key) as T : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
  setKeysForSync(): void {}
}

describe('StatusBarController tooltip', () => {
  it('renders readable quota cards instead of a compressed table', () => {
    const item = {
      text: '',
      tooltip: '' as string | vscode.MarkdownString,
      command: undefined,
      backgroundColor: undefined,
      show: jest.fn(),
      dispose: jest.fn()
    };
    jest.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(item as unknown as vscode.StatusBarItem);

    const names = new CustomNamesStore(new FakeMemento());
    const controller = new StatusBarController(names, {
      warning: 50,
      critical: 10,
      notificationsEnabled: false
    });

    controller.applyUpdate({
      snapshot: {
        groups: [{
          key: 'gemini',
          autoName: 'Gemini Models',
          minRemainingFraction: 0.42,
          members: [{
            modelId: 'gemini-weekly',
            label: 'Weekly Limit',
            remainingFraction: 0.42,
            resetTime: new Date(Date.now() + 6 * 60 * 60 * 1000)
          }]
        }],
        totalModelCount: 1
      },
      availableCredits: null,
      subscriptions: [{
        key: 'codex',
        name: 'Codex',
        description: 'Codex subscription usage',
        account: 'plus',
        source: 'codex app-server',
        limits: [{
          id: 'weekly',
          label: 'Weekly Limit',
          remainingFraction: 0.72,
          resetTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          windowMinutes: 10_080
        }],
        error: null,
        lastUpdatedAt: new Date()
      }],
      error: null,
      lastUpdatedAt: new Date(),
      isLoading: false
    });

    const tooltip = item.tooltip as vscode.MarkdownString;
    expect(tooltip.value).toContain('#### Antigravity');
    expect(tooltip.value).toContain('🟡 **Gemini Models · Weekly Limit** · **42% remaining**');
    expect(tooltip.value).toContain('#### Codex');
    expect(item.text).toContain('Codex 7d: 72%');
    expect(tooltip.value).toContain('$(clock) Resets in **');
    expect(tooltip.value).toContain('[$(dashboard) Open dashboard](command:agModelMonitor.openPanel)');
    expect(tooltip.value).not.toContain('| Limit |');

    controller.dispose();
    names.dispose();
  });

  it('keeps subscription usage visible when Antigravity is unavailable', () => {
    const item = {
      text: '',
      tooltip: '' as string | vscode.MarkdownString,
      command: undefined,
      backgroundColor: undefined,
      show: jest.fn(),
      dispose: jest.fn()
    };
    jest.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(item as unknown as vscode.StatusBarItem);

    const names = new CustomNamesStore(new FakeMemento());
    const controller = new StatusBarController(names, {
      warning: 30,
      critical: 10,
      notificationsEnabled: false
    });

    controller.applyUpdate({
      snapshot: null,
      availableCredits: null,
      subscriptions: [{
        key: 'claude-code',
        name: 'Claude Code',
        description: 'Claude subscription usage',
        account: null,
        source: 'Claude Code OAuth usage',
        limits: [{
          id: 'five-hour',
          label: 'Five Hour Limit',
          remainingFraction: 0.8,
          resetTime: null,
          windowMinutes: 300
        }],
        error: null,
        lastUpdatedAt: new Date()
      }],
      error: { kind: 'config', message: 'Antigravity is signed out' },
      lastUpdatedAt: null,
      isLoading: false
    });

    expect(item.text).toContain('Claude Code 5h: 80%');
    expect((item.tooltip as vscode.MarkdownString).value).toContain('Unavailable: Antigravity is signed out');

    controller.dispose();
    names.dispose();
  });

  it('applies subscription/content names, visibility, and order to the status bar', async () => {
    const item = {
      text: '',
      tooltip: '' as string | vscode.MarkdownString,
      command: undefined,
      backgroundColor: undefined,
      show: jest.fn(),
      dispose: jest.fn()
    };
    jest.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(item as unknown as vscode.StatusBarItem);

    const names = new CustomNamesStore(new FakeMemento());
    await names.setSubscriptionName('codex', 'Work Codex');
    await names.setContentName('codex:weekly', 'Week budget');
    await names.setSubscriptionHidden('claude-code', true);
    await names.setSubscriptionOrder(['codex', 'antigravity', 'claude-code']);

    const controller = new StatusBarController(names, {
      warning: 30,
      critical: 10,
      notificationsEnabled: false
    });
    controller.applyUpdate({
      snapshot: {
        groups: [{
          key: 'gemini',
          autoName: 'Gemini Models',
          minRemainingFraction: 0.7,
          members: [{ modelId: 'weekly', label: 'Weekly Limit', remainingFraction: 0.7, resetTime: null }]
        }],
        totalModelCount: 1
      },
      availableCredits: null,
      subscriptions: [
        {
          key: 'claude-code',
          name: 'Claude Code',
          description: 'Claude usage',
          account: null,
          source: 'Claude source',
          limits: [{ id: 'weekly', label: 'Weekly Limit', remainingFraction: 0.8, resetTime: null, windowMinutes: 10080 }],
          error: null,
          lastUpdatedAt: null
        },
        {
          key: 'codex',
          name: 'Codex',
          description: 'Codex usage',
          account: null,
          source: 'Codex source',
          limits: [{ id: 'weekly', label: 'Weekly Limit', remainingFraction: 0.9, resetTime: null, windowMinutes: 10080 }],
          error: null,
          lastUpdatedAt: null
        }
      ],
      error: null,
      lastUpdatedAt: new Date(),
      isLoading: false
    });

    expect(item.text).toContain('Work Codex Week budget: 90%');
    expect(item.text).not.toContain('Claude Code');
    expect(item.text.indexOf('Work Codex')).toBeLessThan(item.text.indexOf('Antigravity'));
    const tooltip = (item.tooltip as vscode.MarkdownString).value;
    expect(tooltip.indexOf('#### Work Codex')).toBeLessThan(tooltip.indexOf('#### Antigravity'));

    controller.dispose();
    names.dispose();
  });

  it('applies content visibility and drag order to status-bar output', async () => {
    const item = {
      text: '',
      tooltip: '' as string | vscode.MarkdownString,
      command: undefined,
      backgroundColor: undefined,
      show: jest.fn(),
      dispose: jest.fn()
    };
    jest.spyOn(vscode.window, 'createStatusBarItem').mockReturnValue(item as unknown as vscode.StatusBarItem);

    const names = new CustomNamesStore(new FakeMemento());
    await names.setSubscriptionHidden('antigravity', true);
    await names.setSubscriptionHidden('codex', true);
    await names.setContentHidden('claude-code:opus', true);
    await names.setContentOrder('claude-code', [
      'claude-code:weekly',
      'claude-code:five-hour',
      'claude-code:opus'
    ]);

    const controller = new StatusBarController(names, {
      warning: 30,
      critical: 10,
      notificationsEnabled: false
    });
    controller.applyUpdate({
      snapshot: null,
      availableCredits: null,
      subscriptions: [{
        key: 'claude-code',
        name: 'Claude Code',
        description: 'Claude usage',
        account: null,
        source: 'Claude source',
        limits: [
          { id: 'five-hour', label: 'Five Hour Limit', remainingFraction: 0.8, resetTime: null, windowMinutes: 300 },
          { id: 'opus', label: 'Weekly Opus Limit', remainingFraction: 0.6, resetTime: null, windowMinutes: 10080 },
          { id: 'weekly', label: 'Weekly Limit', remainingFraction: 0.7, resetTime: null, windowMinutes: 10080 }
        ],
        error: null,
        lastUpdatedAt: null
      }],
      error: null,
      lastUpdatedAt: new Date(),
      isLoading: false
    });

    expect(item.text.indexOf('Claude Code 7d: 70%')).toBeLessThan(item.text.indexOf('Claude Code 5h: 80%'));
    expect(item.text).not.toContain('Opus');

    controller.dispose();
    names.dispose();
  });
});

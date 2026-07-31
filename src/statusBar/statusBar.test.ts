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
      error: null,
      lastUpdatedAt: new Date(),
      isLoading: false
    });

    const tooltip = item.tooltip as vscode.MarkdownString;
    expect(tooltip.value).toContain('#### Gemini Models');
    expect(tooltip.value).toContain('🟡 **Weekly Limit (7D)** · **42% remaining**');
    expect(tooltip.value).toContain('$(clock) Resets in **');
    expect(tooltip.value).toContain('[$(dashboard) Open dashboard](command:agModelMonitor.openPanel)');
    expect(tooltip.value).not.toContain('| Limit |');

    controller.dispose();
    names.dispose();
  });
});

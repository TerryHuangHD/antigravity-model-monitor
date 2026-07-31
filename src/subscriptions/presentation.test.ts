import * as vscode from 'vscode';
import { CustomNamesStore } from '../state/customNames';
import { buildMonitorSubscriptions } from './presentation';

class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  keys(): readonly string[] { return [...this.store.keys()]; }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? this.store.get(key) as T : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
  setKeysForSync(): void {}
}

describe('buildMonitorSubscriptions', () => {
  it('builds three consistently customizable subscriptions', async () => {
    const names = new CustomNamesStore(new FakeMemento());
    await names.setSubscriptionName('codex', 'Codex Work');
    await names.setSubscriptionHidden('claude-code', true);
    await names.setContentName('codex:weekly', 'Weekly budget');
    await names.setContentHidden('antigravity:gemini:gemini-5h', true);
    await names.setSubscriptionOrder(['codex', 'antigravity', 'claude-code']);

    const subscriptions = buildMonitorSubscriptions(
      {
        totalModelCount: 2,
        groups: [{
          key: 'gemini',
          autoName: 'Gemini Models',
          minRemainingFraction: 0.6,
          members: [
            { modelId: 'gemini-weekly', label: 'Weekly Limit', remainingFraction: 0.6, resetTime: null },
            { modelId: 'gemini-5h', label: 'Five Hour Limit', remainingFraction: 0.8, resetTime: null }
          ]
        }]
      },
      [
        {
          key: 'claude-code',
          name: 'Claude Code',
          description: 'Claude usage',
          account: null,
          source: 'Claude source',
          limits: [{ id: 'weekly', label: 'Weekly Limit', remainingFraction: 0.7, resetTime: null, windowMinutes: 10080 }],
          error: null,
          lastUpdatedAt: null
        },
        {
          key: 'codex',
          name: 'Codex',
          description: 'Codex usage',
          account: 'plus',
          source: 'Codex source',
          limits: [{ id: 'weekly', label: 'Weekly Limit', remainingFraction: 0.9, resetTime: null, windowMinutes: 10080 }],
          error: null,
          lastUpdatedAt: null
        }
      ],
      names,
      {
        account: 'person@example.com',
        description: 'Google AI Pro',
        error: null,
        lastUpdatedAt: null
      }
    );

    expect(subscriptions.map((subscription) => subscription.key)).toEqual(['codex', 'antigravity', 'claude-code']);
    expect(subscriptions[0]).toMatchObject({ name: 'Codex Work', customName: 'Codex Work', hidden: false });
    expect(subscriptions[0].contents[0]).toMatchObject({ name: 'Weekly budget', customName: 'Weekly budget' });
    expect(subscriptions[1].contents.map((content) => content.originalLabel)).toEqual([
      'Gemini Models · Weekly Limit',
      'Gemini Models · Five Hour Limit'
    ]);
    expect(subscriptions[1].contents[1].hidden).toBe(true);
    expect(subscriptions[2].hidden).toBe(true);
    names.dispose();
  });

  it('preserves legacy Antigravity names, visibility, and model order', async () => {
    const names = new CustomNamesStore(new FakeMemento());
    await names.setGroupName('gemini', 'Gemini Pool');
    await names.setModelName('weekly', 'Seven days');
    await names.setModelHidden('five-hour', true);
    await names.setModelOrder('gemini', ['five-hour', 'weekly']);

    const subscriptions = buildMonitorSubscriptions(
      {
        totalModelCount: 2,
        groups: [{
          key: 'gemini',
          autoName: 'Gemini Models',
          minRemainingFraction: 0.5,
          members: [
            { modelId: 'weekly', label: 'Weekly Limit', remainingFraction: 0.5, resetTime: null },
            { modelId: 'five-hour', label: 'Five Hour Limit', remainingFraction: 0.8, resetTime: null }
          ]
        }]
      },
      [],
      names,
      { account: null, description: null, error: null, lastUpdatedAt: null }
    );

    const antigravity = subscriptions.find((subscription) => subscription.key === 'antigravity');
    expect(antigravity?.contents.map((content) => content.originalLabel)).toEqual([
      'Gemini Pool · Five Hour Limit',
      'Gemini Pool · Seven days'
    ]);
    expect(antigravity?.contents[0].hidden).toBe(true);
    names.dispose();
  });

  it('lets a unified content switch override legacy Antigravity visibility', async () => {
    const names = new CustomNamesStore(new FakeMemento());
    await names.setGroupHidden('gemini', true);
    await names.setContentHidden('antigravity:gemini:weekly', false);

    const subscriptions = buildMonitorSubscriptions(
      {
        totalModelCount: 2,
        groups: [{
          key: 'gemini',
          autoName: 'Gemini Models',
          minRemainingFraction: 0.5,
          members: [
            { modelId: 'weekly', label: 'Weekly Limit', remainingFraction: 0.5, resetTime: null },
            { modelId: 'five-hour', label: 'Five Hour Limit', remainingFraction: 0.8, resetTime: null }
          ]
        }]
      },
      [],
      names,
      { account: null, description: null, error: null, lastUpdatedAt: null }
    );

    const antigravity = subscriptions.find((subscription) => subscription.key === 'antigravity');
    expect(antigravity?.contents.find((content) => content.id.endsWith(':weekly'))?.hidden).toBe(false);
    expect(antigravity?.contents.find((content) => content.id.endsWith(':five-hour'))?.hidden).toBe(true);
    names.dispose();
  });
});

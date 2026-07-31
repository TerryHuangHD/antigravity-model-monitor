import * as vscode from 'vscode';
import { CustomNamesStore } from './customNames';

class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  keys(): readonly string[] { return [...this.store.keys()]; }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.store.has(key) ? (this.store.get(key) as T) : defaultValue);
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
  setKeysForSync(): void {}
}

describe('CustomNamesStore', () => {
  it('returns fallback when no custom name set', () => {
    const store = new CustomNamesStore(new FakeMemento());
    expect(store.getGroupName('g1', 'Auto')).toBe('Auto');
    expect(store.getModelName('m1', 'Model A')).toBe('Model A');
  });

  it('persists and reads back group names', async () => {
    const memento = new FakeMemento();
    const a = new CustomNamesStore(memento);
    await a.setGroupName('g1', 'Premium pool');
    const b = new CustomNamesStore(memento);
    expect(b.getGroupName('g1', 'Auto')).toBe('Premium pool');
  });

  it('clearing a name reverts to fallback', async () => {
    const store = new CustomNamesStore(new FakeMemento());
    await store.setModelName('m1', 'My Name');
    await store.setModelName('m1', '');
    expect(store.getModelName('m1', 'Original')).toBe('Original');
  });

  it('resetAll wipes everything', async () => {
    const store = new CustomNamesStore(new FakeMemento());
    await store.setSubscriptionName('codex', 'Work Codex');
    await store.setContentName('codex:weekly', 'Week');
    await store.setSubscriptionHidden('claude-code', true);
    await store.setContentHidden('codex:weekly', true);
    await store.setContentStatusBarIconHidden('codex:weekly', true);
    await store.setSubscriptionOrder(['codex', 'antigravity', 'claude-code']);
    await store.setContentOrder('codex', ['codex:weekly']);
    await store.setGroupName('g1', 'Pool');
    await store.setModelName('m1', 'Mod');
    await store.setGroupHidden('g1', true);
    await store.setModelHidden('m1', true);
    await store.setModelOrder('g1', ['m2', 'm1']);
    await store.resetAll();
    const snap = store.snapshot();
    expect(snap.subscriptionNames).toEqual({});
    expect(snap.contentNames).toEqual({});
    expect(snap.hiddenSubscriptions).toEqual({});
    expect(snap.hiddenContents).toEqual({});
    expect(snap.statusBarIconHiddenContents).toEqual({});
    expect(snap.visibleContents).toEqual({});
    expect(snap.subscriptionOrder).toEqual([]);
    expect(snap.contentOrder).toEqual({});
    expect(snap.groups).toEqual({});
    expect(snap.models).toEqual({});
    expect(snap.hiddenGroups).toEqual({});
    expect(snap.hiddenModels).toEqual({});
    expect(snap.modelOrder).toEqual({});
  });

  it('fires onChange when state mutates', async () => {
    const store = new CustomNamesStore(new FakeMemento());
    let count = 0;
    store.onChange(() => { count += 1; });
    await store.setGroupName('g1', 'A');
    await store.setModelName('m1', 'B');
    await store.setGroupHidden('g1', true);
    await store.setModelHidden('m1', true);
    await store.setModelOrder('g1', ['m1']);
    await store.resetAll();
    expect(count).toBe(6);
  });

  describe('unified subscription customization', () => {
    it('persists subscription and content names and visibility', async () => {
      const memento = new FakeMemento();
      const first = new CustomNamesStore(memento);
      await first.setSubscriptionName('claude-code', 'Claude Personal');
      await first.setContentName('claude-code:weekly', 'Weekly budget');
      await first.setSubscriptionHidden('codex', true);
      await first.setContentHidden('claude-code:five-hour', true);
      await first.setContentStatusBarIconHidden('claude-code:weekly', true);

      const second = new CustomNamesStore(memento);
      expect(second.getSubscriptionName('claude-code', 'Claude Code')).toBe('Claude Personal');
      expect(second.getContentName('claude-code:weekly', 'Weekly Limit')).toBe('Weekly budget');
      expect(second.isSubscriptionHidden('codex')).toBe(true);
      expect(second.isContentHidden('claude-code:five-hour')).toBe(true);
      expect(second.isContentStatusBarIconHidden('claude-code:weekly')).toBe(true);
      expect(second.isContentHidden('claude-code:weekly')).toBe(false);
    });

    it('persists an explicit visible content override', async () => {
      const memento = new FakeMemento();
      const first = new CustomNamesStore(memento);
      await first.setContentHidden('antigravity:gemini:weekly', false);

      const second = new CustomNamesStore(memento);
      expect(second.getContentHiddenOverride('antigravity:gemini:weekly')).toBe(false);
      expect(second.snapshot().visibleContents).toEqual({
        'antigravity:gemini:weekly': true
      });

      await second.setContentHidden('antigravity:gemini:weekly', true);
      expect(second.getContentHiddenOverride('antigravity:gemini:weekly')).toBe(true);
      expect(second.snapshot().visibleContents).toEqual({});
    });

    it('orders subscriptions and contents while appending new items', async () => {
      const store = new CustomNamesStore(new FakeMemento());
      await store.setSubscriptionOrder(['codex', 'antigravity']);
      await store.setContentOrder('claude-code', ['claude-code:weekly', 'claude-code:five-hour']);

      expect(store.orderSubscriptions([
        { key: 'antigravity' },
        { key: 'claude-code' },
        { key: 'codex' }
      ]).map((item) => item.key)).toEqual(['codex', 'antigravity', 'claude-code']);
      expect(store.orderContents('claude-code', [
        { id: 'claude-code:five-hour' },
        { id: 'claude-code:weekly' },
        { id: 'claude-code:new' }
      ]).map((item) => item.id)).toEqual([
        'claude-code:weekly',
        'claude-code:five-hour',
        'claude-code:new'
      ]);
    });
  });

  describe('visibility', () => {
    it('groups and models default to visible', () => {
      const store = new CustomNamesStore(new FakeMemento());
      expect(store.isGroupHidden('g1')).toBe(false);
      expect(store.isModelHidden('m1')).toBe(false);
    });

    it('persists hidden flags', async () => {
      const memento = new FakeMemento();
      const a = new CustomNamesStore(memento);
      await a.setGroupHidden('g1', true);
      await a.setModelHidden('m1', true);
      const b = new CustomNamesStore(memento);
      expect(b.isGroupHidden('g1')).toBe(true);
      expect(b.isModelHidden('m1')).toBe(true);
    });

    it('setting hidden=false clears the flag', async () => {
      const store = new CustomNamesStore(new FakeMemento());
      await store.setGroupHidden('g1', true);
      await store.setGroupHidden('g1', false);
      expect(store.isGroupHidden('g1')).toBe(false);
      expect(store.snapshot().hiddenGroups).toEqual({});
    });
  });

  describe('model ordering', () => {
    const models = [
      { modelId: 'weekly', label: 'Weekly Limit' },
      { modelId: 'five-hour', label: 'Five Hour Limit' },
      { modelId: 'new-limit', label: 'New Limit' }
    ];

    it('persists an order and appends models that are not in the saved order', async () => {
      const memento = new FakeMemento();
      const a = new CustomNamesStore(memento);
      await a.setModelOrder('gemini', ['five-hour', 'weekly']);

      const b = new CustomNamesStore(memento);
      expect(b.orderModels('gemini', models).map((model) => model.modelId)).toEqual([
        'five-hour',
        'weekly',
        'new-limit'
      ]);
    });

    it('normalizes duplicate and blank model IDs before persisting', async () => {
      const store = new CustomNamesStore(new FakeMemento());
      await store.setModelOrder('gemini', [' weekly ', '', 'five-hour', 'weekly']);
      expect(store.snapshot().modelOrder.gemini).toEqual(['weekly', 'five-hour']);
    });
  });
});

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
    await store.setGroupName('g1', 'Pool');
    await store.setModelName('m1', 'Mod');
    await store.setGroupHidden('g1', true);
    await store.setModelHidden('m1', true);
    await store.resetAll();
    const snap = store.snapshot();
    expect(snap.groups).toEqual({});
    expect(snap.models).toEqual({});
    expect(snap.hiddenGroups).toEqual({});
    expect(snap.hiddenModels).toEqual({});
  });

  it('fires onChange when state mutates', async () => {
    const store = new CustomNamesStore(new FakeMemento());
    let count = 0;
    store.onChange(() => { count += 1; });
    await store.setGroupName('g1', 'A');
    await store.setModelName('m1', 'B');
    await store.setGroupHidden('g1', true);
    await store.setModelHidden('m1', true);
    await store.resetAll();
    expect(count).toBe(5);
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
});

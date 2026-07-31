import * as vscode from 'vscode';

const STATE_KEY = 'agModelMonitor.customNames';

export interface CustomNamesData {
  subscriptionNames: Record<string, string>;
  hiddenSubscriptions: Record<string, true>;
  subscriptionOrder: string[];
  contentNames: Record<string, string>;
  hiddenContents: Record<string, true>;
  statusBarIconHiddenContents: Record<string, true>;
  // Explicit visible overrides let the unified UI reveal one Antigravity row
  // even when a legacy group/model visibility flag still hides it.
  visibleContents: Record<string, true>;
  contentOrder: Record<string, string[]>;
  // Legacy Antigravity customization fields. They remain readable so existing
  // installations keep their names, visibility, and per-family order.
  groups: Record<string, string>;
  models: Record<string, string>;
  hiddenGroups: Record<string, true>;
  hiddenModels: Record<string, true>;
  modelOrder: Record<string, string[]>;
}

const empty = (): CustomNamesData => ({
  subscriptionNames: {},
  hiddenSubscriptions: {},
  subscriptionOrder: [],
  contentNames: {},
  hiddenContents: {},
  statusBarIconHiddenContents: {},
  visibleContents: {},
  contentOrder: {},
  groups: {},
  models: {},
  hiddenGroups: {},
  hiddenModels: {},
  modelOrder: {}
});

export class CustomNamesStore {
  private data: CustomNamesData;
  private readonly onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onChange = this.onChangeEmitter.event;

  constructor(private readonly memento: vscode.Memento) {
    this.data = sanitize(memento.get<CustomNamesData>(STATE_KEY));
  }

  snapshot(): CustomNamesData {
    return {
      subscriptionNames: { ...this.data.subscriptionNames },
      hiddenSubscriptions: { ...this.data.hiddenSubscriptions },
      subscriptionOrder: [...this.data.subscriptionOrder],
      contentNames: { ...this.data.contentNames },
      hiddenContents: { ...this.data.hiddenContents },
      statusBarIconHiddenContents: { ...this.data.statusBarIconHiddenContents },
      visibleContents: { ...this.data.visibleContents },
      contentOrder: cloneOrderMap(this.data.contentOrder),
      groups: { ...this.data.groups },
      models: { ...this.data.models },
      hiddenGroups: { ...this.data.hiddenGroups },
      hiddenModels: { ...this.data.hiddenModels },
      modelOrder: cloneOrderMap(this.data.modelOrder)
    };
  }

  getSubscriptionName(subscriptionKey: string, fallback: string): string {
    return this.data.subscriptionNames[subscriptionKey]?.trim() || fallback;
  }

  getContentName(contentId: string, fallback: string): string {
    return this.data.contentNames[contentId]?.trim() || fallback;
  }

  isSubscriptionHidden(subscriptionKey: string): boolean {
    return this.data.hiddenSubscriptions[subscriptionKey] === true;
  }

  isContentHidden(contentId: string): boolean {
    return this.data.hiddenContents[contentId] === true;
  }

  isContentStatusBarIconHidden(contentId: string): boolean {
    return this.data.statusBarIconHiddenContents[contentId] === true;
  }

  getContentHiddenOverride(contentId: string): boolean | null {
    if (this.data.hiddenContents[contentId] === true) return true;
    if (this.data.visibleContents[contentId] === true) return false;
    return null;
  }

  orderSubscriptions<T extends { key: string }>(subscriptions: readonly T[]): T[] {
    return orderBySavedIds(subscriptions, this.data.subscriptionOrder, (subscription) => subscription.key);
  }

  orderContents<T extends { id: string }>(subscriptionKey: string, contents: readonly T[]): T[] {
    return orderBySavedIds(contents, this.data.contentOrder[subscriptionKey], (content) => content.id);
  }

  getGroupName(groupKey: string, fallback: string): string {
    return this.data.groups[groupKey]?.trim() || fallback;
  }

  getModelName(modelId: string, fallback: string): string {
    return this.data.models[modelId]?.trim() || fallback;
  }

  isGroupHidden(groupKey: string): boolean {
    return this.data.hiddenGroups[groupKey] === true;
  }

  isModelHidden(modelId: string): boolean {
    return this.data.hiddenModels[modelId] === true;
  }

  orderModels<T extends { modelId: string }>(groupKey: string, models: readonly T[]): T[] {
    return orderBySavedIds(models, this.data.modelOrder[groupKey], (model) => model.modelId);
  }

  async setSubscriptionName(subscriptionKey: string, name: string | null): Promise<void> {
    setOptionalName(this.data.subscriptionNames, subscriptionKey, name);
    await this.persist();
  }

  async setContentName(contentId: string, name: string | null): Promise<void> {
    setOptionalName(this.data.contentNames, contentId, name);
    await this.persist();
  }

  async setSubscriptionHidden(subscriptionKey: string, hidden: boolean): Promise<void> {
    setHidden(this.data.hiddenSubscriptions, subscriptionKey, hidden);
    await this.persist();
  }

  async setContentHidden(contentId: string, hidden: boolean): Promise<void> {
    if (hidden) {
      this.data.hiddenContents[contentId] = true;
      delete this.data.visibleContents[contentId];
    } else {
      delete this.data.hiddenContents[contentId];
      this.data.visibleContents[contentId] = true;
    }
    await this.persist();
  }

  async setContentStatusBarIconHidden(contentId: string, hidden: boolean): Promise<void> {
    setHidden(this.data.statusBarIconHiddenContents, contentId, hidden);
    await this.persist();
  }

  async setSubscriptionOrder(subscriptionKeys: readonly string[]): Promise<void> {
    this.data.subscriptionOrder = normalizeIds(subscriptionKeys);
    await this.persist();
  }

  async setContentOrder(subscriptionKey: string, contentIds: readonly string[]): Promise<void> {
    const normalized = normalizeIds(contentIds);
    if (normalized.length) this.data.contentOrder[subscriptionKey] = normalized;
    else delete this.data.contentOrder[subscriptionKey];
    await this.persist();
  }

  async setGroupName(groupKey: string, name: string | null): Promise<void> {
    setOptionalName(this.data.groups, groupKey, name);
    await this.persist();
  }

  async setModelName(modelId: string, name: string | null): Promise<void> {
    setOptionalName(this.data.models, modelId, name);
    await this.persist();
  }

  async setGroupHidden(groupKey: string, hidden: boolean): Promise<void> {
    setHidden(this.data.hiddenGroups, groupKey, hidden);
    await this.persist();
  }

  async setModelHidden(modelId: string, hidden: boolean): Promise<void> {
    setHidden(this.data.hiddenModels, modelId, hidden);
    await this.persist();
  }

  async setModelOrder(groupKey: string, modelIds: readonly string[]): Promise<void> {
    const normalized = normalizeIds(modelIds);
    if (normalized.length) this.data.modelOrder[groupKey] = normalized;
    else delete this.data.modelOrder[groupKey];
    await this.persist();
  }

  async resetAll(): Promise<void> {
    this.data = empty();
    await this.persist();
  }

  dispose() {
    this.onChangeEmitter.dispose();
  }

  private async persist() {
    await this.memento.update(STATE_KEY, this.data);
    this.onChangeEmitter.fire();
  }
}

function sanitize(raw: CustomNamesData | undefined): CustomNamesData {
  if (!raw || typeof raw !== 'object') return empty();
  const isStringMap = (o: unknown): o is Record<string, string> =>
    !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>).every((v) => typeof v === 'string');
  const isBoolMap = (o: unknown): o is Record<string, true> =>
    !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>).every((v) => v === true);
  const isStringArrayMap = (o: unknown): o is Record<string, string[]> =>
    !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>)
      .every((value) => Array.isArray(value) && value.every((item) => typeof item === 'string'));

  return {
    subscriptionNames: isStringMap(raw.subscriptionNames) ? { ...raw.subscriptionNames } : {},
    hiddenSubscriptions: isBoolMap(raw.hiddenSubscriptions) ? { ...raw.hiddenSubscriptions } : {},
    subscriptionOrder: Array.isArray(raw.subscriptionOrder)
      ? normalizeIds(raw.subscriptionOrder.filter((item): item is string => typeof item === 'string'))
      : [],
    contentNames: isStringMap(raw.contentNames) ? { ...raw.contentNames } : {},
    hiddenContents: isBoolMap(raw.hiddenContents) ? { ...raw.hiddenContents } : {},
    statusBarIconHiddenContents: isBoolMap(raw.statusBarIconHiddenContents) ? { ...raw.statusBarIconHiddenContents } : {},
    visibleContents: isBoolMap(raw.visibleContents) ? { ...raw.visibleContents } : {},
    contentOrder: isStringArrayMap(raw.contentOrder)
      ? Object.fromEntries(Object.entries(raw.contentOrder).map(([key, ids]) => [key, normalizeIds(ids)]))
      : {},
    groups: isStringMap(raw.groups) ? { ...raw.groups } : {},
    models: isStringMap(raw.models) ? { ...raw.models } : {},
    hiddenGroups: isBoolMap(raw.hiddenGroups) ? { ...raw.hiddenGroups } : {},
    hiddenModels: isBoolMap(raw.hiddenModels) ? { ...raw.hiddenModels } : {},
    modelOrder: isStringArrayMap(raw.modelOrder)
      ? Object.fromEntries(Object.entries(raw.modelOrder).map(([key, ids]) => [key, normalizeIds(ids)]))
      : {}
  };
}

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function cloneOrderMap(order: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(order).map(([key, ids]) => [key, [...ids]]));
}

function setOptionalName(target: Record<string, string>, key: string, name: string | null): void {
  if (!name?.trim()) delete target[key];
  else target[key] = name.trim();
}

function setHidden(target: Record<string, true>, key: string, hidden: boolean): void {
  if (hidden) target[key] = true;
  else delete target[key];
}

function orderBySavedIds<T>(items: readonly T[], savedOrder: readonly string[] | undefined, getId: (item: T) => string): T[] {
  if (!savedOrder?.length) return [...items];
  const rank = new Map(savedOrder.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(getId(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

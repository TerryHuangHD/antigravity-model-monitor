import * as vscode from 'vscode';

const STATE_KEY = 'agModelMonitor.customNames';

export interface CustomNamesData {
  groups: Record<string, string>;
  models: Record<string, string>;
  hiddenGroups: Record<string, true>;
  hiddenModels: Record<string, true>;
}

const empty = (): CustomNamesData => ({
  groups: {},
  models: {},
  hiddenGroups: {},
  hiddenModels: {}
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
      groups: { ...this.data.groups },
      models: { ...this.data.models },
      hiddenGroups: { ...this.data.hiddenGroups },
      hiddenModels: { ...this.data.hiddenModels }
    };
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

  async setGroupName(groupKey: string, name: string | null): Promise<void> {
    if (!name || !name.trim()) delete this.data.groups[groupKey];
    else this.data.groups[groupKey] = name.trim();
    await this.persist();
  }

  async setModelName(modelId: string, name: string | null): Promise<void> {
    if (!name || !name.trim()) delete this.data.models[modelId];
    else this.data.models[modelId] = name.trim();
    await this.persist();
  }

  async setGroupHidden(groupKey: string, hidden: boolean): Promise<void> {
    if (hidden) this.data.hiddenGroups[groupKey] = true;
    else delete this.data.hiddenGroups[groupKey];
    await this.persist();
  }

  async setModelHidden(modelId: string, hidden: boolean): Promise<void> {
    if (hidden) this.data.hiddenModels[modelId] = true;
    else delete this.data.hiddenModels[modelId];
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

  return {
    groups: isStringMap(raw.groups) ? { ...raw.groups } : {},
    models: isStringMap(raw.models) ? { ...raw.models } : {},
    hiddenGroups: isBoolMap(raw.hiddenGroups) ? { ...raw.hiddenGroups } : {},
    hiddenModels: isBoolMap(raw.hiddenModels) ? { ...raw.hiddenModels } : {}
  };
}

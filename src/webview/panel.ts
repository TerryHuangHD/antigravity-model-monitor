import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { QuotaUpdate, RefreshManager } from '../quota/refreshManager';
import { CustomNamesStore } from '../state/customNames';
import { FamilyGroup } from '../quota/grouping';
import { log } from '../log';

import { readStateValueByKey } from '../auth/tokenReader';
import { parseUserStatusProto, PlanDetailsView } from '../auth/userStatusParser';

const VIEW_TYPE = 'antigravityModelMonitor';

interface InboundMessage {
  type:
    | 'renameGroup'
    | 'renameModel'
    | 'setGroupHidden'
    | 'setModelHidden'
    | 'resetAll'
    | 'refresh'
    | 'setShowCredits'
    | 'setRefreshInterval';
  groupKey?: string;
  modelId?: string;
  name?: string | null;
  hidden?: boolean;
  value?: boolean;
}

interface OutboundInit {
  type: 'state';
  payload: ViewState;
}

interface MemberView {
  modelId: string;
  originalLabel: string;
  customName: string | null;
  hidden: boolean;
  remainingPercent: number;
  resetTime: string | null;
}

interface GroupView {
  key: string;
  autoName: string;
  customName: string | null;
  hidden: boolean;
  minRemainingPercent: number;
  members: MemberView[];
}

interface ViewState {
  credits: number | null;
  groups: GroupView[];
  lastUpdatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  plan: PlanDetailsView | null;
  showCredits: boolean;
  refreshInterval: number;
}

export class ManagementPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly refresh: RefreshManager,
    private readonly names: CustomNamesStore
  ) {}

  show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const mediaRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview', 'media'));
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Antigravity Model Monitor',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [mediaRoot],
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.renderHtml(this.panel.webview, mediaRoot);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m: InboundMessage) => this.onMessage(m), null, this.disposables);

    this.disposables.push(this.refresh.onUpdate((u) => void this.postState(u)));
    this.disposables.push(this.names.onChange(() => void this.postState(this.refresh.state)));

    void this.postState(this.refresh.state);
  }

  dispose() {
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
    this.panel = undefined;
  }

  private async onMessage(msg: InboundMessage) {
    log.debug(`[panel] received ${msg.type}`);
    switch (msg.type) {
      case 'renameGroup':
        if (msg.groupKey != null) await this.names.setGroupName(msg.groupKey, msg.name ?? null);
        break;
      case 'renameModel':
        if (msg.modelId != null) await this.names.setModelName(msg.modelId, msg.name ?? null);
        break;
      case 'setGroupHidden':
        if (msg.groupKey != null) await this.names.setGroupHidden(msg.groupKey, !!msg.hidden);
        break;
      case 'setModelHidden':
        if (msg.modelId != null) await this.names.setModelHidden(msg.modelId, !!msg.hidden);
        break;
      case 'resetAll':
        await this.names.resetAll();
        break;
      case 'refresh':
        void this.refresh.refresh();
        break;
      case 'setShowCredits':
        if (msg.value !== undefined) {
          await vscode.workspace.getConfiguration('agModelMonitor').update('showCreditsInStatusBar', msg.value, vscode.ConfigurationTarget.Global);
        }
        break;
      case 'setRefreshInterval':
        if (msg.value !== undefined) {
          await vscode.workspace.getConfiguration('agModelMonitor').update('refreshIntervalSeconds', msg.value, vscode.ConfigurationTarget.Global);
        }
        break;
    }
  }

  private async postState(update: QuotaUpdate) {
    if (!this.panel) return;
    let plan: PlanDetailsView | null = null;
    try {
      const raw = await readStateValueByKey('antigravityAuthStatus');
      if (raw) {
        const json = JSON.parse(raw);
        plan = parseUserStatusProto(json.userStatusProtoBinaryBase64 || '');
        if (!plan.email && json.email) plan.email = json.email;
        if (!plan.name && json.name) plan.name = json.name;
      }
    } catch (err) {
      log.error(`[panel] failed to read plan details: ${err}`);
    }

    const showCredits = vscode.workspace.getConfiguration('agModelMonitor').get<boolean>('showCreditsInStatusBar', true);
    const refreshInterval = vscode.workspace.getConfiguration('agModelMonitor').get<number>('refreshIntervalSeconds', 120);

    const payload: ViewState = {
      credits: update.availableCredits ?? plan?.credits ?? null,
      groups: (update.snapshot?.groups ?? []).map((g) => mapGroup(g, this.names)),
      lastUpdatedAt: update.lastUpdatedAt?.toISOString() ?? null,
      isLoading: update.isLoading,
      error: update.error?.message ?? null,
      plan,
      showCredits,
      refreshInterval
    };
    const message: OutboundInit = { type: 'state', payload };
    void this.panel.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const htmlPath = path.join(mediaRoot.fsPath, 'index.html');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'index.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'index.js'));
    const nonce = makeNonce();

    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{cssUri}}/g, cssUri.toString())
      .replace(/{{jsUri}}/g, jsUri.toString());
    return html;
  }
}

function mapGroup(g: FamilyGroup, names: CustomNamesStore): GroupView {
  const snap = names.snapshot();
  return {
    key: g.key,
    autoName: g.autoName,
    customName: snap.groups[g.key] ?? null,
    hidden: snap.hiddenGroups[g.key] === true,
    minRemainingPercent: Math.round(g.minRemainingFraction * 100),
    members: g.members.map((m) => ({
      modelId: m.modelId,
      originalLabel: m.label,
      customName: snap.models[m.modelId] ?? null,
      hidden: snap.hiddenModels[m.modelId] === true,
      remainingPercent: Math.round(m.remainingFraction * 100),
      resetTime: m.resetTime ? m.resetTime.toISOString() : null
    }))
  };
}

function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

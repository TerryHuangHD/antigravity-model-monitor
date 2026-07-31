import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { QuotaUpdate, RefreshManager } from '../quota/refreshManager';
import { CustomNamesStore } from '../state/customNames';
import { log } from '../log';
import { buildMonitorSubscriptions, MonitorSubscription } from '../subscriptions/presentation';

import { readStateValueByKey } from '../auth/tokenReader';
import { parseUserStatusProto } from '../auth/userStatusParser';

const VIEW_TYPE = 'antigravityModelMonitor';

interface InboundMessage {
  type:
    | 'renameSubscription'
    | 'renameContent'
    | 'setSubscriptionHidden'
    | 'setContentHidden'
    | 'setSubscriptionOrder'
    | 'setContentOrder'
    | 'resetAll'
    | 'refresh'
    | 'setRefreshInterval';
  subscriptionKey?: string;
  subscriptionKeys?: string[];
  contentId?: string;
  contentIds?: string[];
  name?: string | null;
  hidden?: boolean;
  value?: number;
}

interface OutboundInit {
  type: 'state';
  payload: ViewState;
}

interface ContentView {
  id: string;
  originalLabel: string;
  customName: string | null;
  hidden: boolean;
  remainingPercent: number;
  resetTime: string | null;
}

interface SubscriptionView {
  key: string;
  originalName: string;
  customName: string | null;
  hidden: boolean;
  description: string;
  account: string | null;
  source: string;
  error: string | null;
  lastUpdatedAt: string | null;
  contents: ContentView[];
}

interface ViewState {
  lastUpdatedAt: string | null;
  isLoading: boolean;
  subscriptions: SubscriptionView[];
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
      'AI Subscription Usage Monitor',
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
      case 'renameSubscription':
        if (msg.subscriptionKey != null) await this.names.setSubscriptionName(msg.subscriptionKey, msg.name ?? null);
        break;
      case 'renameContent':
        if (msg.contentId != null) await this.names.setContentName(msg.contentId, msg.name ?? null);
        break;
      case 'setSubscriptionHidden':
        if (msg.subscriptionKey != null) await this.names.setSubscriptionHidden(msg.subscriptionKey, !!msg.hidden);
        break;
      case 'setContentHidden':
        if (msg.contentId != null) await this.names.setContentHidden(msg.contentId, !!msg.hidden);
        break;
      case 'setSubscriptionOrder':
        if (Array.isArray(msg.subscriptionKeys)) {
          await this.names.setSubscriptionOrder(msg.subscriptionKeys);
        }
        break;
      case 'setContentOrder':
        if (msg.subscriptionKey != null && Array.isArray(msg.contentIds)) {
          await this.names.setContentOrder(msg.subscriptionKey, msg.contentIds);
        }
        break;
      case 'resetAll':
        await this.names.resetAll();
        break;
      case 'refresh':
        void this.refresh.refresh();
        break;
      case 'setRefreshInterval':
        if (msg.value !== undefined && Number.isFinite(msg.value) && msg.value >= 10 && msg.value <= 3600) {
          await vscode.workspace.getConfiguration('agModelMonitor').update('refreshIntervalSeconds', msg.value, vscode.ConfigurationTarget.Global);
        }
        break;
    }
  }

  private async postState(update: QuotaUpdate) {
    if (!this.panel) return;
    let antigravityAccount: string | null = null;
    let antigravityDescription: string | null = null;
    try {
      const raw = await readStateValueByKey('antigravityAuthStatus');
      if (raw) {
        const json = JSON.parse(raw);
        const details = parseUserStatusProto(json.userStatusProtoBinaryBase64 || '');
        antigravityAccount = details.email || json.email || details.name || json.name || null;
        antigravityDescription = details.description || null;
      }
    } catch (err) {
      log.error(`[panel] failed to read Antigravity account details: ${err}`);
    }

    const refreshInterval = vscode.workspace.getConfiguration('agModelMonitor').get<number>('refreshIntervalSeconds', 120);

    const monitorSubscriptions = buildMonitorSubscriptions(
      update.snapshot,
      update.subscriptions,
      this.names,
      {
        account: antigravityAccount,
        description: antigravityDescription,
        error: update.error?.message ?? null,
        lastUpdatedAt: update.lastUpdatedAt
      }
    );

    const payload: ViewState = {
      lastUpdatedAt: update.lastUpdatedAt?.toISOString() ?? null,
      isLoading: update.isLoading,
      subscriptions: monitorSubscriptions.map(mapSubscription),
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

function mapSubscription(subscription: MonitorSubscription): SubscriptionView {
  return {
    key: subscription.key,
    originalName: subscription.originalName,
    customName: subscription.customName,
    hidden: subscription.hidden,
    description: subscription.description,
    account: subscription.account,
    source: subscription.source,
    error: subscription.error,
    lastUpdatedAt: subscription.lastUpdatedAt?.toISOString() ?? null,
    contents: subscription.contents.map((content) => ({
      id: content.id,
      originalLabel: content.originalLabel,
      customName: content.customName,
      hidden: content.hidden,
      remainingPercent: Math.round(content.remainingFraction * 100),
      resetTime: content.resetTime?.toISOString() ?? null
    }))
  };
}

function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

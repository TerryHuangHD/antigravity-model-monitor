import * as vscode from 'vscode';
import { log } from './log';
import {
  dumpRelevantStateKeys,
  readRefreshTokenFromAntigravity,
  readStateValueByKey
} from './auth/tokenReader';
import { describeProtobuf, extractPrintableStrings } from './auth/inspect';
import { OAuthRefresher } from './auth/oauthRefresher';
import { RefreshManager } from './quota/refreshManager';
import { fetchLocalLanguageServerModels } from './api/localLanguageServerClient';
import { groupByFamily } from './quota/grouping';
import { CustomNamesStore } from './state/customNames';
import { StatusBarController, ThresholdConfig } from './statusBar/statusBar';
import { ManagementPanel } from './webview/panel';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface RuntimeConfig {
  refreshIntervalSeconds: number;
  warningThreshold: number;
  criticalThreshold: number;
  notificationsEnabled: boolean;
  logLevel: Level;
  showCreditsInStatusBar: boolean;
}

function readConfig(): RuntimeConfig {
  const cfg = vscode.workspace.getConfiguration('agModelMonitor');
  return {
    refreshIntervalSeconds: cfg.get<number>('refreshIntervalSeconds', 120),
    warningThreshold: cfg.get<number>('warningThreshold', 30),
    criticalThreshold: cfg.get<number>('criticalThreshold', 10),
    notificationsEnabled: cfg.get<boolean>('notificationsEnabled', true),
    logLevel: cfg.get<Level>('logLevel', 'info'),
    showCreditsInStatusBar: cfg.get<boolean>('showCreditsInStatusBar', true)
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('Antigravity Model Monitor');
  context.subscriptions.push(channel);
  log.init(channel);

  const initialCfg = readConfig();
  log.setLevel(initialCfg.logLevel);
  log.info('Antigravity Model Monitor activating...');

  const names = new CustomNamesStore(context.globalState);
  context.subscriptions.push({ dispose: () => names.dispose() });

  // Primary credential path: refresh_token from Antigravity's state.vscdb, exchanged
  // at oauth2.googleapis.com for a short-lived access_token. We cache that for ~55min.
  // We do not use `antigravityAuthStatus.apiKey` directly — empirically it lags behind
  // and is rejected by cloudcode-pa as expired.
  const oauth = new OAuthRefresher(async () => {
    const result = await readRefreshTokenFromAntigravity();
    return result.refreshToken;
  });

  const manager = new RefreshManager(oauth, {
    intervalMs: Math.max(10, initialCfg.refreshIntervalSeconds) * 1000
  });
  context.subscriptions.push({ dispose: () => manager.dispose() });

  const thresholds: ThresholdConfig = {
    warning: initialCfg.warningThreshold,
    critical: initialCfg.criticalThreshold,
    notificationsEnabled: initialCfg.notificationsEnabled,
    showCredits: initialCfg.showCreditsInStatusBar
  };
  const statusBar = new StatusBarController(names, thresholds);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  context.subscriptions.push(manager.onUpdate((u) => statusBar.applyUpdate(u)));
  context.subscriptions.push(names.onChange(() => statusBar.render()));

  const panel = new ManagementPanel(context, manager, names);
  context.subscriptions.push({ dispose: () => panel.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('agModelMonitor.openPanel', () => panel.show()),
    vscode.commands.registerCommand('agModelMonitor.refresh', () => manager.refresh()),
    vscode.commands.registerCommand('agModelMonitor.showLogs', () => log.show()),
    vscode.commands.registerCommand('agModelMonitor.diagnoseLocalQuota', async () => {
      log.show();
      try {
        const entries = await fetchLocalLanguageServerModels();
        const groups = groupByFamily(entries);
        const summary = summarizeGroupsForLog(groups);
        log.info(`[diagnose-local-quota] loaded ${entries.length} local quota models`);
        log.info(`[diagnose-local-quota] ${summary}`);
        void vscode.window.showInformationMessage(`Local quota source OK: ${summary}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[diagnose-local-quota] failed: ${message}`);
        void vscode.window.showWarningMessage(`Local quota source failed: ${message}`);
      }
    }),
    vscode.commands.registerCommand('agModelMonitor.resetCustomNames', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Clear all custom names for Antigravity Model Monitor?',
        { modal: true },
        'Reset'
      );
      if (choice === 'Reset') await names.resetAll();
    }),
    vscode.commands.registerCommand('agModelMonitor.dumpStateKeys', async () => {
      log.show();
      try {
        const dump = await dumpRelevantStateKeys();
        log.info(`[dump] state.vscdb path: ${dump.dbPath}`);
        log.info(`[dump] exists: ${dump.exists}`);
        if (!dump.exists) return;
        if (dump.keys.length === 0) {
          log.info('[dump] no matching keys found');
          return;
        }
        log.info(`[dump] matching keys (${dump.keys.length}):`);
        for (const k of dump.keys) {
          log.info(`  ${k.key}  (value: ${k.valueBytes} bytes)`);
        }
      } catch (err) {
        log.error(`[dump] failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand('agModelMonitor.dumpKeyValue', async () => {
      log.show();
      const key = await vscode.window.showInputBox({
        prompt: 'state.vscdb key to inspect',
        value: 'antigravityUnifiedStateSync.oauthToken'
      });
      if (!key) return;
      try {
        const value = await readStateValueByKey(key);
        if (!value) {
          log.info(`[inspect] ${key}: <missing or empty>`);
          return;
        }
        log.info(`[inspect] ${key}: ${value.length} chars on disk`);

        // Print first 200 raw bytes (as the SQLite column stores them, usually text).
        const head = value.slice(0, 200).replace(/[^\x20-\x7e]/g, '·');
        log.info(`[inspect] head (200): ${head}`);

        // Try JSON.
        try {
          const j = JSON.parse(value);
          log.info(`[inspect] parsed as JSON. Top-level keys: ${Object.keys(j).join(', ')}`);
          log.info(`[inspect] JSON (truncated 4kb): ${JSON.stringify(j).slice(0, 4096)}`);
          return;
        } catch { /* not JSON */ }

        // Try base64 → protobuf-ish inspection.
        let buf: Buffer | null = null;
        try {
          buf = Buffer.from(value.trim(), 'base64');
        } catch { /* not base64 */ }
        if (buf && buf.length > 0) {
          log.info(`[inspect] base64-decoded: ${buf.length} bytes`);
          const strings = extractPrintableStrings(buf, 6);
          if (strings.length > 0) {
            log.info(`[inspect] printable strings (>=6 chars), first 40:`);
            for (const s of strings.slice(0, 40)) {
              const trimmed = s.length > 200 ? s.slice(0, 200) + '…' : s;
              log.info(`  • ${trimmed}`);
            }
          }
          try {
            const tree = describeProtobuf(buf, 5);
            log.info(`[inspect] protobuf tree (depth 5, first 60 fields):`);
            for (const f of tree.slice(0, 60)) {
              const detail = f.asString != null
                ? ` "${f.asString.length > 120 ? f.asString.slice(0, 120) + '…' : f.asString}"`
                : f.asNumber != null
                  ? ` = ${f.asNumber}`
                  : f.byteLength != null
                    ? ` (${f.byteLength} bytes)`
                    : '';
              log.info(`  ${f.path} (wire ${f.wireType})${detail}`);
            }
          } catch (err) {
            log.warn(`[inspect] protobuf parse failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        log.error(`[inspect] failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('agModelMonitor')) return;
      const next = readConfig();
      log.setLevel(next.logLevel);
      manager.setIntervalMs(Math.max(10, next.refreshIntervalSeconds) * 1000);
      statusBar.setThresholds({
        warning: next.warningThreshold,
        critical: next.criticalThreshold,
        notificationsEnabled: next.notificationsEnabled,
        showCredits: next.showCreditsInStatusBar
      });
    })
  );

  manager.start();
}

export function deactivate(): void {
  // Disposables registered in context.subscriptions handle cleanup.
}

function summarizeGroupsForLog(groups: ReturnType<typeof groupByFamily>): string {
  if (groups.length === 0) return 'no groups';
  return groups.map((group) => {
    const members = group.members
      .map((member) => `${member.label}=${Math.round(member.remainingFraction * 100)}%`)
      .join(', ');
    return `${group.autoName}: ${members}`;
  }).join(' | ');
}

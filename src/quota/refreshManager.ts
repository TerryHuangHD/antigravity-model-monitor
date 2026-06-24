import * as vscode from 'vscode';
import {
  CloudCodeApiError,
  clearCachedAccount,
  fetchAvailableModels,
  FetchAvailableModelsResponse,
  getAccountInfo
} from '../api/cloudCodeClient';
import { OAuthRefreshError } from '../auth/oauthRefresher';
import { log } from '../log';
import { groupByFamily, ParsedSnapshot, parseSnapshot } from './grouping';
import { readStateValueByKey } from '../auth/tokenReader';
import { parseUserStatusProto } from '../auth/userStatusParser';
import { fetchLocalLanguageServerModels } from '../api/localLanguageServerClient';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
  invalidate?(): void;
}

export interface QuotaUpdate {
  snapshot: ParsedSnapshot | null;
  availableCredits: number | null;
  error: QuotaError | null;
  lastUpdatedAt: Date | null;
  isLoading: boolean;
}

export interface QuotaError {
  message: string;
  kind: 'auth' | 'network' | 'config' | 'unknown';
}

export interface RefreshManagerOptions {
  intervalMs: number;
}

export class RefreshManager {
  private timer: NodeJS.Timeout | null = null;
  private current: QuotaUpdate = {
    snapshot: null,
    availableCredits: null,
    error: null,
    lastUpdatedAt: null,
    isLoading: false
  };
  private inflight: Promise<void> | null = null;

  private readonly emitter = new vscode.EventEmitter<QuotaUpdate>();
  readonly onUpdate = this.emitter.event;

  constructor(
    private readonly tokenProvider: AccessTokenProvider,
    private options: RefreshManagerOptions
  ) {}

  get state(): QuotaUpdate {
    return this.current;
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs);
  }

  setIntervalMs(ms: number): void {
    if (ms === this.options.intervalMs) return;
    this.options.intervalMs = ms;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.refresh(), ms);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emitter.dispose();
  }

  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;

    this.update({ ...this.current, isLoading: true });

    this.inflight = (async () => {
      try {
        let snapshot: ParsedSnapshot | null = null;
        try {
          snapshot = await readLocalQuotaSnapshot();
          this.update({
            snapshot,
            availableCredits: this.current.availableCredits,
            error: null,
            lastUpdatedAt: new Date(),
            isLoading: false
          });
        } catch (err) {
          log.warn(`[refresh] local language-server quota unavailable; remote API fallback will be used: ${err instanceof Error ? err.message : String(err)}`);
        }

        let credits = this.current.availableCredits;
        let remoteResponse: FetchAvailableModelsResponse | null = null;
        try {
          const remote = await readRemoteQuotaAndCredits(this.tokenProvider);
          credits = remote.credits;
          remoteResponse = remote.response;
        } catch (err) {
          if (!snapshot) throw err;
          log.warn(`[refresh] remote API unavailable; keeping local quota with previous/fallback credits: ${err instanceof Error ? err.message : String(err)}`);
        }

        const userStatus = await readUserStatus();
        if (credits === null && userStatus?.plan.credits != null) credits = userStatus.plan.credits;

        if (!snapshot) {
          if (!remoteResponse) throw new Error('No quota data available from local language server or remote API');
          snapshot = readRemoteQuotaSnapshot(remoteResponse);
          if (isAllFullSnapshot(snapshot)) {
            throw new Error('Remote API quota fallback returned only 100% values; local language-server quota is required for accurate model quota');
          }
        } else if (remoteResponse) {
          log.debug(`[refresh] remote quota ignored because local language-server quota succeeded: ${summarizeResponse(remoteResponse)}`);
        }

        this.update({
          snapshot,
          availableCredits: credits,
          error: null,
          lastUpdatedAt: new Date(),
          isLoading: false
        });
      } catch (err) {
        const quotaErr = classify(err);
        log.error(`[refresh] failed: ${quotaErr.message}`);
        this.update({
          snapshot: this.current.snapshot,
          availableCredits: this.current.availableCredits,
          error: quotaErr,
          lastUpdatedAt: this.current.lastUpdatedAt,
          isLoading: false
        });
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  private update(next: QuotaUpdate) {
    this.current = next;
    this.emitter.fire(next);
  }
}

async function readRemoteQuotaAndCredits(tokenProvider: AccessTokenProvider): Promise<{ response: FetchAvailableModelsResponse; credits: number | null }> {
  try {
    const token = await tokenProvider.getAccessToken();
    const account = await getAccountInfo(token, true);
    return {
      credits: account.availableCredits ?? null,
      response: await fetchAvailableModels(token)
    };
  } catch (err) {
    if (err instanceof CloudCodeApiError && (err.status === 401 || err.status === 403)) {
      log.warn('[refresh] received 401/403, invalidating credentials and retrying once');
      tokenProvider.invalidate?.();
      clearCachedAccount();
      const fresh = await tokenProvider.getAccessToken();
      const account = await getAccountInfo(fresh, true);
      return {
        credits: account.availableCredits ?? null,
        response: await fetchAvailableModels(fresh)
      };
    }
    throw err;
  }
}

async function readLocalQuotaSnapshot(): Promise<ParsedSnapshot> {
  const entries = await fetchLocalLanguageServerModels();
  const snapshot = { groups: groupByFamily(entries), totalModelCount: entries.length };
  log.info(`[refresh] using local language-server quota: ${summarizeSnapshotCompact(snapshot)}`);
  log.debug(`[refresh] local quota entries: ${JSON.stringify(entries.map((entry) => ({
    modelId: entry.modelId,
    label: entry.label,
    remainingFraction: entry.remainingFraction,
    resetTime: entry.resetTime?.toISOString() ?? null
  })))}`);
  log.debug(`[refresh] parsed local quota groups: ${summarizeSnapshot(snapshot)}`);
  return snapshot;
}

function readRemoteQuotaSnapshot(remoteResponse: FetchAvailableModelsResponse): ParsedSnapshot {
  const snapshot = parseSnapshot(remoteResponse);
  log.info(`[refresh] using remote API quota fallback: ${summarizeSnapshotCompact(snapshot)}`);
  log.debug(`[refresh] raw remote quota entries: ${summarizeResponse(remoteResponse)}`);
  log.debug(`[refresh] parsed remote quota groups: ${summarizeSnapshot(snapshot)}`);
  return snapshot;
}

async function readUserStatus(): Promise<{ protoBase64: string; plan: ReturnType<typeof parseUserStatusProto> } | null> {
  try {
    const raw = await readStateValueByKey('antigravityAuthStatus');
    if (!raw) return null;
    const json = JSON.parse(raw);
    const protoBase64 = typeof json.userStatusProtoBinaryBase64 === 'string' ? json.userStatusProtoBinaryBase64 : '';
    const plan = parseUserStatusProto(protoBase64);
    return { protoBase64, plan };
  } catch (err) {
    log.debug(`[refresh] SQLite user status fallback skipped: ${err}`);
    return null;
  }
}

function summarizeResponse(response: FetchAvailableModelsResponse): string {
  const models = response.models ?? {};
  const rows = Object.entries(models).map(([key, info]) => ({
    key,
    model: info?.model ?? null,
    displayName: info?.displayName ?? null,
    disabled: info?.disabled === true,
    remainingFraction: info?.quotaInfo?.remainingFraction ?? null,
    resetTime: info?.quotaInfo?.resetTime ?? null
  }));
  return JSON.stringify({ count: rows.length, rows });
}

function summarizeSnapshot(snapshot: ParsedSnapshot): string {
  return JSON.stringify({
    totalModelCount: snapshot.totalModelCount,
    groups: snapshot.groups.map((group) => ({
      key: group.key,
      autoName: group.autoName,
      minRemainingFraction: group.minRemainingFraction,
      members: group.members.map((member) => ({
        modelId: member.modelId,
        label: member.label,
        remainingFraction: member.remainingFraction,
        resetTime: member.resetTime?.toISOString() ?? null
      }))
    }))
  });
}

function summarizeSnapshotCompact(snapshot: ParsedSnapshot): string {
  if (snapshot.groups.length === 0) return 'no groups';
  return snapshot.groups.map((group) => {
    const members = group.members
      .map((member) => `${member.label}=${Math.round(member.remainingFraction * 100)}%`)
      .join(', ');
    return `${group.autoName}: ${members}`;
  }).join(' | ');
}

function isAllFullSnapshot(snapshot: ParsedSnapshot): boolean {
  const members = snapshot.groups.flatMap((group) => group.members);
  return members.length > 0 && members.every((member) => member.remainingFraction === 1);
}

function classify(err: unknown): QuotaError {
  if (err instanceof OAuthRefreshError) {
    if (err.kind === 'invalid_grant') return { message: err.message, kind: 'auth' };
    if (err.kind === 'network') return { message: err.message, kind: 'network' };
    return { message: err.message, kind: 'unknown' };
  }
  if (err instanceof CloudCodeApiError) {
    if (err.status === 401 || err.status === 403) return { message: err.message, kind: 'auth' };
    return { message: err.message, kind: 'unknown' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/state\.vscdb|not found|sign in|signed.?out|antigravity/i.test(msg)) {
    return { message: msg, kind: 'config' };
  }
  return { message: msg, kind: 'unknown' };
}

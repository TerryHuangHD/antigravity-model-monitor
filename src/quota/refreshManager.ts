import * as vscode from 'vscode';
import {
  CloudCodeApiError,
  clearCachedAccount,
  fetchAvailableModels,
  getAccountInfo
} from '../api/cloudCodeClient';
import { OAuthRefreshError } from '../auth/oauthRefresher';
import { log } from '../log';
import { ParsedSnapshot, parseSnapshot } from './grouping';
import { readStateValueByKey } from '../auth/tokenReader';
import { parseUserStatusProto } from '../auth/userStatusParser';

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
        const token = await this.tokenProvider.getAccessToken();
        let response;
        let credits = this.current.availableCredits;
        try {
          // Refresh account info on every tick so credits stay live.
          const account = await getAccountInfo(token, true);
          credits = account.availableCredits ?? null;
          response = await fetchAvailableModels(token);
        } catch (err) {
          if (err instanceof CloudCodeApiError && (err.status === 401 || err.status === 403)) {
            log.warn('[refresh] received 401/403, invalidating credentials and retrying once');
            this.tokenProvider.invalidate?.();
            clearCachedAccount();
            const fresh = await this.tokenProvider.getAccessToken();
            const account = await getAccountInfo(fresh, true);
            credits = account.availableCredits ?? null;
            response = await fetchAvailableModels(fresh);
          } else {
            throw err;
          }
        }
        if (credits === null) {
          try {
            const raw = await readStateValueByKey('antigravityAuthStatus');
            if (raw) {
              const json = JSON.parse(raw);
              const plan = parseUserStatusProto(json.userStatusProtoBinaryBase64 || '');
              credits = plan.credits;
            }
          } catch (err) {
            log.debug(`[refresh] SQLite credits fallback skipped: ${err}`);
          }
        }
        const snapshot = parseSnapshot(response);
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

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { resolveCliExecutable } from './cliExecutable';
import { clampFraction, parseResetTime, SubscriptionLimit, SubscriptionUsage } from './types';

interface CodexRateWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

interface CodexRateLimitBucket {
  limitId?: unknown;
  limitName?: unknown;
  planType?: unknown;
  primary?: CodexRateWindow | null;
  secondary?: CodexRateWindow | null;
}

interface CodexRateLimitResult {
  rateLimits?: CodexRateLimitBucket | null;
  rateLimitsByLimitId?: Record<string, CodexRateLimitBucket> | null;
}

interface RpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

const WEEKLY_MINUTES_THRESHOLD = 6 * 24 * 60;

export async function fetchCodexUsage(configuredCliPath?: string): Promise<SubscriptionUsage> {
  const executable = resolveCliExecutable('codex', configuredCliPath, [
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex'
  ]);
  if (!executable) {
    throw new Error('Codex CLI was not found. Install it or set `agModelMonitor.codexCliPath`.');
  }

  const result = await requestRateLimits(executable);
  const parsed = parseCodexRateLimits(result);
  if (parsed.limits.length === 0) {
    throw new Error('Codex did not return a weekly usage window. Sign in with ChatGPT using `codex login`.');
  }

  return {
    key: 'codex',
    name: 'Codex',
    description: 'ChatGPT Codex subscription usage from the local Codex app server.',
    account: parsed.planType,
    source: 'codex app-server',
    limits: parsed.limits,
    error: null,
    lastUpdatedAt: new Date()
  };
}

export function parseCodexRateLimits(result: CodexRateLimitResult): {
  limits: SubscriptionLimit[];
  planType: string | null;
} {
  const bucket = chooseCodexBucket(result);
  if (!bucket) return { limits: [], planType: null };

  const windows = [bucket.primary, bucket.secondary]
    .filter((window): window is CodexRateWindow => !!window)
    .filter((window) => typeof window.windowDurationMins === 'number'
      && Number.isFinite(window.windowDurationMins)
      && window.windowDurationMins >= WEEKLY_MINUTES_THRESHOLD)
    .sort((a, b) => Number(b.windowDurationMins) - Number(a.windowDurationMins));

  const weekly = windows[0];
  if (!weekly || typeof weekly.usedPercent !== 'number' || !Number.isFinite(weekly.usedPercent)) {
    return { limits: [], planType: stringOrNull(bucket.planType) };
  }

  return {
    limits: [{
      id: 'weekly',
      label: 'Weekly Limit',
      remainingFraction: clampFraction(1 - weekly.usedPercent / 100),
      resetTime: parseResetTime(weekly.resetsAt),
      windowMinutes: Number(weekly.windowDurationMins)
    }],
    planType: stringOrNull(bucket.planType)
  };
}

function chooseCodexBucket(result: CodexRateLimitResult): CodexRateLimitBucket | null {
  if (result.rateLimits) return result.rateLimits;
  const buckets = Object.values(result.rateLimitsByLimitId ?? {});
  return buckets.find((bucket) => bucket.limitId === 'codex')
    ?? buckets.find((bucket) => [bucket.primary, bucket.secondary].some(
      (window) => typeof window?.windowDurationMins === 'number'
        && window.windowDurationMins >= WEEKLY_MINUTES_THRESHOLD
    ))
    ?? null;
}

function requestRateLimits(executable: string): Promise<CodexRateLimitResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let stderr = '';
    const finish = (error?: Error, value?: CodexRateLimitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve(value ?? {});
    };

    const timeout = setTimeout(() => finish(new Error('Codex app server timed out.')), 12_000);
    const lines = readline.createInterface({ input: child.stdout });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish(new Error(`Unable to start Codex app server: ${error.message}`)));
    child.on('exit', (code) => {
      if (!settled) {
        const detail = stderr.trim().slice(0, 400);
        finish(new Error(`Codex app server exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`));
      }
    });

    lines.on('line', (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }

      if (message.id === 0) {
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({ method: 'account/rateLimits/read', id: 1, params: {} })}\n`);
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          const text = typeof message.error.message === 'string' ? message.error.message : 'Unknown app-server error';
          finish(new Error(`Codex rate-limit request failed: ${text}`));
          return;
        }
        finish(undefined, (message.result ?? {}) as CodexRateLimitResult);
      }
    });

    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'subscription_usage_monitor',
          title: 'AI Subscription Usage Monitor',
          version: '0.6.0'
        }
      }
    })}\n`);
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

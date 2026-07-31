import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { clampFraction, parseResetTime, SubscriptionLimit, SubscriptionUsage } from './types';

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

interface ClaudeUsageWindow {
  utilization?: unknown;
  resets_at?: unknown;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
}

interface ClaudeOAuthCredential {
  accessToken?: unknown;
  subscriptionType?: unknown;
  rateLimitTier?: unknown;
}

interface ClaudeCredentialFile {
  claudeAiOauth?: ClaudeOAuthCredential;
}

interface ClaudeCredential {
  accessToken: string;
  account: string | null;
}

export async function fetchClaudeCodeUsage(): Promise<SubscriptionUsage> {
  const credential = await readClaudeCredential();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': 'claude-code'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body.trim().slice(0, 300);
      throw new Error(`Claude usage request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const data = (await response.json()) as ClaudeUsageResponse;
    const limits = parseClaudeUsage(data);
    if (limits.length === 0) {
      throw new Error('Claude Code did not return a five-hour or weekly usage window.');
    }

    return {
      key: 'claude-code',
      name: 'Claude Code',
      description: 'Claude subscription usage shared with Claude Code.',
      account: credential.account,
      source: 'Claude Code OAuth usage',
      limits,
      error: null,
      lastUpdatedAt: new Date()
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Claude usage request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseClaudeUsage(data: ClaudeUsageResponse): SubscriptionLimit[] {
  const limits: SubscriptionLimit[] = [];
  addClaudeWindow(limits, 'five-hour', 'Five Hour Limit', data.five_hour, 5 * 60);
  addClaudeWindow(limits, 'weekly', 'Weekly Limit', data.seven_day, 7 * 24 * 60);

  // Some account types expose only model-specific weekly buckets. Preserve a
  // truthful weekly reading instead of presenting no data at all.
  if (!data.seven_day) {
    addClaudeWindow(limits, 'weekly-sonnet', 'Weekly Sonnet Limit', data.seven_day_sonnet, 7 * 24 * 60);
    addClaudeWindow(limits, 'weekly-opus', 'Weekly Opus Limit', data.seven_day_opus, 7 * 24 * 60);
  }
  return limits;
}

function addClaudeWindow(
  limits: SubscriptionLimit[],
  id: string,
  label: string,
  window: ClaudeUsageWindow | null | undefined,
  windowMinutes: number
): void {
  if (!window || typeof window.utilization !== 'number' || !Number.isFinite(window.utilization)) return;
  limits.push({
    id,
    label,
    remainingFraction: clampFraction(1 - window.utilization / 100),
    resetTime: parseResetTime(window.resets_at),
    windowMinutes
  });
}

async function readClaudeCredential(): Promise<ClaudeCredential> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) return { accessToken: envToken, account: null };

  if (process.platform === 'darwin') {
    try {
      const raw = await execFileText('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w'
      ]);
      const parsed = parseCredential(raw);
      if (parsed) return parsed;
    } catch {
      // Fall through to the portable credential file.
    }
  }

  const configRoot = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  const credentialPath = path.join(configRoot, '.credentials.json');
  try {
    const parsed = parseCredential(await fs.readFile(credentialPath, 'utf8'));
    if (parsed) return parsed;
  } catch {
    // Report one actionable error below without leaking credential details.
  }

  throw new Error('Claude Code is not signed in. Run `claude auth login`, then refresh.');
}

function parseCredential(raw: string): ClaudeCredential | null {
  try {
    const parsed = JSON.parse(raw) as ClaudeCredentialFile;
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.trim() === '') return null;
    const account = typeof oauth.subscriptionType === 'string'
      ? oauth.subscriptionType
      : typeof oauth.rateLimitTier === 'string'
        ? oauth.rateLimitTier
        : null;
    return { accessToken: oauth.accessToken, account };
  } catch {
    return null;
  }
}

function execFileText(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

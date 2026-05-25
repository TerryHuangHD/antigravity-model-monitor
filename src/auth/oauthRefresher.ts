import { log } from '../log';

// Public OAuth client credentials shipped with the Antigravity desktop app.
// Same values are present in the upstream vscode-antigravity-cockpit reference repo;
// they are the client used by Antigravity for end-user sign-in.
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class OAuthRefreshError extends Error {
  constructor(message: string, readonly kind: 'invalid_grant' | 'network' | 'http' | 'other') {
    super(message);
  }
}

interface CachedAccessToken {
  accessToken: string;
  expiresAtMs: number;
}

export class OAuthRefresher {
  private cached: CachedAccessToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly getRefreshToken: () => Promise<string>) {}

  invalidate() {
    this.cached = null;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs - REFRESH_BUFFER_MS > now) {
      return this.cached.accessToken;
    }
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const refreshToken = await this.getRefreshToken();
      const { accessToken, expiresInSeconds } = await refresh(refreshToken);
      this.cached = {
        accessToken,
        expiresAtMs: Date.now() + expiresInSeconds * 1000
      };
      log.debug(`[oauth] refreshed access_token, expires in ${expiresInSeconds}s`);
      return accessToken;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }
}

async function refresh(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
  } catch (err) {
    throw new OAuthRefreshError(
      `Network error during token refresh: ${err instanceof Error ? err.message : String(err)}`,
      'network'
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (text.toLowerCase().includes('invalid_grant')) {
      throw new OAuthRefreshError('Antigravity session expired; sign in again.', 'invalid_grant');
    }
    throw new OAuthRefreshError(`Token refresh failed (HTTP ${response.status}): ${text}`, 'http');
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new OAuthRefreshError('Token refresh response missing access_token/expires_in', 'other');
  }
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

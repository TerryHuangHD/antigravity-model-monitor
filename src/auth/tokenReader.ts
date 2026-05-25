import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
// Use the explicit wasm entry point (matches what the upstream reference uses).
// The package's bare `'sql.js'` main can resolve to a different build under esbuild.
import initSqlJs, { Database } from 'sql.js/dist/sql-wasm.js';
import { log } from '../log';
import { getAntigravityStateDbPath } from './antigravityPaths';
import {
  OAuthTokenInfo,
  parseLegacyOAuthValue,
  parseUnifiedOAuthValue,
  scanForRefreshToken
} from './protobuf';

const AUTH_STATUS_KEY = 'antigravityAuthStatus';
const UNIFIED_STATE_KEY = 'antigravityUnifiedStateSync.oauthToken';
const LEGACY_STATE_KEY = 'jetskiStateSync.agentManagerInitState';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function getSqlJs(): ReturnType<typeof initSqlJs> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file: string) => pathToFileURL(path.join(__dirname, file)).href
    }).catch((err) => {
      sqlPromise = null;
      throw err;
    });
  }
  return sqlPromise;
}

async function openDatabase(dbPath: string): Promise<Database> {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Antigravity state database not found: ${dbPath}`);
  }
  const SQL = await getSqlJs();
  const buffer = fs.readFileSync(dbPath);
  return new SQL.Database(buffer);
}

async function readStateValue(dbPath: string, key: string): Promise<string | null> {
  const db = await openDatabase(dbPath);
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
    stmt.bind([key]);
    let value: string | null = null;
    if (stmt.step()) {
      const row = stmt.get();
      if (row && row[0] != null) {
        const v = String(row[0]).trim();
        if (v.length > 0) value = v;
      }
    }
    stmt.free();
    return value;
  } finally {
    db.close();
  }
}

export interface AntigravityAccessToken {
  accessToken: string;
  email?: string;
}

export interface AntigravityRefreshToken {
  refreshToken: string;
  source: 'unified' | 'legacy';
}

interface AuthStatusJson {
  apiKey?: string;
  email?: string;
  name?: string;
  userStatusProtoBinaryBase64?: string;
}

// Primary path: Antigravity caches a live access token in `antigravityAuthStatus`
// as JSON. Reading this on every refresh means we ride Antigravity's own token
// rotation — no OAuth refresh from our side.
export async function readAccessTokenFromAntigravity(): Promise<AntigravityAccessToken> {
  const dbPath = getAntigravityStateDbPath();
  const raw = await readStateValue(dbPath, AUTH_STATUS_KEY);
  if (!raw) {
    throw new Error(
      `Antigravity is not signed in (${AUTH_STATUS_KEY} missing in state.vscdb). ` +
      `Sign in to Antigravity first.`
    );
  }
  let parsed: AuthStatusJson;
  try {
    parsed = JSON.parse(raw) as AuthStatusJson;
  } catch (err) {
    throw new Error(
      `Failed to parse ${AUTH_STATUS_KEY} as JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed.apiKey || typeof parsed.apiKey !== 'string') {
    throw new Error(`${AUTH_STATUS_KEY} has no apiKey field (signed-out?).`);
  }
  return { accessToken: parsed.apiKey, email: parsed.email };
}

interface AttemptResult {
  key: string;
  exists: boolean;
  valueBytes: number;
  parseError: string | null;
  hasRefreshToken: boolean;
}

export async function readRefreshTokenFromAntigravity(): Promise<AntigravityRefreshToken> {
  const dbPath = getAntigravityStateDbPath();
  log.debug(`[tokenReader] state.vscdb path: ${dbPath}`);

  const attempts: AttemptResult[] = [];

  const unified = await readStateValue(dbPath, UNIFIED_STATE_KEY);
  if (unified) {
    let info: OAuthTokenInfo | null = null;
    let parseError: string | null = null;
    try {
      info = parseUnifiedOAuthValue(unified);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    // If structured parse didn't yield a refresh_token, fall back to a shape scan
    // so transient format changes (renamed fields, added wrappers) don't lock us out.
    const refreshToken = info?.refreshToken || scanForRefreshToken(unified);
    attempts.push({
      key: UNIFIED_STATE_KEY,
      exists: true,
      valueBytes: unified.length,
      parseError: refreshToken ? null : (parseError ?? 'no refresh-token found in payload'),
      hasRefreshToken: !!refreshToken
    });
    if (refreshToken) {
      log.info(`[tokenReader] using unified key (${UNIFIED_STATE_KEY})`);
      return { refreshToken, source: 'unified' };
    }
  } else {
    attempts.push({
      key: UNIFIED_STATE_KEY,
      exists: false,
      valueBytes: 0,
      parseError: null,
      hasRefreshToken: false
    });
  }

  const legacy = await readStateValue(dbPath, LEGACY_STATE_KEY);
  if (legacy) {
    let parseError: string | null = null;
    let info: OAuthTokenInfo | null = null;
    try {
      info = parseLegacyOAuthValue(legacy);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    attempts.push({
      key: LEGACY_STATE_KEY,
      exists: true,
      valueBytes: legacy.length,
      parseError,
      hasRefreshToken: !!info?.refreshToken
    });
    if (info?.refreshToken) {
      log.info(`[tokenReader] using legacy key (${LEGACY_STATE_KEY})`);
      return { refreshToken: info.refreshToken, source: 'legacy' };
    }
  } else {
    attempts.push({
      key: LEGACY_STATE_KEY,
      exists: false,
      valueBytes: 0,
      parseError: null,
      hasRefreshToken: false
    });
  }

  for (const a of attempts) {
    log.warn(
      `[tokenReader] ${a.key}: exists=${a.exists} bytes=${a.valueBytes} ` +
      `parseError=${a.parseError ?? '<none>'} hasRefreshToken=${a.hasRefreshToken}`
    );
  }

  throw new Error(
    'No Antigravity OAuth refresh_token found in state.vscdb. ' +
    'Sign in to Antigravity, or run "Antigravity Monitor: Dump State DB Keys" ' +
    'from the command palette to see what keys are present.'
  );
}

export interface StateDbKeyInfo {
  key: string;
  valueBytes: number;
}

export async function readStateValueByKey(key: string): Promise<string | null> {
  return readStateValue(getAntigravityStateDbPath(), key);
}

export async function dumpRelevantStateKeys(): Promise<{
  dbPath: string;
  exists: boolean;
  keys: StateDbKeyInfo[];
}> {
  const dbPath = getAntigravityStateDbPath();
  if (!fs.existsSync(dbPath)) {
    return { dbPath, exists: false, keys: [] };
  }
  const db = await openDatabase(dbPath);
  try {
    const stmt = db.prepare(
      "SELECT key, length(value) AS bytes FROM ItemTable " +
      "WHERE key LIKE '%oauth%' OR key LIKE '%Oauth%' OR key LIKE '%OAuth%' " +
      "OR key LIKE '%token%' OR key LIKE '%Token%' " +
      "OR key LIKE '%StateSync%' OR key LIKE '%antigravity%' OR key LIKE '%jetski%' " +
      "ORDER BY key"
    );
    const keys: StateDbKeyInfo[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      keys.push({
        key: String(row.key),
        valueBytes: Number(row.bytes ?? 0)
      });
    }
    stmt.free();
    return { dbPath, exists: true, keys };
  } finally {
    db.close();
  }
}

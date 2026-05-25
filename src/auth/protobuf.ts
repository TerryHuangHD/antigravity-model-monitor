// Minimal protobuf wire-format reader (varint + length-delimited).
// Used to extract OAuth refresh_token from Antigravity's state.vscdb blobs.

function readVarint(data: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos];
    result += (byte & 0x7f) * Math.pow(2, shift);
    pos += 1;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  throw new Error('Incomplete varint');
}

function skipField(data: Buffer, offset: number, wireType: number): number {
  if (wireType === 0) {
    const [, next] = readVarint(data, offset);
    return next;
  }
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const [length, contentOffset] = readVarint(data, offset);
    return contentOffset + length;
  }
  if (wireType === 5) return offset + 4;
  throw new Error(`Unknown wire type: ${wireType}`);
}

export function findField(data: Buffer, fieldNumber: number): Buffer | undefined {
  const all = findAllFields(data, fieldNumber);
  return all.length > 0 ? all[0] : undefined;
}

export function findAllFields(data: Buffer, fieldNumber: number): Buffer[] {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    let tag: number;
    let next: number;
    try {
      [tag, next] = readVarint(data, offset);
    } catch {
      return out;
    }
    const wireType = tag & 7;
    const num = tag >> 3;
    if (num === fieldNumber && wireType === 2) {
      const [length, contentOffset] = readVarint(data, next);
      out.push(data.subarray(contentOffset, contentOffset + length));
      offset = contentOffset + length;
      continue;
    }
    try {
      offset = skipField(data, next, wireType);
    } catch {
      return out;
    }
  }
  return out;
}

export interface OAuthTokenInfo {
  accessToken?: string;
  tokenType?: string;
  refreshToken?: string;
  expirySeconds?: number;
}

function parseTimestampSeconds(data: Buffer): number | undefined {
  let offset = 0;
  while (offset < data.length) {
    const [tag, next] = readVarint(data, offset);
    const wireType = tag & 7;
    const num = tag >> 3;
    offset = next;
    if (num === 1 && wireType === 0) {
      const [seconds] = readVarint(data, offset);
      return seconds;
    }
    offset = skipField(data, offset, wireType);
  }
  return undefined;
}

export function parseOAuthTokenInfo(data: Buffer): OAuthTokenInfo {
  let offset = 0;
  const info: OAuthTokenInfo = {};
  while (offset < data.length) {
    const [tag, next] = readVarint(data, offset);
    const wireType = tag & 7;
    const num = tag >> 3;
    offset = next;
    if (wireType !== 2) {
      offset = skipField(data, offset, wireType);
      continue;
    }
    const [length, contentOffset] = readVarint(data, offset);
    const value = data.subarray(contentOffset, contentOffset + length);
    offset = contentOffset + length;
    if (num === 1) info.accessToken = value.toString();
    else if (num === 2) info.tokenType = value.toString();
    else if (num === 3) info.refreshToken = value.toString();
    else if (num === 4) info.expirySeconds = parseTimestampSeconds(value);
  }
  return info;
}

// Legacy value (key: jetskiStateSync.agentManagerInitState) was base64 of a
// message whose field 6 carried the OAuthTokenInfo message.
export function parseLegacyOAuthValue(stateValueB64: string): OAuthTokenInfo {
  const raw = Buffer.from(stateValueB64.trim(), 'base64');
  const oauthField = findField(raw, 6);
  if (!oauthField) throw new Error('Legacy oauth: field 6 not found');
  return parseOAuthTokenInfo(oauthField);
}

// Current unified value (key: antigravityUnifiedStateSync.oauthToken).
// Layout observed in late-2026 Antigravity builds:
//   outer (base64) {
//     repeated field 1 = sentinel-keyed entry {
//       field 1 (string) = sentinel name
//       field 2 (bytes)  = payload  (text for JSON-shaped sentinels;
//                                    base64-encoded inner OAuthTokenInfo for the oauth one)
//     }
//   }
// Older builds used a single field-1 entry with sentinel "oauthTokenInfoSentinelKey".
// We scan every entry to remain forward-compatible with new co-resident sentinels.
const OAUTH_SENTINEL = 'oauthTokenInfoSentinelKey';

export function parseUnifiedOAuthValue(stateValueB64: string): OAuthTokenInfo {
  const outer = Buffer.from(stateValueB64.trim(), 'base64');
  const entries = findAllFields(outer, 1);
  if (entries.length === 0) {
    throw new Error('Unified oauth: no outer field-1 entries');
  }
  const errors: string[] = [];
  for (const entry of entries) {
    const sentinelBuf = findField(entry, 1);
    if (!sentinelBuf) continue;
    const sentinel = sentinelBuf.toString('utf8');
    if (sentinel !== OAUTH_SENTINEL) continue;

    const payloadBuf = findField(entry, 2);
    if (!payloadBuf) {
      errors.push('payload (field 2) missing');
      continue;
    }
    const payloadText = payloadBuf.toString('utf8').trim();
    let inner: Buffer;
    try {
      inner = Buffer.from(payloadText, 'base64');
    } catch (err) {
      errors.push(`base64 decode failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    return parseOAuthTokenInfo(inner);
  }

  const sentinels = entries
    .map((e) => findField(e, 1)?.toString('utf8') ?? '<no-sentinel>')
    .join(', ');
  throw new Error(
    `Unified oauth: sentinel "${OAUTH_SENTINEL}" not found (saw: ${sentinels})` +
    (errors.length ? `; errors: ${errors.join('; ')}` : '')
  );
}

// Google OAuth refresh tokens look like "1//" followed by 40+ URL-safe base64 chars.
// They appear verbatim as length-delimited strings somewhere inside the protobuf,
// regardless of how the outer message has been re-shaped across Antigravity versions.
// Sentinel formats we have seen so far: "oauthTokenInfoSentinelKey",
// "authStateWithContextSentinelKey".
const REFRESH_TOKEN_PATTERN = /1\/\/[A-Za-z0-9_-]{40,}/;

export function scanForRefreshToken(stateValueB64: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(stateValueB64.trim(), 'base64');
  } catch {
    return null;
  }
  // Look at the entire decoded blob as latin1 — that round-trips bytes 1:1 into
  // a JS string we can regex over without UTF-8 surprises.
  const asString = raw.toString('latin1');
  const m = asString.match(REFRESH_TOKEN_PATTERN);
  return m ? m[0] : null;
}

// Same scan but for an access token (server tokens are JWT-shaped: starts with "ya29." or "eyJ...").
// We don't strictly need this — the OAuth refresher will exchange the refresh_token —
// but having both lets us bypass the OAuth call when an unexpired access_token is already present.
const ACCESS_TOKEN_PATTERN = /(?:ya29\.[A-Za-z0-9_-]{40,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;

export function scanForAccessToken(stateValueB64: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(stateValueB64.trim(), 'base64');
  } catch {
    return null;
  }
  const asString = raw.toString('latin1');
  const m = asString.match(ACCESS_TOKEN_PATTERN);
  return m ? m[0] : null;
}

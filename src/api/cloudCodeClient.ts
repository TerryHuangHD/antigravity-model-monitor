import { log } from '../log';

const CLOUDCODE_BASE_URL = 'https://cloudcode-pa.googleapis.com';
const FETCH_AVAILABLE_MODELS_PATH = '/v1internal:fetchAvailableModels';
const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist';

export interface RawModelInfo {
  displayName?: string;
  model?: string;
  disabled?: boolean;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

export interface FetchAvailableModelsResponse {
  models?: Record<string, RawModelInfo>;
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id?: string };
  paidTier?: TierInfo;
  currentTier?: TierInfo;
}

interface TierInfo {
  id?: string;
  availableCredits?: Array<{ amount?: string | number; type?: string }>;
}

export interface AccountInfo {
  projectId?: string;
  availableCredits?: number;
  tierId?: string;
}

export class CloudCodeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function normalizePlatform(p: NodeJS.Platform): string {
  return p === 'win32' ? 'windows' : p;
}

function normalizeArch(arch: string): string {
  if (arch === 'x64') return 'amd64';
  if (arch === 'ia32') return '386';
  return arch;
}

function platformConstant(): string {
  const combined = `${normalizePlatform(process.platform)}/${normalizeArch(process.arch)}`;
  switch (combined) {
    case 'darwin/amd64': return 'DARWIN_AMD64';
    case 'darwin/arm64': return 'DARWIN_ARM64';
    case 'linux/amd64':  return 'LINUX_AMD64';
    case 'linux/arm64':  return 'LINUX_ARM64';
    case 'windows/amd64':return 'WINDOWS_AMD64';
    default: return 'PLATFORM_UNSPECIFIED';
  }
}

// Pinning to a recent Antigravity build is enough for the server to authorize
// us; we don't have visibility into the actual Antigravity binary version from
// here. If a future server check rejects this, bump to a newer string.
const ANTIGRAVITY_IDE_VERSION = '1.0.0';

function antigravityUserAgent(): string {
  return `antigravity/${ANTIGRAVITY_IDE_VERSION} ${normalizePlatform(process.platform)}/${normalizeArch(process.arch)}`;
}

function clientMetadata(duetProject?: string): Record<string, string> {
  const meta: Record<string, string> = {
    ideName: 'antigravity',
    ideType: 'ANTIGRAVITY',
    ideVersion: ANTIGRAVITY_IDE_VERSION,
    pluginVersion: ANTIGRAVITY_IDE_VERSION,
    platform: platformConstant(),
    updateChannel: 'stable',
    pluginType: 'GEMINI'
  };
  if (duetProject) meta.duetProject = duetProject;
  return meta;
}

async function postJson<T>(
  path: string,
  body: object,
  accessToken: string
): Promise<T> {
  const url = CLOUDCODE_BASE_URL + path;
  log.debug(`[api] POST ${url}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': antigravityUserAgent(),
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new CloudCodeApiError(`${path} HTTP ${response.status}: ${text}`, response.status);
  }
  return (await response.json()) as T;
}

let cachedAccount: AccountInfo | undefined;

function sumAvailableCredits(tier: TierInfo | undefined): number | undefined {
  if (!tier?.availableCredits) return undefined;
  let total = 0;
  let any = false;
  for (const c of tier.availableCredits) {
    const raw = typeof c.amount === 'string' ? Number(c.amount) : c.amount;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      total += raw;
      any = true;
    }
  }
  return any ? total : undefined;
}

async function loadAccount(accessToken: string): Promise<AccountInfo> {
  const body = {
    metadata: clientMetadata(),
    mode: 'FULL_ELIGIBILITY_CHECK'
  };
  const data = await postJson<LoadCodeAssistResponse>(LOAD_CODE_ASSIST_PATH, body, accessToken);
  let projectId: string | undefined;
  const project = data.cloudaicompanionProject;
  if (typeof project === 'string' && project) projectId = project;
  else if (project && typeof project === 'object' && project.id) projectId = project.id;

  const tier = data.paidTier ?? data.currentTier;
  const account: AccountInfo = {
    projectId,
    tierId: tier?.id,
    availableCredits: sumAvailableCredits(tier)
  };
  log.info(`[api] loadCodeAssist: project=${projectId ?? '<none>'} tier=${tier?.id ?? '<none>'} credits=${account.availableCredits ?? '<none>'}`);
  return account;
}

export async function getAccountInfo(accessToken: string, forceRefresh = false): Promise<AccountInfo> {
  if (!forceRefresh && cachedAccount) return cachedAccount;
  cachedAccount = await loadAccount(accessToken);
  return cachedAccount;
}

export function clearCachedAccount(): void {
  cachedAccount = undefined;
}

export async function fetchAvailableModels(accessToken: string): Promise<FetchAvailableModelsResponse> {
  const account = await getAccountInfo(accessToken);
  const payload = account.projectId ? { project: account.projectId } : {};
  return postJson<FetchAvailableModelsResponse>(FETCH_AVAILABLE_MODELS_PATH, payload, accessToken);
}

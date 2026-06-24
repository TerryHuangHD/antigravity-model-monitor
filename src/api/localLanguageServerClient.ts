import { execFile } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { promisify } from 'util';
import { log } from '../log';
import { ModelEntry } from '../quota/grouping';

const execFileAsync = promisify(execFile);
const GET_USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const GET_USER_STATUS_BODY = {
  metadata: {
    ideName: 'antigravity',
    extensionName: 'antigravity',
    locale: 'en'
  }
};

interface LanguageServerProcess {
  pid: number;
  port: number;
  csrfToken: string;
}

interface LanguageServerProcessArgs {
  pid: number;
  ppid: number;
  extensionPort: number;
  csrfToken: string;
}

type TimestampLike = string | { seconds?: string | number; nanos?: number; secondsLow?: number; secondsHigh?: number };

interface LocalQuotaModel {
  label?: string;
  displayName?: string;
  name?: string;
  modelOrAlias?: { model?: string };
  model_or_alias?: { model?: string };
  model?: string;
  disabled?: boolean;
  quotaInfo?: {
    remainingFraction?: number;
    remaining_fraction?: number;
    resetTime?: TimestampLike;
    reset_time?: TimestampLike;
  };
  quota_info?: {
    remainingFraction?: number;
    remaining_fraction?: number;
    resetTime?: TimestampLike;
    reset_time?: TimestampLike;
  };
}

interface LocalUserStatusResponse {
  userStatus?: LocalUserStatus;
  user_status?: LocalUserStatus;
  cascadeModelConfigData?: { clientModelConfigs?: LocalQuotaModel[] };
  cascade_model_config_data?: { client_model_configs?: LocalQuotaModel[] };
  clientModelConfigs?: LocalQuotaModel[];
  client_model_configs?: LocalQuotaModel[];
}

interface LocalUserStatus {
  cascadeModelConfigData?: { clientModelConfigs?: LocalQuotaModel[] };
  cascade_model_config_data?: { client_model_configs?: LocalQuotaModel[] };
}

export class LocalLanguageServerError extends Error {
  constructor(message: string, readonly responseReceived = false) {
    super(message);
  }
}

export async function fetchLocalLanguageServerModels(): Promise<ModelEntry[]> {
  const candidates = await findLanguageServerProcesses();
  if (candidates.length === 0) throw new LocalLanguageServerError('Antigravity language server process was not found');

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const data = await postLocalJson<LocalUserStatusResponse>(candidate, GET_USER_STATUS_PATH, GET_USER_STATUS_BODY);
      const entries = extractQuotaEntries(data);
      if (entries.length > 0) {
        log.info(`[local-ls] loaded ${entries.length} quota models from pid=${candidate.pid} port=${candidate.port}`);
        return entries;
      }
      lastError = new LocalLanguageServerError('GetUserStatus returned no quota models');
    } catch (err) {
      lastError = err;
      log.debug(`[local-ls] pid=${candidate.pid} port=${candidate.port} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new LocalLanguageServerError(String(lastError));
}

export function extractQuotaEntries(data: LocalUserStatusResponse): ModelEntry[] {
  const userStatus = data.userStatus ?? data.user_status;
  const models =
    userStatus?.cascadeModelConfigData?.clientModelConfigs
    ?? userStatus?.cascade_model_config_data?.client_model_configs
    ?? data.cascadeModelConfigData?.clientModelConfigs
    ?? data.cascade_model_config_data?.client_model_configs
    ?? data.clientModelConfigs
    ?? data.client_model_configs
    ?? [];

  const entries: ModelEntry[] = [];
  for (const model of models) {
    if (!model || model.disabled) continue;
    const quotaInfo = model.quotaInfo ?? model.quota_info;
    const remainingFraction = quotaInfo?.remainingFraction ?? quotaInfo?.remaining_fraction;
    if (typeof remainingFraction !== 'number' || remainingFraction < 0 || remainingFraction > 1) continue;

    const resetTime = parseResetTime(quotaInfo?.resetTime ?? quotaInfo?.reset_time);

    const modelId = model.modelOrAlias?.model ?? model.model_or_alias?.model ?? model.model;
    const label = (model.label ?? model.displayName ?? model.name ?? modelId ?? '').trim();
    if (!label && !modelId) continue;

    entries.push({
      modelId: modelId ?? label,
      label: label || modelId!,
      remainingFraction,
      resetTime
    });
  }
  return entries;
}

function parseResetTime(raw: TimestampLike | undefined): Date | null {
  if (!raw) return null;

  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const seconds = raw.seconds ?? decodeLongSeconds(raw.secondsLow, raw.secondsHigh);
  const secondsNumber = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (typeof secondsNumber !== 'number' || !Number.isFinite(secondsNumber)) return null;

  const millis = secondsNumber * 1000 + Math.floor((raw.nanos ?? 0) / 1_000_000);
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decodeLongSeconds(low: number | undefined, high: number | undefined): number | undefined {
  if (typeof low !== 'number') return undefined;
  const unsignedLow = low >>> 0;
  const signedHigh = high ?? 0;
  return signedHigh * 0x100000000 + unsignedLow;
}

async function findLanguageServerProcesses(): Promise<LanguageServerProcess[]> {
  if (process.platform === 'win32') return [];

  const { stdout } = await execFileAsync('ps', ['-ww', '-eo', 'pid=,ppid=,args='], { maxBuffer: 1024 * 1024 * 4 });
  const candidates: LanguageServerProcess[] = [];
  for (const processArgs of parseLanguageServerProcessList(stdout, process.pid)) {
    const ports = await discoverListeningPorts(processArgs.pid, processArgs.extensionPort);
    for (const discoveredPort of ports) {
      candidates.push({
        pid: processArgs.pid,
        port: discoveredPort,
        csrfToken: processArgs.csrfToken
      });
    }
  }
  return candidates;
}

export function parseLanguageServerProcessList(stdout: string, currentPid = process.pid): LanguageServerProcessArgs[] {
  const candidates: LanguageServerProcessArgs[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('--csrf_token') || !line.includes('--extension_server_port')) continue;

    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const args = splitCommandLine(match[3]);
    if (!isAntigravityLanguageServerArgs(args)) continue;

    const csrfToken = getArgValue(args, '--csrf_token');
    const portRaw = getArgValue(args, '--extension_server_port');
    const port = portRaw ? Number(portRaw) : NaN;
    if (!csrfToken || !Number.isInteger(port) || port <= 0 || port > 65535) continue;

    candidates.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      extensionPort: port,
      csrfToken
    });
  }

  return candidates.sort((a, b) => {
    const aIsChild = a.ppid === currentPid;
    const bIsChild = b.ppid === currentPid;
    if (aIsChild !== bIsChild) return aIsChild ? -1 : 1;
    return a.pid - b.pid;
  });
}

function isAntigravityLanguageServerArgs(args: string[]): boolean {
  if (!getArgValue(args, '--csrf_token') || !getArgValue(args, '--extension_server_port')) return false;

  const appDataDir = getArgValue(args, '--app_data_dir');
  if (appDataDir) {
    const normalized = appDataDir.replace(/\\/g, '/').toLowerCase();
    if (normalized === 'antigravity' || normalized.endsWith('/antigravity') || normalized.includes('/antigravity/')) {
      return true;
    }
  }

  return args.join(' ').toLowerCase().includes('antigravity');
}

async function discoverListeningPorts(pid: number, fallbackPort: number): Promise<number[]> {
  const ports = new Set<number>();
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', String(pid)], {
      maxBuffer: 1024 * 1024
    });
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/\bTCP\b.*:(\d+)\s+\(LISTEN\)/);
      const port = match ? Number(match[1]) : NaN;
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
    }
  } catch (err) {
    log.debug(`[local-ls] lsof port discovery failed for pid=${pid}: ${err instanceof Error ? err.message : String(err)}`);
  }

  ports.add(fallbackPort);
  return [...ports];
}

function getArgValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function splitCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current) args.push(current);
  return args;
}

export async function postLocalJson<T>(server: LanguageServerProcess, path: string, body: object): Promise<T> {
  try {
    return await postLocalJsonWithProtocol<T>('https', server, path, body);
  } catch (err) {
    if (err instanceof LocalLanguageServerError && err.responseReceived) throw err;
    log.debug(`[local-ls] HTTPS request failed for pid=${server.pid} port=${server.port}; trying HTTP fallback: ${err instanceof Error ? err.message : String(err)}`);
    return postLocalJsonWithProtocol<T>('http', server, path, body);
  }
}

async function postLocalJsonWithProtocol<T>(
  protocol: 'https' | 'http',
  server: LanguageServerProcess,
  path: string,
  body: object
): Promise<T> {
  const payload = JSON.stringify(body);
  const options: https.RequestOptions | http.RequestOptions = {
    hostname: '127.0.0.1',
    port: server.port,
    path,
    method: 'POST',
    agent: false,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Codeium-Csrf-Token': server.csrfToken,
      'Connect-Protocol-Version': '1'
    },
    ...(protocol === 'https' ? { rejectUnauthorized: false } : {})
  };

  return new Promise((resolve, reject) => {
    const requestModule = protocol === 'https' ? https : http;
    const req = requestModule.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new LocalLanguageServerError(`${path} ${protocol.toUpperCase()} ${res.statusCode ?? '<none>'}: ${text}`, true));
          return;
        }
        try {
          resolve((text ? JSON.parse(text) : {}) as T);
        } catch (err) {
          reject(new LocalLanguageServerError(`Invalid JSON from ${path}: ${err instanceof Error ? err.message : String(err)}`, true));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new LocalLanguageServerError(`${path} ${protocol.toUpperCase()} timed out`));
    });
    req.write(payload);
    req.end();
  });
}

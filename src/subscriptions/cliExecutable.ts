import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function resolveCliExecutable(
  command: string,
  configuredPath: string | undefined,
  additionalCandidates: string[] = []
): string | null {
  const executableNames = process.platform === 'win32'
    ? [command, `${command}.exe`, `${command}.cmd`]
    : [command];
  const candidates: string[] = [];

  if (configuredPath?.trim()) candidates.push(expandHome(configuredPath.trim()));

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const executableName of executableNames) {
      candidates.push(path.join(entry, executableName));
    }
  }

  candidates.push(...additionalCandidates.map(expandHome));

  for (const candidate of [...new Set(candidates)]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
  return value;
}

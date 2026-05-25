import * as os from 'os';
import * as path from 'path';

export function getAntigravityStateDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(home, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
}

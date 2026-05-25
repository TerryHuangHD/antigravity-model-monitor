import * as vscode from 'vscode';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private channel: vscode.OutputChannel | undefined;
  private currentLevel: Level = 'info';

  init(channel: vscode.OutputChannel) {
    this.channel = channel;
  }

  setLevel(level: Level) {
    this.currentLevel = level;
  }

  show() {
    this.channel?.show(true);
  }

  debug(msg: string) { this.write('debug', msg); }
  info(msg: string) { this.write('info', msg); }
  warn(msg: string) { this.write('warn', msg); }
  error(msg: string) { this.write('error', msg); }

  private write(level: Level, msg: string) {
    if (!this.channel) return;
    if (LEVEL_RANK[level] < LEVEL_RANK[this.currentLevel]) return;
    const ts = new Date().toISOString();
    this.channel.appendLine(`[${ts}] [${level.toUpperCase()}] ${msg}`);
  }
}

export const log = new Logger();

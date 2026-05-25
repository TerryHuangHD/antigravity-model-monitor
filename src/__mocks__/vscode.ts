// Minimal stub of the vscode module so unit tests can run under Node.
// Only members touched by tested modules need to be present.

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (l: (e: T) => void) => {
    this.listeners.push(l);
    return { dispose: () => {} };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
  dispose() {}
}

export const window = {
  createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
  showWarningMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    show: () => {},
    hide: () => {},
    dispose: () => {}
  })
};

export const workspace = {
  getConfiguration: () => ({ get: <T>(_k: string, fallback: T) => fallback })
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve()
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  supportHtml = false;
  constructor(value?: string) {
    if (value) this.value = value;
  }
  appendMarkdown(v: string) {
    this.value += v;
    return this;
  }
}

# AI Subscription Usage Monitor

A VS Code/Antigravity extension that shows Antigravity, Claude Code, and Codex subscription usage in one status-bar item and dashboard.

The extension reads local signed-in sessions. It does not ask you to paste API keys or copy OAuth tokens into settings.

## Monitored subscriptions

| Subscription | Limits shown | Data source |
| --- | --- | --- |
| Antigravity | Authoritative five-hour and weekly model-family limits | Antigravity local language server, with the existing OAuth/cloud fallback |
| Claude Code | Five-hour and weekly limits | Claude Code's locally stored OAuth session and the same usage endpoint used by the installed CLI |
| Codex | Weekly limit | Official local `codex app-server` method `account/rateLimits/read` |

Claude usage is shared across Claude product surfaces, including Claude Code. Codex local and cloud usage also share plan limits. The dashboard therefore reports subscription windows, not usage generated only by this extension.

## Features

- One color-coded status-bar summary for every available subscription.
- Three independent, consistently structured cards for Antigravity, Claude Code, and Codex.
- Rename, show/hide, and drag all three subscriptions to control status-bar and tooltip order.
- Rename, show/hide, and drag every quota content row inside each subscription.
- Independently hide a quota row's colored status icon without hiding its label, percentage, tooltip details, or alerts.
- Last-known Claude/Codex values remain visible when a later refresh fails.
- Existing Antigravity family/model customizations are honored when upgrading to the unified layout.
- Antigravity account details are intentionally limited to **Account** and **Description**. The previous tier, feature, upgrade, and plan-detail grid is no longer displayed.
- Warning and critical notifications apply to limits from all three subscriptions.

## Requirements

### Antigravity

Run the extension inside Antigravity and sign in normally. Its existing quota integration is unchanged.

### Claude Code

Install Claude Code and sign in with a Claude subscription:

```bash
claude auth login
claude auth status
```

On macOS, Claude Code stores its OAuth credential in Keychain. On other supported environments, the extension checks Claude Code's `.credentials.json` under `CLAUDE_CONFIG_DIR` or `~/.claude`.

Claude's subscription usage endpoint is part of the Claude Code client flow rather than a documented public API. If Anthropic changes that client contract, the Claude card will report the failure without affecting Antigravity or Codex.

### Codex

Install a current Codex CLI and sign in with ChatGPT:

```bash
codex login
codex login status
```

The extension discovers `codex` from `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. Set `agModelMonitor.codexCliPath` when the executable lives elsewhere.

Codex API-key-only auth does not expose ChatGPT subscription limits. Use ChatGPT login for the weekly quota card.

## Commands

All commands are available from the command palette:

| Command | What it does |
| --- | --- |
| `AI Subscription Usage Monitor: Open AI Subscription Usage Monitor` | Opens the dashboard. |
| `AI Subscription Usage Monitor: Refresh All Subscription Usage` | Refreshes all three sources. |
| `AI Subscription Usage Monitor: Show Logs` | Opens the extension output channel. |
| `AI Subscription Usage Monitor: Reset All Display Customizations` | Resets names, visibility, status-bar icon choices, and ordering for all subscriptions and quota rows. |

Antigravity diagnostic commands remain available for troubleshooting its local quota source.

## Settings

The internal `agModelMonitor` namespace is preserved for compatibility with existing installations.

| Setting | Default | Description |
| --- | ---: | --- |
| `agModelMonitor.refreshIntervalSeconds` | `120` | Refresh interval for every source, from 10 to 3600 seconds. |
| `agModelMonitor.warningThreshold` | `30` | Remaining percentage at which a limit becomes yellow. |
| `agModelMonitor.criticalThreshold` | `10` | Remaining percentage at which a limit becomes red. |
| `agModelMonitor.notificationsEnabled` | `true` | Notify when any visible limit crosses a threshold. |
| `agModelMonitor.showCreditsInStatusBar` | `true` | Include Antigravity credits in the status bar. |
| `agModelMonitor.codexCliPath` | `""` | Optional absolute path to the Codex CLI. |
| `agModelMonitor.logLevel` | `"info"` | Output verbosity: `debug`, `info`, `warn`, or `error`. |

## Privacy and credential handling

- OAuth access tokens are read only when a refresh is performed.
- Tokens are held in memory for the request and are never written or logged by this extension.
- Claude Code credentials remain in Claude Code's own secure storage.
- Codex credentials remain owned by Codex; the extension communicates with a short-lived local app-server process over stdio.
- Each provider has an independent error boundary, so one signed-out CLI does not suppress the other usage cards.

## Building from source

```bash
npm install
npm run build
npm test
npm run lint
npm run package
```

Press **F5** from Antigravity or VS Code to launch an Extension Development Host. Logs appear in the **AI Subscription Usage Monitor** output channel.

## Project layout

```text
src/
├── extension.ts
├── api/                         Antigravity local/cloud clients
├── auth/                        Antigravity auth and account parsing
├── quota/                       Refresh orchestration and Antigravity grouping
├── subscriptions/
│   ├── claudeCode.ts            Claude credential lookup + 5h/weekly usage
│   ├── codex.ts                 Codex app-server client + weekly parsing
│   ├── cliExecutable.ts         GUI-safe CLI discovery
│   ├── presentation.ts          Unified subscription/content presentation model
│   └── types.ts                 Shared subscription usage model
├── state/                       Subscription/content customization and ordering
├── statusBar/                   Combined status and notifications
└── webview/                     Multi-subscription dashboard
```

## License

MIT — see [LICENSE](LICENSE).

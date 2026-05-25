# Antigravity Model Monitor

A small VS Code extension for the [Antigravity](https://antigravity.google) AI editor that shows
your current model quota in the **status bar** and lets you rename models and quota groups in a
click-through panel.

> Inspired by [`vscode-antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit).
> This extension is a stripped-down version focused on a single status-bar item plus a rename UI.

## Features

- **Status bar item** — shows the quota group with the lowest remaining percent (e.g. `🚀 Sonnet: 87%`).
  Color-coded: normal / warning (≤30%) / critical (≤10%). Hover for a markdown table of all groups.
- **Click to manage** — opens a webview where you can give models and auto-detected quota groups
  custom display names. Names apply everywhere (status bar, tooltip, panel).
- **No Activity Bar clutter.** Status bar only.
- **Auto-refresh** every 120 seconds. Manual refresh from the command palette or the panel.
- **Threshold notifications** when a group crosses warning or critical.

## Requirements

This extension runs **inside the Antigravity editor itself**. It reads your already-signed-in
Antigravity OAuth refresh token from the editor's `state.vscdb`, refreshes the access token via
Google's OAuth endpoint, and calls Antigravity's quota API.

You must be signed in to Antigravity. If the extension can't find a token, the status bar shows
a warning and the output channel explains why.

## Commands

| Command                                    | What it does                              |
|--------------------------------------------|-------------------------------------------|
| `Antigravity Monitor: Open Panel`          | Open the management webview.              |
| `Antigravity Monitor: Refresh Quota`       | Force a refresh now.                      |
| `Antigravity Monitor: Show Logs`           | Reveal the output channel.                |
| `Antigravity Monitor: Reset All Custom Names` | Clear all custom group + model names.  |

## Settings

| Setting | Default | Notes |
|---|---|---|
| `agModelMonitor.refreshIntervalSeconds` | `120` | 10–3600. |
| `agModelMonitor.warningThreshold` | `30` | Percentage. Below this → yellow status bar. |
| `agModelMonitor.criticalThreshold` | `10` | Percentage. Below this → red status bar. |
| `agModelMonitor.notificationsEnabled` | `true` | Toast on threshold crossings. |
| `agModelMonitor.logLevel` | `info` | `debug` / `info` / `warn` / `error`. |

## How grouping works

Antigravity returns one quota entry per model, but several models often share the same quota pool.
This extension groups models that have identical `remainingFraction + resetTime` into one group
automatically. You can give each group its own display name — but you cannot manually move a model
between groups. When the quota resets, groups are re-derived from fresh API data.

Because group identity depends on the live quota signature, custom group names persist only as long
as the underlying pool keeps the same `remainingFraction + resetTime` between refreshes. If you find
yourself wanting durable group identity across resets, file an issue.

## Building from source

```bash
npm install
npm run build       # → out/extension.js (+ webview media + sql-wasm.wasm)
npm test            # → jest unit tests
npm run package     # → .vsix via @vscode/vsce
```

To debug, open the repo in Antigravity (or VS Code), press **F5** to launch an Extension Development
Host, and watch the *Antigravity Model Monitor* output channel.

## Project layout

```
src/
├── extension.ts            activation, commands, config wiring
├── log.ts                  output-channel logger
├── auth/
│   ├── antigravityPaths.ts host editor's state.vscdb location
│   ├── protobuf.ts         minimal wire-format reader
│   ├── tokenReader.ts      reads refresh_token from state.vscdb (sql.js)
│   └── oauthRefresher.ts   exchanges refresh_token for access_token
├── api/
│   └── cloudCodeClient.ts  POST fetchAvailableModels
├── quota/
│   ├── grouping.ts         API response → QuotaGroup[]   (pure)
│   └── refreshManager.ts   timer + state + events
├── state/
│   └── customNames.ts      group/model rename persistence (globalState)
├── statusBar/
│   └── statusBar.ts        status-bar item + threshold notifications
└── webview/
    ├── panel.ts            WebviewPanel lifecycle + message bus
    └── media/              HTML / CSS / JS for the rename page
```

The design document lives at [`docs/superpowers/specs/2026-05-25-antigravity-model-monitor-design.md`](docs/superpowers/specs/2026-05-25-antigravity-model-monitor-design.md).

## License

MIT — see [LICENSE](LICENSE).

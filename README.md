# Antigravity Model Monitor

A small VS Code extension for the [Antigravity](https://antigravity.google) AI editor that shows your current model quota in the **status bar** and lets you rename models and quota groups in an elegant, state-of-the-art interactive panel.

> Inspired by [`vscode-antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit).
> This extension is a lightweight version focused on a single status-bar item plus a premium manage UI.

---

## Features

- **Status Bar Monitor** — Shows each tracked family's binding limit, color-coded (e.g. `🟢 Gemini 5h: 84%  🟢 Claude/GPT 7d: 97%`); the bar's background reflects the lowest-remaining family.
  - **Color-Coded Alert Thresholds**: green (OK) / yellow (warning, ≤30%) / red (critical, ≤10%).
  - **Dynamic Tooltip**: Hovering over the status item reveals a beautiful markdown table detailing all tracked model groups.
- **Premium Management Panel** — A beautiful, responsive glassmorphic dashboard where you can:
  - Give model families and individual models custom friendly names that update everywhere in real-time.
  - Quick-toggle visibility to hide or show specific families/models in the status bar.
  - Review plan details (e.g., email, tier level, context windows) in a sleek, interactive, and expandable grid.
  - Toggle sensitive plan data visibility and configure refresh intervals.
- **Micro-Animations** — Delightful slide-up staggered animations on load, pulsing status glow effects, and smooth card elevations on hover.
- **No Sidebar Clutter** — Minimalist footprint, keeping all UI options tucked neatly inside the status bar and the command palette.
- **Toast Notifications** — Instant alerts when any quota group crosses warning or critical thresholds.

---

## Requirements

This extension runs **inside the Antigravity editor itself**. It reads quota primarily from Antigravity's **local language server** — the same `GetUserStatus` endpoint that powers the built-in quota dashboard. For account credits, and as a fallback when the local server is unavailable, it also reads your signed-in OAuth refresh token from the editor's database (`state.vscdb`), exchanges it via Google's OAuth endpoint, and calls Antigravity's remote quota API.

If the extension cannot reach either source, it displays a status-bar warning and provides troubleshooting guidance in its output channel logs.

---

## Commands

All commands can be invoked from the command palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux):

| Command | What it does |
|---|---|
| `Antigravity Model Monitor: Open Antigravity Model Monitor` | Open the premium management webview dashboard. |
| `Antigravity Model Monitor: Refresh Antigravity Quota` | Instantly fetch the latest quota from the API. |
| `Antigravity Model Monitor: Show Logs` | Open the extension's dedicated Output Channel. |
| `Antigravity Model Monitor: Reset All Custom Names` | Instantly reset all custom renames and visibility states. |

---

## Settings

Customize the extension's behavior in your VS Code settings under the `Antigravity Model Monitor` category:

| Setting | Default | Description |
|---|---|---|
| `agModelMonitor.refreshIntervalSeconds` | `120` | Interval in seconds between automatic quota updates (10–3600s). |
| `agModelMonitor.warningThreshold` | `30` | Percentage threshold below which the status bar and progress indicator turn yellow (5–80%). |
| `agModelMonitor.criticalThreshold` | `10` | Percentage threshold below which the status bar and progress indicator turn red (1–50%). |
| `agModelMonitor.notificationsEnabled` | `true` | Enable system toast alerts when any quota pool crosses a threshold. |
| `agModelMonitor.showCreditsInStatusBar` | `true` | Display your remaining balance/credits in the status bar alongside the model metrics. |
| `agModelMonitor.logLevel` | `"info"` | Logging verbosity for debugging (`"debug"`, `"info"`, `"warn"`, `"error"`). |

---

## How Grouping Works

Antigravity returns one quota entry per model — a remaining percentage and a reset time — and its built-in dashboard rolls those rows up into two cards: `Gemini Models` and `Claude and GPT models`. This extension uses the same two cards.

Each card shows a single limit: the **lowest remaining percentage** among that family's models — the most conservative, currently-binding constraint. That limit is labeled from its reset window: `Five Hour Limit` when the reset is within six hours, `Weekly Limit` when it is days away (and `Quota` if no reset time is reported).

Antigravity's quota API only reports the **currently-binding** window per model — whichever limit you are closest to hitting — so only one of the two limits is observable at a time. While the short-term cap is the tighter constraint you'll see `Five Hour Limit`; once the weekly cap binds it switches to `Weekly Limit`. The built-in dashboard can show both at once because it pulls additional data this extension does not have access to.

---

## Building from Source

```bash
npm install
npm run build       # → compiles out/extension.js (+ compiles webview media assets)
npm test            # → runs Jest unit tests
npm run package     # → builds a .vsix package via @vscode/vsce
```

To debug, open this repository in Antigravity (or VS Code), press **F5** to launch an Extension Development Host, and view the *Antigravity Model Monitor* output channel.

---

## Project Layout

```
src/
├── extension.ts            Activation, commands register, config wiring
├── log.ts                  Dedicated output-channel logger
├── auth/
│   ├── antigravityPaths.ts Resolves path to editor state.vscdb
│   ├── protobuf.ts         Wire-format reader for userStatus protobuf
│   ├── tokenReader.ts      Reads refresh_token from state.vscdb using sql.js
│   └── oauthRefresher.ts   Exchanges refresh_token for access_token
├── api/
│   ├── localLanguageServerClient.ts  Primary source: reads GetUserStatus from the local server
│   └── cloudCodeClient.ts  Remote fallback API (fetchAvailableModels) + account credits
├── quota/
│   ├── grouping.ts         Resolves raw model quota into one per-family limit (labeled by reset window)
│   └── refreshManager.ts   Main timer loop, state, and refresh triggers
├── state/
│   └── customNames.ts      Renaming/hiding state persistence (globalState)
├── statusBar/
│   └── statusBar.ts        Dynamic status-bar updates & toast notifications
└── webview/
    ├── panel.ts            WebviewPanel lifecycle manager & event bridge
    └── media/              Premium assets (HTML / CSS / Javascript)
```

The design document lives at [`docs/superpowers/specs/2026-05-25-antigravity-model-monitor-design.md`](docs/superpowers/specs/2026-05-25-antigravity-model-monitor-design.md).

---

## License

MIT — see [LICENSE](LICENSE).

# ProjectCycle — AI Context

## What This Is
A VS Code extension that shows all your VS Code projects in a sidebar panel, lets you cycle through them with keyboard shortcuts, assigns color-coded title bars per project, and tracks cumulative coding time per project.

Published as: `mahmutsalman.projectcycle`

---

## Project Structure

```
ProjectsCycle/
├── src/
│   └── extension.ts          ← ENTIRE extension in one file (~640 lines). This is the only file you edit.
├── out/
│   ├── extension.js          ← Compiled output (auto-generated, never edit)
│   └── extension.js.map
├── images/
│   ├── icon.png              ← Marketplace icon
│   ├── icon.svg
│   └── sidebar-icon.svg      ← Activity bar icon
├── package.json              ← Extension manifest: commands, keybindings, views, config schema
├── tsconfig.json             ← TypeScript config (compiles src/ → out/)
├── projectcycle-0.0.1.vsix   ← Built installable package (regenerated on each build)
└── CLAUDE.local.md           ← This file
```

---

## Architecture (extension.ts)

### Key Classes
- **`TimeTracker`** — Reads/writes `time-data.json` in VS Code's global storage. Stores `{ [absolutePath]: totalSeconds }`. Called every 60s to accumulate active time.
- **`ProjectItem`** — VS Code `TreeItem` subclass. Displays: colored dot icon + project name + `#rank  Xh Ym` description.
- **`ProjectsProvider`** — `TreeDataProvider` for a single list (priority or all). Pulls from VS Code config + TimeTracker on every refresh.

### Data Storage
| What | Where |
|------|-------|
| Priority project paths | VS Code global config: `projectcycle.priorityProjects` (array of abs paths) |
| All project paths | VS Code global config: `projectcycle.allProjects` |
| Per-project colors | VS Code global config: `projectcycle.projectColors` (path → hex) |
| Cumulative work time | `~/.../globalStorage/mahmutsalman.projectcycle/time-data.json` |
| Colored dot SVG icons | `~/.../globalStorage/mahmutsalman.projectcycle/icons/dot_<color>_<state>.svg` |
| Workbench colors | Workspace-level `.vscode/settings.json` (`workbench.colorCustomizations`) |

### Keybindings (defined in package.json)
- `Ctrl+,` → `projectcycle.cyclePriority` — focus next open priority project
- `Ctrl+Shift+,` → `projectcycle.cycleAll` — focus next open project from all list

### Time Tracking Logic
- Activity signals: `onDidChangeTextDocument`, `onDidSaveTextDocument`, `onDidChangeActiveTextEditor`, `onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution`
- Every 60s: if last editor activity < 2 min ago OR a terminal shell execution is running → add 60s to current project
- If user returns after >10 min gap → shows "Were you still working?" prompt
- `currentProject` = `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` (set once at activate, tracks this window's project)

### Window Open/Closed Detection
- Uses AppleScript via `osascript` to query running VS Code windows by name
- `queryOpenWindowNames()` → `Set<string>` of window titles
- `isProjectOpen(path)` → checks if basename appears in any window title
- Filled dot = open window, hollow dot = closed

---

## Build & Install Workflow

### 1. Compile TypeScript
```bash
npm run compile
```
Compiles `src/extension.ts` → `out/extension.js`. Run after every code change.

### 2. Package as VSIX
```bash
npx @vscode/vsce package --allow-missing-repository
```
Creates `projectcycle-0.0.1.vsix`. The `--allow-missing-repository` flag suppresses the warning about no git remote.

### 3. Install into VS Code
```bash
code --install-extension projectcycle-0.0.1.vsix
```

### One-liner (compile + package + install)
```bash
npm run compile && npx @vscode/vsce package --allow-missing-repository && code --install-extension projectcycle-0.0.1.vsix
```

### 4. Reload VS Code windows
After installing, reload each open VS Code window:
`Cmd+Shift+P` → "Developer: Reload Window"

> **Important**: `npm run compile` alone is NOT enough — the installed extension uses the `.vsix`. Always run all three steps.

---

## Common Gotchas

- **Changes not reflected after compile?** You forgot to package + install. Run the one-liner above.
- **Keybinding not working?** Check `~/Library/Application Support/Code/User/keybindings.json` for stale overrides from old versions.
- **Time not showing in sidebar?** Timer updates every 60s. Need at least 1 minute of active editing after install + reload.
- **AppleScript errors on queryOpenWindowNames?** Harmless — falls back to empty Set, all projects show as closed.
- **VSIX warnings about repository/license?** Safe to ignore, `--allow-missing-repository` suppresses the main one.

---

## Version History (brief)
- `0.0.1` — Initial release: sidebar views, priority/all lists, cycle keybindings
- `+` Per-project color assignment with live preview, colored title bars
- `+` Open/closed window indicators (filled vs hollow dot), click-to-focus
- `+` Per-project cumulative time tracker with idle detection and Claude Code terminal session tracking

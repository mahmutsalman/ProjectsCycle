# ProjectCycle

A macOS VS Code extension that turns each project into its own visual identity — color-coded title bars with animated modes, full editor theming (syntax + terminal), keyboard-driven window cycling, per-project time tracking, and one-click morning startup to reopen all your workspaces.

## Installation

1. Open VS Code
2. Go to the **Extensions** panel (`Cmd+Shift+X`)
3. Search for **ProjectCycle** or `mahmutsalman.projectcycle`
4. Click **Install**

> **macOS only** — window detection and switching use AppleScript.

### Required Permission

VS Code needs **Accessibility** access to switch between windows:

1. Open **System Settings → Privacy & Security → Accessibility**
2. Find **Code** (or **Cursor / Code - Insiders**) in the list and enable it
3. If it's not there, try triggering a cycle command first — macOS may prompt automatically

---

## Setup (First Time)

### 1. Open your projects in separate windows

ProjectCycle tracks each project as its own VS Code window. Open each folder via **File → Open Folder** and make sure each is its own window (not a multi-root workspace).

Every window you open is automatically added to the **All Projects** list.

### 2. Add your most-used projects to Priority Cycle

In the **ProjectCycle sidebar** (click the icon in the activity bar):

- Open the project window you want to add
- Click the **`+`** button in the **Priority Cycle** section header
- Repeat for each priority project

The Priority list is what `Ctrl+,` cycles through and what **Open All** uses.

### 3. Assign a color to each project (optional but recommended)

Right-click any project in the sidebar → **Assign Color**, or hover over it and click the color icon. Pick from the palette or enter a custom `#rrggbb` hex.

The color themes the entire VS Code UI for that project — title bar, activity bar, status bar, sidebar, tabs, terminal, editor syntax, and more.

### 4. Pick an animation mode (optional)

Click the **`$(symbol-event)`** button in the Priority Cycle header to cycle through modes, or press it repeatedly to find one you like. Use **`$(pin)`** to lock a mode and **`$(debug-step-over)`** to preview frames manually.

---

## Daily Use

### Opening all your projects at once

Click the **`$(run-all)`** button in the **Priority Cycle** section header.

This checks which of your priority projects are not yet open and opens each one in a new window — so every morning you click one button instead of manually launching each project.

### Switching between projects

| Shortcut | Action |
|----------|--------|
| `Ctrl+,` | Cycle through **Priority** projects |
| `Ctrl+.` | Cycle through **All Projects** |
| `Ctrl+;` | Go back to previous window |

You can also click any project in the sidebar to jump directly to it.

### Time tracking

The status bar (bottom left) shows how long you've been coding in the current project. Click it to:
- Pause / resume the timer
- Set an exact time manually
- Reset the counter

---

## Features

### Project Color Theming

Assign a color to any project and it themes the **entire VS Code chrome**:

| Area | What gets colored |
|------|------------------|
| Chrome edges | Title bar, activity bar, status bar |
| Panels | Sidebar, tabs, terminal, editor background, gutter |
| Overlays | Scrollbar, command palette, notifications, sticky scroll, breadcrumb |
| Editor UI | Find widget, hover tooltip, autocomplete dropdown, peek view, input fields |

### Syntax Theming

The editor's syntax colors are automatically derived from the three edge colors:

| Edge | Syntax tokens |
|------|--------------|
| Title bar (top) | keywords, types, classes, HTML tags |
| Activity bar (left) | functions, methods, namespaces, properties |
| Status bar (bottom) | strings, numbers, constants, regex |

Both TextMate (all languages) and Semantic tokens (TypeScript, Python, Rust, etc.) are set — semantic tokens add bold on declarations and italic on parameters and interfaces.

### Terminal Theming

Terminal colors follow the project palette:
- Cursor → title bar color
- Text selection → title bar color (semi-transparent)
- ⚠ Warning icons → status bar color
- Command gutter markers → activity bar color
- ANSI blue/magenta/yellow/cyan families → tinted to edge colors (red/green untouched)

### Animated Color Modes

Each project window can run an independent animation on a 5-minute cycle (30-second tick):

| Mode | Effect |
|------|--------|
| `standard` | Static exact color, no animation |
| `pulse` | Brightness breathes dark → bright → dark |
| `aurora` | Hue sweeps ±60° — visibly shifts color |
| `neon` | Saturation pulses grey → vivid |
| `ember` | Hue swings ±40° warm ↔ cool |

Every tick updates chrome, syntax, and terminal colors together in sync.

### Sidebar Header Buttons — Priority Cycle

| Button | Action |
|--------|--------|
| `$(add)` | Add the current project to the Priority list |
| `$(refresh)` | Refresh the list |
| `$(symbol-event)` | Cycle through color animation modes |
| `$(pin)` | Freeze / unfreeze animation at current frame |
| `$(debug-step-over)` | Step one animation frame forward manually |
| `$(run-all)` | Open all priority projects that are not yet open |

### Sidebar Header Buttons — All Projects

| Button | Action |
|--------|--------|
| `$(add)` | Add the current project to All Projects |
| `$(refresh)` | Refresh the list |

### Sidebar Item Context Menu

Right-click any project to: assign a color, move it up/down, remove it from the list, or add/remove it from favorites (All Projects only).

### Navigation History

`Ctrl+;` goes back to the previous window. History is shared across all open windows so it works from any window, not just the one you last navigated from.

---

## Data Storage

All data is stored in VS Code's global storage — it does **not** pollute your `settings.json` or any repository files.

| What | Location |
|------|----------|
| Priority list, colors, animation phase | `~/Library/Application Support/Code/User/globalStorage/mahmutsalman.projectcycle/projects-data.json` |
| Time tracking | `…/time-data.json` |
| Navigation history | `…/nav-history.json` |
| Per-window animation mode | VS Code `workspaceState` (survives reloads) |
| Workbench colors | Each project's `.vscode/settings.json` |

> **Backup tip**: copy the entire `globalStorage/mahmutsalman.projectcycle/` folder before uninstalling to preserve all data.

---

## Requirements

- macOS
- VS Code 1.85 or later
- Accessibility permission for VS Code (see Setup above)

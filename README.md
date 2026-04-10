# ProjectCycle

A macOS VS Code extension that turns each project into its own visual identity — color-coded title bars with animated modes, full editor theming (syntax + terminal), keyboard-driven window cycling, and per-project time tracking.

## Features

### Project Color Theming
Assign a color to any project and it themes the **entire VS Code chrome**:
- Title bar, activity bar, status bar (the three "edges")
- Sidebar, tabs, terminal background, editor background, gutter
- Scrollbar, command palette, notifications, sticky scroll, breadcrumb

### Syntax Theming
The editor's syntax colors are automatically derived from the three edge colors:

| Edge | Syntax tokens |
|------|--------------|
| Title bar (top) | keywords, types, classes, HTML tags |
| Activity bar (left) | functions, methods, namespaces, properties |
| Status bar (bottom) | strings, numbers, constants, regex |

Both TextMate (all languages) and Semantic tokens (TypeScript, Python, Rust, etc.) are set — semantic tokens add bold on declarations, italic on parameters and interfaces.

### Terminal Theming
Terminal colors follow the project palette too:
- Cursor → title bar color
- Text selection → title bar color (semi-transparent)
- ⚠ Warning icons → status bar color (no more hardcoded golden yellow)
- Command gutter markers → activity bar color
- ANSI blue/magenta/yellow/cyan families → tinted to edge colors (red/green untouched)

### Animated Color Modes
Each project window can run an independent animation mode:

| Mode | Effect |
|------|--------|
| `standard` | Static exact color |
| `pulse` | Brightness breathes dark → bright → dark |
| `aurora` | Hue sweeps ±60° — visibly shifts color |
| `neon` | Saturation pulses grey → vivid |
| `ember` | Hue swings ±40° warm ↔ cool |

Every tick advances all three layers together — chrome, syntax, and terminal all shift in sync.

### Animation Controls (sidebar header buttons)
| Button | Action |
|--------|--------|
| `$(symbol-event)` | Cycle through color modes |
| `$(pin)` | Freeze / unfreeze animation at current frame |
| `$(debug-step-over)` | Manual tick — step one frame forward |

### Window Cycling
| Shortcut | Action |
|----------|--------|
| `Ctrl+,` | Cycle **Priority** projects |
| `Ctrl+.` | Cycle **All Projects** |
| `Ctrl+;` | Go back (navigation history) |

Navigation history is shared across all open windows so go-back works from any window.

### Time Tracking
- Tracks cumulative coding time per project (active editor + terminal activity)
- Status bar item shows current session time — click to stop, continue, set, or reset
- Idle detection: prompts after 10 min gap asking if you were still working

### Sidebar Lists
- **Priority Cycle** — manually curated, cycled by `Ctrl+,`
- **All Projects** — auto-registered on every window open, cycled by `Ctrl+.`
- Filled dot = window currently open, hollow = closed
- Click any item to focus that window

## Requirements

- macOS (window switching uses AppleScript via `osascript`)
- VS Code must have **Accessibility** permission: **System Settings → Privacy & Security → Accessibility → Code**

## Getting Started

1. Open each project in its own VS Code window — they appear in **All Projects** automatically
2. Use `Ctrl+.` to cycle through all windows
3. Click the color swatch on any project in the sidebar to assign a color
4. Cycle through animation modes with the `$(symbol-event)` button
5. Use the tick button `$(debug-step-over)` to preview each animation frame
6. Freeze your favorite frame with `$(pin)`

# ProjectCycle

A macOS VSCode extension for cycling through open project windows using keyboard shortcuts, with user-controlled ordering via a sidebar panel.

## Features

- **Two independent cycle lists** — Priority Cycle and All Projects, each with its own keyboard shortcut
- **Sidebar panel** with inline reorder (`↑` `↓`) and remove (`🗑`) buttons per item
- **Auto-registration** — every window automatically adds itself to the All Projects list on startup
- **Position-aware cycling** — each window knows its own position in the list, so the shortcut always jumps to the correct next project regardless of which window triggers it

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+.` | Cycle through **Priority** projects in sidebar order |
| `Option+Shift+.` | Cycle through **All Projects** in sidebar order |

> Default bindings target a Turkish QWERTY-PC keyboard layout. To remap, open **Preferences → Keyboard Shortcuts** and search for `ProjectCycle`.

## Sidebar Panel

Click the ProjectCycle icon in the Activity Bar to open the sidebar. It contains two sections:

**Priority Cycle** — manually curated list cycled by `Ctrl+Shift+.`
- Click `+` in the section header to add the current window's project
- Hover over any item to reveal `↑` `↓` `🗑` inline buttons

**All Projects** — auto-populated list cycled by `Option+Shift+.`
- New windows register themselves automatically on startup
- Same inline reorder and remove controls as Priority Cycle

## Requirements

- macOS (window switching uses AppleScript via System Events)
- VSCode must have **Accessibility** permission: **System Settings → Privacy & Security → Accessibility → Code**

## Getting Started

1. Open each project in its own VSCode window — they appear in **All Projects** automatically
2. Use `Option+Shift+.` to cycle through all of them
3. To create a focused subset, open each priority project and click `+` in the **Priority Cycle** section header
4. Use `Ctrl+Shift+.` to cycle only those
5. Reorder either list with the `↑` `↓` buttons to control the cycle sequence

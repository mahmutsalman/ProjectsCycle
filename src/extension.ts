import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Color Palette
// ---------------------------------------------------------------------------

interface ThemeColor { name: string; hex: string; source: string; }

const COLOR_PALETTE: ThemeColor[] = [
    { name: 'Dracula Purple',     hex: '#bd93f9', source: 'Dracula' },
    { name: 'Dracula Pink',       hex: '#ff79c6', source: 'Dracula' },
    { name: 'Dracula Cyan',       hex: '#8be9fd', source: 'Dracula' },
    { name: 'Dracula Green',      hex: '#50fa7b', source: 'Dracula' },
    { name: 'Catppuccin Mauve',   hex: '#cba6f7', source: 'Catppuccin' },
    { name: 'Catppuccin Peach',   hex: '#fab387', source: 'Catppuccin' },
    { name: 'Catppuccin Sky',     hex: '#89dceb', source: 'Catppuccin' },
    { name: 'Catppuccin Green',   hex: '#a6e3a1', source: 'Catppuccin' },
    { name: 'Tokyo Blue',         hex: '#7aa2f7', source: 'Tokyo Night' },
    { name: 'Tokyo Purple',       hex: '#9d7cd8', source: 'Tokyo Night' },
    { name: 'Tokyo Cyan',         hex: '#7dcfff', source: 'Tokyo Night' },
    { name: 'Tokyo Green',        hex: '#9ece6a', source: 'Tokyo Night' },
    { name: 'Nord Frost Blue',    hex: '#88c0d0', source: 'Nord' },
    { name: 'Nord Aurora Red',    hex: '#bf616a', source: 'Nord' },
    { name: 'Nord Aurora Green',  hex: '#a3be8c', source: 'Nord' },
    { name: 'Nord Aurora Purple', hex: '#b48ead', source: 'Nord' },
    { name: 'Rose Pine Rose',     hex: '#ebbcba', source: 'Rose Pine' },
    { name: 'Rose Pine Iris',     hex: '#c4a7e7', source: 'Rose Pine' },
    { name: 'One Dark Orange',    hex: '#d19a66', source: 'One Dark' },
    { name: 'One Dark Red',       hex: '#e06c75', source: 'One Dark' },
    { name: 'Gruvbox Yellow',     hex: '#fabd2f', source: 'Gruvbox' },
    { name: 'Gruvbox Aqua',       hex: '#8ec07c', source: 'Gruvbox' },
];

// ---------------------------------------------------------------------------
// Sidebar Tree Views
// ---------------------------------------------------------------------------

class ProjectItem extends vscode.TreeItem {
    constructor(
        public readonly projectPath: string,
        public readonly index: number,
        public readonly contextVal: string,
        public readonly color?: string,
        private readonly storagePath?: string,
    ) {
        super(path.basename(projectPath), vscode.TreeItemCollapsibleState.None);
        this.description = `#${index + 1}`;
        this.tooltip = projectPath;
        this.contextValue = contextVal;
        this.iconPath = (color && storagePath)
            ? getColoredFolderIcon(color, storagePath)
            : new vscode.ThemeIcon('folder');
    }
}

class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly configKey: string,
        private readonly contextVal: string,
        private readonly storagePath: string,
    ) {}

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: ProjectItem): vscode.TreeItem { return element; }

    getChildren(): ProjectItem[] {
        const cfg = vscode.workspace.getConfiguration('projectcycle');
        const paths: string[] = cfg.get<string[]>(this.configKey) ?? [];
        const colors: Record<string, string> = cfg.get<Record<string, string>>('projectColors') ?? {};
        return paths.map((p, i) => new ProjectItem(p, i, this.contextVal, colors[p], this.storagePath));
    }
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    const storagePath = context.globalStorageUri.fsPath;
    const priorityProvider = new ProjectsProvider('priorityProjects', 'priorityItem', storagePath);
    const allProvider      = new ProjectsProvider('allProjects',      'allItem',      storagePath);

    const priorityView = vscode.window.createTreeView('projectcycle.priorityView', {
        treeDataProvider: priorityProvider,
        showCollapseAll: false,
    });
    const allView = vscode.window.createTreeView('projectcycle.allView', {
        treeDataProvider: allProvider,
        showCollapseAll: false,
    });

    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('projectcycle.priorityProjects')) { priorityProvider.refresh(); }
        if (e.affectsConfiguration('projectcycle.allProjects')) { allProvider.refresh(); }
        if (e.affectsConfiguration('projectcycle.projectColors')) {
            priorityProvider.refresh();
            allProvider.refresh();
        }
    }, null, context.subscriptions);

    // Auto-register this window's workspace into allProjects on startup
    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (currentFolder) {
        const config = vscode.workspace.getConfiguration('projectcycle');
        const allList: string[] = [...(config.get<string[]>('allProjects') ?? [])];
        if (!allList.includes(currentFolder)) {
            allList.push(currentFolder);
            config.update('allProjects', allList, vscode.ConfigurationTarget.Global).then(() => {
                allProvider.refresh();
            });
        }
        // Apply this project's color to workbench on startup
        const projectColors = config.get<Record<string, string>>('projectColors') ?? {};
        const startupColor = projectColors[currentFolder];
        if (startupColor) {
            applyProjectColor(startupColor);
        } else {
            removeProjectColor();
        }
    }

    context.subscriptions.push(
        priorityView,
        allView,

        // Cycle commands
        vscode.commands.registerCommand('projectcycle.cyclePriority', cyclePriority),
        vscode.commands.registerCommand('projectcycle.cycleAll', cycleAll),

        // Priority section
        vscode.commands.registerCommand('projectcycle.addCurrent', async () => {
            await addCurrentTo('priorityProjects', 'priority');
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.refreshPriorityView', () => priorityProvider.refresh()),
        vscode.commands.registerCommand('projectcycle.moveUp', async (item: ProjectItem) => {
            await moveInList('priorityProjects', item.projectPath, -1);
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveDown', async (item: ProjectItem) => {
            await moveInList('priorityProjects', item.projectPath, 1);
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.deleteProject', async (item: ProjectItem) => {
            await deleteFromList('priorityProjects', item.projectPath, 'priority cycle');
            priorityProvider.refresh();
        }),

        // All Projects section
        vscode.commands.registerCommand('projectcycle.addCurrentToAll', async () => {
            await addCurrentTo('allProjects', 'all projects');
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.refreshAllView', () => allProvider.refresh()),
        vscode.commands.registerCommand('projectcycle.moveUpAll', async (item: ProjectItem) => {
            await moveInList('allProjects', item.projectPath, -1);
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveDownAll', async (item: ProjectItem) => {
            await moveInList('allProjects', item.projectPath, 1);
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.deleteProjectAll', async (item: ProjectItem) => {
            await deleteFromList('allProjects', item.projectPath, 'all projects');
            allProvider.refresh();
        }),

        vscode.commands.registerCommand('projectcycle.removeCurrent', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) { return; }
            const currentPath = folders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('projectcycle');
            const list: string[] = config.get<string[]>('priorityProjects') ?? [];
            await config.update('priorityProjects', list.filter(p => p !== currentPath), vscode.ConfigurationTarget.Global);
            priorityProvider.refresh();
        }),

        vscode.commands.registerCommand('projectcycle.assignColor', async (item: ProjectItem) => {
            const cfg = vscode.workspace.getConfiguration('projectcycle');
            const colors: Record<string, string> = { ...(cfg.get<Record<string, string>>('projectColors') ?? {}) };
            const currentColor = colors[item.projectPath];
            const isActiveProject = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === item.projectPath;

            // Snapshot workbench colors so we can restore on cancel
            const originalWorkbenchColors = vscode.workspace.getConfiguration()
                .inspect('workbench.colorCustomizations')?.workspaceValue;

            type ColorPickItem = vscode.QuickPickItem & { hex?: string; action?: 'remove' | 'custom' };
            const pickerItems: ColorPickItem[] = COLOR_PALETTE.map(c => ({
                label:       c.name,
                description: c.hex,
                detail:      `${c.source}${currentColor === c.hex ? '  ✓ active' : ''}`,
                iconPath:    getColoredFolderIcon(c.hex, storagePath),
                hex:         c.hex,
            }));
            pickerItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator } as ColorPickItem);
            pickerItems.push({ label: '$(edit) Enter custom hex…', description: 'Any valid #rrggbb value', action: 'custom' });
            if (currentColor) {
                pickerItems.push({ label: '$(trash) Remove color', description: 'Restore default folder icon', action: 'remove' });
            }

            const qp = vscode.window.createQuickPick<ColorPickItem>();
            qp.title = `Assign color to ${path.basename(item.projectPath)}`;
            qp.placeholder = 'Pick a theme color or enter custom hex';
            qp.matchOnDescription = true;
            qp.matchOnDetail = true;
            qp.items = pickerItems;

            // Pre-select the current color if one exists
            if (currentColor) {
                const active = pickerItems.find(i => i.hex === currentColor);
                if (active) { qp.activeItems = [active]; }
            }

            let accepted = false;

            // Live preview as arrow keys move selection
            qp.onDidChangeActive(active => {
                const a = active[0] as ColorPickItem | undefined;
                if (isActiveProject && a?.hex) {
                    applyProjectColor(a.hex);
                }
            });

            const result = await new Promise<ColorPickItem | undefined>(resolve => {
                qp.onDidAccept(() => {
                    accepted = true;
                    resolve(qp.activeItems[0] as ColorPickItem | undefined);
                    qp.hide();
                });
                qp.onDidHide(() => {
                    if (!accepted) { resolve(undefined); }
                    qp.dispose();
                });
                qp.show();
            });

            // Restore original colors on cancel
            if (!result) {
                if (isActiveProject) {
                    await vscode.workspace.getConfiguration().update(
                        'workbench.colorCustomizations',
                        originalWorkbenchColors,
                        vscode.ConfigurationTarget.Workspace
                    );
                }
                return;
            }

            if (result.action === 'remove') {
                delete colors[item.projectPath];
                await cfg.update('projectColors', colors, vscode.ConfigurationTarget.Global);
                if (isActiveProject) { await removeProjectColor(); }
                return;
            }

            let finalHex: string | undefined;
            if (result.action === 'custom') {
                finalHex = await vscode.window.showInputBox({
                    title: 'Custom hex color',
                    prompt: 'Enter a hex color',
                    placeHolder: '#rrggbb',
                    value: currentColor ?? '#',
                    validateInput: v => /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Must be #rrggbb format',
                });
                if (!finalHex) {
                    // Restore on cancel from input box too
                    if (isActiveProject) {
                        await vscode.workspace.getConfiguration().update(
                            'workbench.colorCustomizations',
                            originalWorkbenchColors,
                            vscode.ConfigurationTarget.Workspace
                        );
                    }
                    return;
                }
                finalHex = finalHex.toLowerCase();
            } else {
                finalHex = result.hex;
            }
            if (!finalHex) { return; }

            colors[item.projectPath] = finalHex;
            await cfg.update('projectColors', colors, vscode.ConfigurationTarget.Global);
            if (isActiveProject) { await applyProjectColor(finalHex); }
        }),
    );
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Window utilities
// ---------------------------------------------------------------------------

function focusWindow(folderName: string): boolean {
    const safe = folderName.replace(/"/g, '\\"');
    const script = [
        'tell application "System Events"',
        '    tell process "Code"',
        '        set frontmost to true',
        `        repeat with w in (every window)`,
        `            if name of w contains "${safe}" then`,
        '                perform action "AXRaise" of w',
        '                return "found"',
        '            end if',
        '        end repeat',
        '    end tell',
        'end tell',
        'return "not_found"',
    ].join('\n');

    try {
        const result = execSync(`osascript -e '${script}'`, { timeout: 5000 }).toString().trim();
        return result === 'found';
    } catch {
        return false;
    }
}

function cycleList(configKey: string, emptyMsg: string, noneOpenMsg: string): void {
    const paths: string[] = vscode.workspace.getConfiguration('projectcycle').get(configKey) ?? [];
    if (paths.length === 0) {
        vscode.window.showInformationMessage(emptyMsg);
        return;
    }
    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const currentIdx = paths.indexOf(currentFolder);
    const start = (currentIdx + 1) % paths.length;
    for (let i = 0; i < paths.length; i++) {
        const idx = (start + i) % paths.length;
        if (focusWindow(path.basename(paths[idx]))) { return; }
    }
    vscode.window.showInformationMessage(noneOpenMsg);
}

// ---------------------------------------------------------------------------
// Cycle commands
// ---------------------------------------------------------------------------

function cyclePriority(): void {
    cycleList(
        'priorityProjects',
        'ProjectCycle: No priority projects configured. Use the sidebar to add projects.',
        'ProjectCycle: No priority projects are currently open.',
    );
}

function cycleAll(): void {
    cycleList(
        'allProjects',
        'ProjectCycle: No projects in "All Projects". Use the sidebar to add projects.',
        'ProjectCycle: No projects are currently open.',
    );
}

// ---------------------------------------------------------------------------
// Project management helpers
// ---------------------------------------------------------------------------

async function addCurrentTo(configKey: string, label: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('ProjectCycle: No workspace folder open.');
        return;
    }
    const currentPath = folders[0].uri.fsPath;
    const folderName = path.basename(currentPath);
    const config = vscode.workspace.getConfiguration('projectcycle');
    const list: string[] = [...(config.get<string[]>(configKey) ?? [])];
    if (list.includes(currentPath)) {
        vscode.window.showInformationMessage(`ProjectCycle: Already in ${label} — ${folderName}`);
        return;
    }
    list.push(currentPath);
    await config.update(configKey, list, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`ProjectCycle: Added to ${label}: ${folderName}`);
}

async function moveInList(configKey: string, projectPath: string, direction: -1 | 1): Promise<void> {
    const config = vscode.workspace.getConfiguration('projectcycle');
    const list: string[] = [...(config.get<string[]>(configKey) ?? [])];
    const idx = list.indexOf(projectPath);
    if (idx === -1) { return; }
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) { return; }
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
    await config.update(configKey, list, vscode.ConfigurationTarget.Global);
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function darkenHex(hex: string, amount: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
    const g = Math.max(0, Math.round(((n >> 8)  & 0xff) * (1 - amount)));
    const b = Math.max(0, Math.round((n & 0xff)          * (1 - amount)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function getContrastColor(hex: string): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const lum = (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255;
    return lum > 0.5 ? '#1e1e2e' : '#ffffff';
}

function getColoredFolderIcon(color: string, storagePath: string): vscode.Uri {
    const iconDir = path.join(storagePath, 'icons');
    const iconPath = path.join(iconDir, `dot_${color.replace('#', '')}.svg`);
    if (!fs.existsSync(iconPath)) {
        fs.mkdirSync(iconDir, { recursive: true });
        const stroke = darkenHex(color, 0.3);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
            `<circle cx="8" cy="8" r="5" fill="${color}" stroke="${stroke}" stroke-width="1.5"/>` +
            `</svg>`;
        fs.writeFileSync(iconPath, svg, 'utf8');
    }
    return vscode.Uri.file(iconPath);
}

async function applyProjectColor(hex: string): Promise<void> {
    const fg   = getContrastColor(hex);
    const dark = darkenHex(hex, 0.2);
    const cfg  = vscode.workspace.getConfiguration();
    const cur  = (cfg.inspect('workbench.colorCustomizations')?.workspaceValue as Record<string, string>) ?? {};
    await cfg.update('workbench.colorCustomizations', {
        ...cur,
        'titleBar.activeBackground':      hex,
        'titleBar.activeForeground':      fg,
        'titleBar.inactiveBackground':    dark,
        'titleBar.inactiveForeground':    fg + 'aa',
        'activityBar.background':         hex,
        'activityBar.foreground':         fg,
        'activityBar.inactiveForeground': fg + '88',
        'statusBar.background':           hex,
        'statusBar.foreground':           fg,
    }, vscode.ConfigurationTarget.Workspace);
}

async function removeProjectColor(): Promise<void> {
    const ours = [
        'titleBar.activeBackground', 'titleBar.activeForeground',
        'titleBar.inactiveBackground', 'titleBar.inactiveForeground',
        'activityBar.background', 'activityBar.foreground', 'activityBar.inactiveForeground',
        'statusBar.background', 'statusBar.foreground',
    ];
    const cfg  = vscode.workspace.getConfiguration();
    const cur  = (cfg.inspect('workbench.colorCustomizations')?.workspaceValue as Record<string, string>) ?? {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(cur)) {
        if (!ours.includes(k)) { cleaned[k] = v; }
    }
    await cfg.update('workbench.colorCustomizations',
        Object.keys(cleaned).length > 0 ? cleaned : undefined,
        vscode.ConfigurationTarget.Workspace);
}

async function deleteFromList(configKey: string, projectPath: string, label: string): Promise<void> {
    const folderName = path.basename(projectPath);
    const confirm = await vscode.window.showWarningMessage(
        `Remove "${folderName}" from ${label}?`,
        { modal: true },
        'Remove'
    );
    if (confirm !== 'Remove') { return; }
    const config = vscode.workspace.getConfiguration('projectcycle');
    const list: string[] = config.get<string[]>(configKey) ?? [];
    await config.update(configKey, list.filter(p => p !== projectPath), vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`ProjectCycle: Removed: ${folderName}`);
}

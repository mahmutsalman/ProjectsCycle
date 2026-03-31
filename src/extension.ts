import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

let openWindowNames: Set<string> = new Set();
let navHistory: string[] = [];
let store: ProjectStore;

// ---------------------------------------------------------------------------
// Color Palette
// ---------------------------------------------------------------------------

interface ThemeColor { name: string; hex: string; source: string; }

const COLOR_PALETTE: ThemeColor[] = [
    // Neon
    { name: 'Electric Blue',    hex: '#00b4ff', source: 'Neon' },
    { name: 'Neon Pink',        hex: '#ff2d78', source: 'Neon' },
    { name: 'Violet Flash',     hex: '#7c3aff', source: 'Neon' },
    { name: 'Laser Cyan',       hex: '#00e5ff', source: 'Neon' },
    { name: 'Lime Volt',        hex: '#aaff00', source: 'Neon' },
    { name: 'Red Laser',        hex: '#ff1e3c', source: 'Neon' },
    // Solar
    { name: 'Solar Orange',     hex: '#ff6500', source: 'Solar' },
    { name: 'Golden Hour',      hex: '#ffb300', source: 'Solar' },
    { name: 'Amber Flash',      hex: '#ff8f00', source: 'Solar' },
    { name: 'Tangerine',        hex: '#ff5500', source: 'Solar' },
    // Plasma
    { name: 'Plasma Magenta',   hex: '#e040fb', source: 'Plasma' },
    { name: 'Deep Magenta',     hex: '#cc00ff', source: 'Plasma' },
    { name: 'Hot Pink',         hex: '#ff0066', source: 'Plasma' },
    { name: 'Orchid',           hex: '#cc44ff', source: 'Plasma' },
    // Vivid
    { name: 'Coral Flash',      hex: '#ff4757', source: 'Vivid' },
    { name: 'Sky Spark',        hex: '#38c8ff', source: 'Vivid' },
    { name: 'Cobalt Blue',      hex: '#4489ff', source: 'Vivid' },
    { name: 'Aqua Spark',       hex: '#00b8e6', source: 'Vivid' },
    // Aurora
    { name: 'Aurora Green',     hex: '#00e676', source: 'Aurora' },
    { name: 'Teal Spark',       hex: '#00d2a8', source: 'Aurora' },
    { name: 'Mint Ice',         hex: '#5dffe0', source: 'Aurora' },
    { name: 'Jade Spark',       hex: '#00c97a', source: 'Aurora' },
];

// ---------------------------------------------------------------------------
// Time Tracker
// ---------------------------------------------------------------------------

interface TimeData { [projectPath: string]: number; }

class TimeTracker {
    private data: TimeData = {};
    private readonly filePath: string;

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, 'time-data.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
        } catch { this.data = {}; }
    }

    reload(): void { this.load(); }

    save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data), 'utf8');
        } catch {}
    }

    getSeconds(projectPath: string): number {
        return this.data[projectPath] ?? 0;
    }

    addSeconds(projectPath: string, n: number): void {
        this.data[projectPath] = (this.data[projectPath] ?? 0) + n;
        this.save();
    }

    resetProject(projectPath: string): void {
        delete this.data[projectPath];
        this.save();
    }

    format(seconds: number): string {
        if (seconds < 60) { return ''; }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
}

// ---------------------------------------------------------------------------
// Project Store  (replaces VS Code settings for project lists & colors)
// ---------------------------------------------------------------------------

interface ProjectsData {
    priorityProjects: string[];
    allProjects: string[];
    projectColors: Record<string, string>;
}

class ProjectStore {
    private data: ProjectsData = { priorityProjects: [], allProjects: [], projectColors: {} };
    private readonly filePath: string;

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, 'projects-data.json');
        this.load();
        this.migrateFromConfig();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                this.data = { priorityProjects: [], allProjects: [], projectColors: {}, ...parsed };
            }
        } catch { this.data = { priorityProjects: [], allProjects: [], projectColors: {} }; }
    }

    save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch {}
    }

    /** One-time migration: pull data out of VS Code global settings into our file. */
    private migrateFromConfig(): void {
        const cfg = vscode.workspace.getConfiguration('projectcycle');
        const priority: string[] = cfg.get<string[]>('priorityProjects') ?? [];
        const all: string[]      = cfg.get<string[]>('allProjects') ?? [];
        const colors: Record<string, string> = cfg.get<Record<string, string>>('projectColors') ?? {};

        if (priority.length === 0 && all.length === 0 && Object.keys(colors).length === 0) { return; }

        for (const p of priority) {
            if (!this.data.priorityProjects.includes(p)) { this.data.priorityProjects.push(p); }
        }
        for (const p of all) {
            if (!this.data.allProjects.includes(p)) { this.data.allProjects.push(p); }
        }
        for (const [k, v] of Object.entries(colors)) {
            if (!this.data.projectColors[k]) { this.data.projectColors[k] = v; }
        }
        this.save();

        // Clear stale entries from VS Code settings
        cfg.update('priorityProjects', undefined, vscode.ConfigurationTarget.Global);
        cfg.update('allProjects',      undefined, vscode.ConfigurationTarget.Global);
        cfg.update('projectColors',    undefined, vscode.ConfigurationTarget.Global);
    }

    getProjects(key: 'priorityProjects' | 'allProjects'): string[] {
        return [...this.data[key]];
    }

    setProjects(key: 'priorityProjects' | 'allProjects', list: string[]): void {
        this.data[key] = list;
        this.save();
    }

    getColors(): Record<string, string> {
        return { ...this.data.projectColors };
    }

    setColors(colors: Record<string, string>): void {
        this.data.projectColors = colors;
        this.save();
    }
}

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
        isOpen: boolean = false,
        timeStr?: string,
    ) {
        super(path.basename(projectPath), vscode.TreeItemCollapsibleState.None);
        this.description = timeStr ? `#${index + 1}  ${timeStr}` : `#${index + 1}`;
        this.tooltip = `${projectPath}\n${isOpen ? '● Open' : '○ Closed'}`;
        this.contextValue = contextVal;
        this.iconPath = storagePath
            ? getColoredFolderIcon(color ?? null, isOpen, storagePath)
            : new vscode.ThemeIcon('folder');
        this.command = {
            command: 'projectcycle.activateProject',
            title: isOpen ? 'Focus Window' : 'Open Project',
            arguments: [projectPath, isOpen],
        };
    }
}

class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly configKey: 'priorityProjects' | 'allProjects',
        private readonly contextVal: string,
        private readonly storagePath: string,
        private readonly tracker: TimeTracker,
        private readonly store: ProjectStore,
    ) {}

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: ProjectItem): vscode.TreeItem { return element; }

    getChildren(): ProjectItem[] {
        const paths = this.store.getProjects(this.configKey);
        const colors = this.store.getColors();
        return paths.map((p, i) => {
            const timeStr = this.tracker.format(this.tracker.getSeconds(p));
            return new ProjectItem(p, i, this.contextVal, colors[p], this.storagePath, isProjectOpen(p), timeStr);
        });
    }
}

// ---------------------------------------------------------------------------
// Keybinding injection — ensures ctrl+. override is in user keybindings.json
// ---------------------------------------------------------------------------

function ensureCycleAllKeybinding(context: vscode.ExtensionContext): void {
    const stateKey = 'keybindingInjected_v1';
    if (context.globalState.get(stateKey)) { return; }

    try {
        // Derive the VS Code variant folder name (Code, Code - Insiders, Cursor, etc.)
        const appFolder = vscode.env.appName.replace('Visual Studio ', '');

        let keybindingsPath: string;
        if (process.platform === 'darwin') {
            keybindingsPath = path.join(os.homedir(), 'Library', 'Application Support', appFolder, 'User', 'keybindings.json');
        } else if (process.platform === 'win32') {
            keybindingsPath = path.join(process.env.APPDATA ?? os.homedir(), appFolder, 'User', 'keybindings.json');
        } else {
            keybindingsPath = path.join(os.homedir(), '.config', appFolder, 'User', 'keybindings.json');
        }

        let content = fs.existsSync(keybindingsPath)
            ? fs.readFileSync(keybindingsPath, 'utf8').trim()
            : '[]';

        // Already injected (maybe manually by user)
        if (content.includes('projectcycle.cycleAll')) {
            context.globalState.update(stateKey, true);
            return;
        }

        const entry = `    {\n        "key": "ctrl+.",\n        "command": "projectcycle.cycleAll"\n    }`;

        if (!content || content === '[]') {
            content = `[\n${entry}\n]`;
        } else {
            const lastBracket = content.lastIndexOf(']');
            const before = content.slice(0, lastBracket).trimEnd();
            const separator = before.endsWith(',') ? '' : ',';
            content = before + separator + '\n' + entry + '\n]';
        }

        fs.writeFileSync(keybindingsPath, content, 'utf8');
        context.globalState.update(stateKey, true);
    } catch {
        // Non-critical — extension still works, user can add manually
    }
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    ensureCycleAllKeybinding(context);

    const storagePath = context.globalStorageUri.fsPath;
    store = new ProjectStore(storagePath);
    const tracker = new TimeTracker(storagePath);
    const currentProject = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const priorityProvider = new ProjectsProvider('priorityProjects', 'priorityItem', storagePath, tracker, store);
    const allProvider      = new ProjectsProvider('allProjects',      'allItem',      storagePath, tracker, store);

    openWindowNames = queryOpenWindowNames();

    const priorityView = vscode.window.createTreeView('projectcycle.priorityView', {
        treeDataProvider: priorityProvider,
        showCollapseAll: false,
    });
    const allView = vscode.window.createTreeView('projectcycle.allView', {
        treeDataProvider: allProvider,
        showCollapseAll: false,
    });

    // Auto-register this window's workspace into allProjects on startup
    if (currentProject) {
        const allList = store.getProjects('allProjects');
        if (!allList.includes(currentProject)) {
            allList.push(currentProject);
            store.setProjects('allProjects', allList);
            allProvider.refresh();
        }
        // Apply this project's color to workbench on startup
        const startupColor = store.getColors()[currentProject];
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
        vscode.commands.registerCommand('projectcycle.addCurrent', () => {
            addCurrentTo('priorityProjects', 'priority');
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.refreshPriorityView', () => {
            tracker.reload();
            openWindowNames = queryOpenWindowNames();
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveUp', (item: ProjectItem) => {
            moveInList('priorityProjects', item.projectPath, -1);
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveDown', (item: ProjectItem) => {
            moveInList('priorityProjects', item.projectPath, 1);
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.deleteProject', async (item: ProjectItem) => {
            await deleteFromList('priorityProjects', item.projectPath, 'priority cycle');
            priorityProvider.refresh();
        }),

        // All Projects section
        vscode.commands.registerCommand('projectcycle.addCurrentToAll', () => {
            addCurrentTo('allProjects', 'all projects');
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.refreshAllView', () => {
            tracker.reload();
            openWindowNames = queryOpenWindowNames();
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveUpAll', (item: ProjectItem) => {
            moveInList('allProjects', item.projectPath, -1);
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.moveDownAll', (item: ProjectItem) => {
            moveInList('allProjects', item.projectPath, 1);
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.deleteProjectAll', async (item: ProjectItem) => {
            await deleteFromList('allProjects', item.projectPath, 'all projects');
            allProvider.refresh();
        }),

        vscode.commands.registerCommand('projectcycle.removeCurrent', () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) { return; }
            const currentPath = folders[0].uri.fsPath;
            store.setProjects('priorityProjects', store.getProjects('priorityProjects').filter(p => p !== currentPath));
            priorityProvider.refresh();
        }),

        vscode.commands.registerCommand('projectcycle.activateProject', async (projectPath: string, isOpen: boolean) => {
            const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (isOpen) {
                if (focusWindow(path.basename(projectPath))) {
                    pushNavHistory(currentFolder ?? '');
                }
            } else {
                pushNavHistory(currentFolder ?? '');
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), { forceNewWindow: true });
            }
        }),

        vscode.commands.registerCommand('projectcycle.goBack', () => {
            if (navHistory.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No previous window in history.');
                return;
            }
            const prev = navHistory.pop()!;
            focusWindow(path.basename(prev));
        }),

        vscode.commands.registerCommand('projectcycle.assignColor', async (item: ProjectItem) => {
            const colors: Record<string, string> = store.getColors();
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
                iconPath:    getColoredFolderIcon(c.hex, true, storagePath),
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

            // Live preview via arrow keys
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
                store.setColors(colors);
                if (isActiveProject) { await removeProjectColor(); }
                priorityProvider.refresh();
                allProvider.refresh();
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
            store.setColors(colors);
            priorityProvider.refresh();
            allProvider.refresh();
            if (isActiveProject) { await applyProjectColor(finalHex); }
        }),
    );

    // -------------------------------------------------------------------------
    // Time Tracking
    // -------------------------------------------------------------------------

    const IDLE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes
    const ACTIVE_WINDOW_MS  =  2 * 60 * 1000;  // still active if last event < 2 min ago

    let lastActivityTime: number | null = null;
    let idlePromptInFlight = false;
    let activeTerminalExecutions = 0;
    let timerStopped = false;

    // --- Status bar item ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -9999);
    statusBarItem.command = 'projectcycle.timerMenu';
    statusBarItem.text = '$(watch) —';
    statusBarItem.tooltip = 'ProjectCycle timer';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    function updateStatusBar(): void {
        if (!currentProject) {
            statusBarItem.text = `$(watch) —`;
            statusBarItem.tooltip = 'ProjectCycle: no workspace open';
            statusBarItem.backgroundColor = undefined;
            return;
        }
        const timeStr = tracker.format(tracker.getSeconds(currentProject)) || '< 1m';
        const isActiveTick = !timerStopped && (
            (lastActivityTime !== null && Date.now() - lastActivityTime < ACTIVE_WINDOW_MS) ||
            activeTerminalExecutions > 0
        );
        if (timerStopped) {
            statusBarItem.text = `$(debug-pause) ${timeStr}`;
            statusBarItem.tooltip = `ProjectCycle: timer stopped — click to manage`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (isActiveTick) {
            statusBarItem.text = `$(circle-filled) ${timeStr}`;
            statusBarItem.tooltip = `ProjectCycle: counting — ${path.basename(currentProject)}\nClick to stop or reset`;
            statusBarItem.backgroundColor = undefined;
        } else {
            statusBarItem.text = `$(circle-large-outline) ${timeStr}`;
            statusBarItem.tooltip = `ProjectCycle: idle — ${path.basename(currentProject)}\nClick to stop or reset`;
            statusBarItem.backgroundColor = undefined;
        }
    }

    updateStatusBar();

    // --- Timer menu command ---
    context.subscriptions.push(
        vscode.commands.registerCommand('projectcycle.timerMenu', async () => {
            if (!currentProject) { return; }
            const projectName = path.basename(currentProject);
            const timeStr = tracker.format(tracker.getSeconds(currentProject)) || '< 1m';

            type MenuItem = vscode.QuickPickItem & { action: string };
            const items: MenuItem[] = timerStopped
                ? [
                    { label: '$(play) Continue', description: `Resume timing for ${projectName}`, action: 'continue' },
                    { label: '$(trash) Reset', description: `Clear all tracked time for ${projectName} (${timeStr})`, action: 'reset' },
                ]
                : [
                    { label: '$(debug-pause) Stop Timing', description: `Pause timer for ${projectName}`, action: 'stop' },
                    { label: '$(trash) Reset', description: `Clear all tracked time for ${projectName} (${timeStr})`, action: 'reset' },
                ];

            const picked = await vscode.window.showQuickPick(items, {
                title: `ProjectCycle Timer — ${projectName}  ${timeStr}`,
                placeHolder: 'Choose an action',
            }) as MenuItem | undefined;

            if (!picked) { return; }

            if (picked.action === 'stop') {
                timerStopped = true;
            } else if (picked.action === 'continue') {
                timerStopped = false;
                lastActivityTime = Date.now();
            } else if (picked.action === 'reset') {
                const confirm = await vscode.window.showWarningMessage(
                    `Reset all tracked time for "${projectName}"?`,
                    { modal: true },
                    'Reset',
                );
                if (confirm === 'Reset') {
                    tracker.resetProject(currentProject);
                    refreshTree();
                }
            }
            updateStatusBar();
        }),
    );

    function refreshTree(): void {
        priorityProvider.refresh();
        allProvider.refresh();
    }

    function recordActivity(): void {
        if (!currentProject || timerStopped) { return; }
        const now = Date.now();

        if (lastActivityTime !== null && !idlePromptInFlight) {
            const gap = now - lastActivityTime;
            if (gap > IDLE_THRESHOLD_MS) {
                idlePromptInFlight = true;
                const mins = Math.round(gap / 60000);
                const projectName = path.basename(currentProject);
                vscode.window.showInformationMessage(
                    `ProjectCycle: Were you still working on "${projectName}" during the last ${mins} minutes?`,
                    'Yes, add it',
                    'No, skip',
                ).then(answer => {
                    if (answer === 'Yes, add it') {
                        tracker.addSeconds(currentProject!, Math.floor(gap / 1000));
                        refreshTree();
                    }
                    lastActivityTime = Date.now();
                    idlePromptInFlight = false;
                    updateStatusBar();
                });
                return;
            }
        }

        lastActivityTime = now;
        updateStatusBar();
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(() => recordActivity()),
        vscode.workspace.onDidSaveTextDocument(() => recordActivity()),
        vscode.window.onDidChangeActiveTextEditor(() => recordActivity()),
        // Fires when user switches focus to a terminal (e.g. clicks into Claude Code)
        vscode.window.onDidChangeActiveTerminal(terminal => {
            if (terminal) { recordActivity(); }
        }),
        vscode.window.onDidStartTerminalShellExecution(() => {
            activeTerminalExecutions++;
            recordActivity();
        }),
        vscode.window.onDidEndTerminalShellExecution(() => {
            activeTerminalExecutions = Math.max(0, activeTerminalExecutions - 1);
            recordActivity();
        }),
    );

    // Terminal heartbeat: while shell integration confirms a command is running
    // (e.g. an active Claude Code session), keep lastActivityTime fresh every 30s
    // so the main 60s tick keeps counting without needing per-keystroke events.
    // Note: requires VS Code shell integration to be active (default for zsh/bash).
    const terminalHeartbeat = setInterval(() => {
        if (!currentProject || timerStopped || activeTerminalExecutions === 0) { return; }
        lastActivityTime = Date.now();
        updateStatusBar();
    }, 30_000);

    const timer = setInterval(() => {
        if (!currentProject || timerStopped) { return; }
        const recentEditorActivity = lastActivityTime !== null && Date.now() - lastActivityTime < ACTIVE_WINDOW_MS;
        const terminalSessionRunning = activeTerminalExecutions > 0;
        if (recentEditorActivity || terminalSessionRunning) {
            tracker.addSeconds(currentProject, 60);
            refreshTree();
        }
        updateStatusBar();
    }, 60_000);

    context.subscriptions.push(
        { dispose: () => clearInterval(terminalHeartbeat) },
        { dispose: () => clearInterval(timer) },
    );
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Window utilities
// ---------------------------------------------------------------------------

function queryOpenWindowNames(): Set<string> {
    const script = [
        'tell application "System Events"',
        '    tell process "Code"',
        '        get name of every window',
        '    end tell',
        'end tell',
    ].join('\n');
    try {
        const raw = execSync(`osascript -e '${script}'`, { timeout: 5000 }).toString().trim();
        return new Set(raw.split(', '));
    } catch {
        return new Set();
    }
}

function isProjectOpen(projectPath: string): boolean {
    const name = path.basename(projectPath);
    for (const w of openWindowNames) {
        if (w.includes(name)) { return true; }
    }
    return false;
}

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

function cycleList(configKey: 'priorityProjects' | 'allProjects', emptyMsg: string, noneOpenMsg: string): void {
    const paths = store.getProjects(configKey);
    if (paths.length === 0) {
        vscode.window.showInformationMessage(emptyMsg);
        return;
    }
    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const currentIdx = paths.indexOf(currentFolder);
    const start = (currentIdx + 1) % paths.length;
    for (let i = 0; i < paths.length; i++) {
        const idx = (start + i) % paths.length;
        if (focusWindow(path.basename(paths[idx]))) {
            pushNavHistory(currentFolder);
            return;
        }
    }
    vscode.window.showInformationMessage(noneOpenMsg);
}

function pushNavHistory(projectPath: string): void {
    if (!projectPath) { return; }
    // Don't push consecutive duplicates
    if (navHistory[navHistory.length - 1] === projectPath) { return; }
    navHistory.push(projectPath);
    if (navHistory.length > 50) { navHistory.shift(); }
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

function addCurrentTo(configKey: 'priorityProjects' | 'allProjects', label: string): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('ProjectCycle: No workspace folder open.');
        return;
    }
    const currentPath = folders[0].uri.fsPath;
    const folderName = path.basename(currentPath);
    const list = store.getProjects(configKey);
    if (list.includes(currentPath)) {
        vscode.window.showInformationMessage(`ProjectCycle: Already in ${label} — ${folderName}`);
        return;
    }
    list.push(currentPath);
    store.setProjects(configKey, list);
    vscode.window.showInformationMessage(`ProjectCycle: Added to ${label}: ${folderName}`);
}

function moveInList(configKey: 'priorityProjects' | 'allProjects', projectPath: string, direction: -1 | 1): void {
    const list = store.getProjects(configKey);
    const idx = list.indexOf(projectPath);
    if (idx === -1) { return; }
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) { return; }
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
    store.setProjects(configKey, list);
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

function getColoredFolderIcon(color: string | null, isOpen: boolean, storagePath: string): vscode.Uri {
    const iconDir = path.join(storagePath, 'icons');
    const colorKey = color ? color.replace('#', '') : 'none';
    const stateKey = isOpen ? 'open' : 'closed';
    const iconPath = path.join(iconDir, `dot_${colorKey}_${stateKey}.svg`);
    if (!fs.existsSync(iconPath)) {
        fs.mkdirSync(iconDir, { recursive: true });
        let svg: string;
        if (color && isOpen) {
            // filled colored circle
            const stroke = darkenHex(color, 0.3);
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
                `<circle cx="8" cy="8" r="5" fill="${color}" stroke="${stroke}" stroke-width="1.5"/>` +
                `</svg>`;
        } else if (!color && isOpen) {
            // filled grey circle
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
                `<circle cx="8" cy="8" r="5" fill="#555566" stroke="#333344" stroke-width="1.5"/>` +
                `</svg>`;
        } else if (color && !isOpen) {
            // hollow colored outline
            const stroke = darkenHex(color, 0.15);
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
                `<circle cx="8" cy="8" r="4.5" fill="none" stroke="${stroke}" stroke-width="1.5"/>` +
                `</svg>`;
        } else {
            // hollow grey outline
            svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
                `<circle cx="8" cy="8" r="4.5" fill="none" stroke="#555566" stroke-width="1.5"/>` +
                `</svg>`;
        }
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
        'titleBar.activeBackground':           hex,
        'titleBar.activeForeground':           fg,
        'titleBar.inactiveBackground':         dark,
        'titleBar.inactiveForeground':         fg + 'aa',
        'activityBar.background':              hex,
        'activityBar.activeBackground':        hex,
        'activityBar.activeBorder':            fg + '00',
        'activityBar.foreground':              fg,
        'activityBar.inactiveForeground':      fg + '88',
        'statusBar.background':                hex,
        'statusBar.foreground':                fg,
    }, vscode.ConfigurationTarget.Workspace);
}

async function removeProjectColor(): Promise<void> {
    const ours = [
        'titleBar.activeBackground', 'titleBar.activeForeground',
        'titleBar.inactiveBackground', 'titleBar.inactiveForeground',
        'activityBar.background', 'activityBar.activeBackground', 'activityBar.activeBorder',
        'activityBar.foreground', 'activityBar.inactiveForeground',
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

async function deleteFromList(configKey: 'priorityProjects' | 'allProjects', projectPath: string, label: string): Promise<void> {
    const folderName = path.basename(projectPath);
    const confirm = await vscode.window.showWarningMessage(
        `Remove "${folderName}" from ${label}?`,
        { modal: true },
        'Remove'
    );
    if (confirm !== 'Remove') { return; }
    store.setProjects(configKey, store.getProjects(configKey).filter(p => p !== projectPath));
    vscode.window.showInformationMessage(`ProjectCycle: Removed: ${folderName}`);
}

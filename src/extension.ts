import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

let openWindowNames: Set<string> = new Set();
let navHist: SharedNavHistory;
let store: ProjectStore;
// suspendedProjects is now persisted via ProjectStore.suspendProject/resumeProject

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

    setSeconds(projectPath: string, n: number): void {
        this.data[projectPath] = n;
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

type ColorMode = 'standard' | 'pulse' | 'aurora' | 'neon' | 'ember';

interface ProjectsData {
    priorityProjects: string[];
    allProjects: string[];
    projectColors: Record<string, string>;
    favorites: string[];
    suspendedProjects: string[];
    colorMode?: ColorMode;
    colorPhase?: number;
    colorLastTick?: number;
}

class ProjectStore {
    private data: ProjectsData = { priorityProjects: [], allProjects: [], projectColors: {}, favorites: [], suspendedProjects: [] };
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
                this.data = { priorityProjects: [], allProjects: [], projectColors: {}, favorites: [], suspendedProjects: [], ...parsed };
            }
        } catch { this.data = { priorityProjects: [], allProjects: [], projectColors: {}, favorites: [], suspendedProjects: [] }; }
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

    getFavorites(): string[] { return [...(this.data.favorites ?? [])]; }

    isFavorite(p: string): boolean { return (this.data.favorites ?? []).includes(p); }

    toggleFavorite(p: string): void {
        const favs = this.data.favorites ?? [];
        const idx = favs.indexOf(p);
        if (idx >= 0) { favs.splice(idx, 1); } else { favs.push(p); }
        this.data.favorites = favs;
        this.save();
    }

    getSuspended(): string[] { return [...(this.data.suspendedProjects ?? [])]; }
    isSuspended(p: string): boolean { return (this.data.suspendedProjects ?? []).includes(p); }
    suspendProject(p: string): void {
        const list = this.data.suspendedProjects ?? [];
        if (!list.includes(p)) { list.push(p); }
        this.data.suspendedProjects = list;
        this.save();
    }
    resumeProject(p: string): void {
        this.data.suspendedProjects = (this.data.suspendedProjects ?? []).filter(x => x !== p);
        this.save();
    }

    getColorMode(): ColorMode {
        const valid: string[] = ['standard', 'pulse', 'aurora', 'neon', 'ember'];
        const m = this.data.colorMode as string | undefined;
        return (m && valid.includes(m) ? m : 'standard') as ColorMode;
    }
    setColorMode(mode: ColorMode): void { this.data.colorMode = mode; this.save(); }
    getColorPhase(): number { return this.data.colorPhase ?? 0; }
    getColorLastTick(): number { return this.data.colorLastTick ?? 0; }
    saveColorPhase(phase: number, tickTime: number): void {
        // Reload from disk first so we never clobber project/color changes
        // made by other open VS Code windows between ticks.
        this.load();
        this.data.colorPhase = phase;
        this.data.colorLastTick = tickTime;
        this.save();
    }

    reload(): void { this.load(); }
}

// ---------------------------------------------------------------------------
// Shared Navigation History  (persisted to disk so all windows share it)
// ---------------------------------------------------------------------------

class SharedNavHistory {
    private readonly filePath: string;

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, 'nav-history.json');
    }

    push(projectPath: string): void {
        if (!projectPath) { return; }
        const history = this.read();
        if (history[history.length - 1] === projectPath) { return; }
        history.push(projectPath);
        if (history.length > 50) { history.shift(); }
        this.write(history);
    }

    pop(): string | undefined {
        const history = this.read();
        if (history.length === 0) { return undefined; }
        const last = history.pop()!;
        this.write(history);
        return last;
    }

    private read(): string[] {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
        } catch {}
        return [];
    }

    private write(history: string[]): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(history), 'utf8');
        } catch {}
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
        isSuspended: boolean = false,
    ) {
        super(path.basename(projectPath), vscode.TreeItemCollapsibleState.None);
        const suspendedSuffix = isSuspended ? '  💤' : '';
        this.description = timeStr ? `#${index + 1}  ${timeStr}${suspendedSuffix}` : `#${index + 1}${suspendedSuffix}`;
        this.tooltip = `${projectPath}\n${isSuspended ? '💤 Suspended — click to resume' : isOpen ? '● Open' : '○ Closed'}`;
        this.contextValue = isSuspended ? contextVal + 'Suspended' : (isOpen ? contextVal + 'Open' : contextVal);
        this.iconPath = isSuspended
            ? new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('list.deemphasizedForeground'))
            : (storagePath ? getColoredFolderIcon(color ?? null, isOpen, storagePath) : new vscode.ThemeIcon('folder'));
        this.command = {
            command: 'projectcycle.activateProject',
            title: isSuspended ? 'Resume & Focus' : (isOpen ? 'Focus Window' : 'Open Project'),
            arguments: [projectPath, isOpen],
        };
    }
}

class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private _cachedItems: ProjectItem[] = [];

    constructor(
        private readonly configKey: 'priorityProjects' | 'allProjects',
        private readonly contextVal: string,
        private readonly storagePath: string,
        private readonly tracker: TimeTracker,
        private readonly store: ProjectStore,
    ) {}

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getCurrentItem(projectPath: string): ProjectItem | undefined {
        return this._cachedItems.find(item => item.projectPath === projectPath);
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem { return element; }

    getChildren(): ProjectItem[] {
        let paths = this.store.getProjects(this.configKey);
        const colors = this.store.getColors();

        let items: ProjectItem[];
        if (this.configKey === 'allProjects') {
            const favSet = new Set(this.store.getFavorites());
            paths = [
                ...paths.filter(p => favSet.has(p)),
                ...paths.filter(p => !favSet.has(p)),
            ];
            items = paths.map((p, i) => {
                const timeStr = this.tracker.format(this.tracker.getSeconds(p));
                const ctxVal = favSet.has(p) ? 'allItemFavorite' : 'allItem';
                return new ProjectItem(p, i, ctxVal, colors[p], this.storagePath, isProjectOpen(p), timeStr, this.store.isSuspended(p));
            });
        } else {
            items = paths.map((p, i) => {
                const timeStr = this.tracker.format(this.tracker.getSeconds(p));
                return new ProjectItem(p, i, this.contextVal, colors[p], this.storagePath, isProjectOpen(p), timeStr, this.store.isSuspended(p));
            });
        }
        this._cachedItems = items;
        return items;
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
// Time input parser  ("2h 30m" | "90m" | "1h" | "45" | "1:30") → seconds
// ---------------------------------------------------------------------------

function parseTimeInput(input: string): number | null {
    const s = input.trim().toLowerCase();
    if (!s) { return null; }

    // h:mm  e.g. "1:30"
    const colonMatch = s.match(/^(\d+):(\d{1,2})$/);
    if (colonMatch) {
        const h = parseInt(colonMatch[1], 10);
        const m = parseInt(colonMatch[2], 10);
        if (m >= 60) { return null; }
        return (h * 3600) + (m * 60);
    }

    // mixed  e.g. "2h 30m", "1h30m", "2h", "30m", "30min"
    const mixedMatch = s.match(/^(?:(\d+)\s*h(?:r|rs|our|ours)?)?\s*(?:(\d+)\s*m(?:in|ins|inutes?)?)?$/);
    if (mixedMatch && (mixedMatch[1] || mixedMatch[2])) {
        const h = parseInt(mixedMatch[1] ?? '0', 10);
        const m = parseInt(mixedMatch[2] ?? '0', 10);
        return (h * 3600) + (m * 60);
    }

    // bare number → minutes
    const numMatch = s.match(/^(\d+)$/);
    if (numMatch) {
        return parseInt(numMatch[1], 10) * 60;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    ensureCycleAllKeybinding(context);

    const storagePath = context.globalStorageUri.fsPath;
    store = new ProjectStore(storagePath);
    const tracker = new TimeTracker(storagePath);
    navHist = new SharedNavHistory(storagePath);
    const currentProject = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const COLOR_MODES: ColorMode[] = ['standard', 'pulse', 'aurora', 'neon', 'ember'];
    const MODE_LABELS: Record<ColorMode, string> = {
        'standard': 'Standard',
        'pulse':    'Pulse',
        'aurora':   'Aurora',
        'neon':     'Neon',
        'ember':    'Ember',
    };

    // Per-window color mode stored in workspaceState — each window has its own mode
    // independently of other open windows. Falls back to 'standard' if not set.
    const validModes: ColorMode[] = ['standard', 'pulse', 'aurora', 'neon', 'ember'];
    const savedWindowMode = context.workspaceState.get<string>('colorMode', 'standard');
    let activeColorMode: ColorMode = validModes.includes(savedWindowMode as ColorMode)
        ? savedWindowMode as ColorMode : 'standard';

    // Freeze toggle — pauses animation at the current color state
    let colorFrozen = context.workspaceState.get<boolean>('colorFrozen', false);

    // Restore phase; only advance for elapsed time if animation is NOT frozen
    let colorPhase = store.getColorPhase();
    const savedTick = store.getColorLastTick();
    if (savedTick > 0 && !colorFrozen) {
        colorPhase = (colorPhase + (Date.now() - savedTick) / (5 * 60_000)) % 1;
    }

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

    function revealCurrentProject(): void {
        if (!currentProject) { return; }
        setTimeout(() => {
            try {
                const pi = priorityProvider.getCurrentItem(currentProject!);
                if (pi && priorityView.visible) { priorityView.reveal(pi, { select: true, focus: false }); }
            } catch { /* view not ready */ }
            try {
                const ai = allProvider.getCurrentItem(currentProject!);
                if (ai && allView.visible) { allView.reveal(ai, { select: true, focus: false }); }
            } catch { /* view not ready */ }
        }, 100);
    }

    // Re-reveal whenever the sidebar panel becomes visible
    context.subscriptions.push(
        priorityView.onDidChangeVisibility(e => { if (e.visible) { revealCurrentProject(); } }),
        allView.onDidChangeVisibility(e => { if (e.visible) { revealCurrentProject(); } }),
    );

    // Patch refresh so the highlight is restored after every data update
    const _origPriorityRefresh = priorityProvider.refresh.bind(priorityProvider);
    priorityProvider.refresh = () => { _origPriorityRefresh(); revealCurrentProject(); };
    const _origAllRefresh = allProvider.refresh.bind(allProvider);
    allProvider.refresh = () => { _origAllRefresh(); revealCurrentProject(); };

    // Auto-register this window's workspace into allProjects on startup
    if (currentProject) {
        const allList = store.getProjects('allProjects');
        if (!allList.includes(currentProject)) {
            allList.push(currentProject);
            store.setProjects('allProjects', allList);
            allProvider.refresh(); // patched — also calls revealCurrentProject()
        } else {
            revealCurrentProject();
        }
        // Apply this project's color to workbench on startup
        const startupColor = store.getColors()[currentProject];
        if (startupColor) {
            applyAnimatedProjectColor(startupColor, activeColorMode, colorPhase);
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

        // PID prototype — diagnostic command, not for production use
        vscode.commands.registerCommand('projectcycle.probeWindowMap', () => {
            const out = vscode.window.createOutputChannel('ProjectCycle · Window Map');
            out.show(true);
            out.appendLine('══════════════════════════════════════════════════════');
            out.appendLine(' ProjectCycle Window → Folder Map — ' + new Date().toLocaleTimeString());
            out.appendLine('══════════════════════════════════════════════════════\n');

            const priorityPaths = store.getProjects('priorityProjects');

            try {
                const logBase = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'logs');
                const sessions = fs.readdirSync(logBase)
                    .filter((s: string) => /^\d{8}T\d{6}$/.test(s)).sort().reverse();

                let sessionDir: string | null = null;
                for (const session of sessions) {
                    const sDir = path.join(logBase, session);
                    try {
                        if (fs.readdirSync(sDir).some((f: string) => /^window\d+$/.test(f))) {
                            sessionDir = sDir; break;
                        }
                    } catch {}
                }

                if (!sessionDir) { out.appendLine('No active session with windows found.'); return; }
                out.appendLine(`Session: ${path.basename(sessionDir)}\n`);

                const windows = fs.readdirSync(sessionDir)
                    .filter((w: string) => /^window\d+$/.test(w))
                    .sort((a: string, b: string) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));

                for (const win of windows) {
                    const gitLog = path.join(sessionDir, win, 'exthost', 'vscode.git', 'Git.log');
                    const rendererLog = path.join(sessionDir, win, 'renderer.log');

                    let folder = '(unknown — no git log)';
                    try {
                        const matches = fs.readFileSync(gitLog, 'utf8').match(/\/Users\/[^\s"]+/g);
                        const hit = matches?.find((m: string) => !m.includes('.app') && !m.includes('vscode'));
                        if (hit) { folder = hit; }
                    } catch {}

                    let extHostPid = '?';
                    let extAlive = false;
                    try {
                        const rlContent = fs.readFileSync(rendererLog, 'utf8');
                        const pidMatches = [...rlContent.matchAll(/Started local extension host with pid (\d+)/g)];
                        if (pidMatches.length > 0) {
                            const pid = parseInt(pidMatches[pidMatches.length - 1][1], 10);
                            extHostPid = String(pid);
                            try { process.kill(pid, 0); extAlive = true; } catch {}
                        }
                    } catch {}

                    const inPriority = priorityPaths.includes(folder) ? ' ★ PRIORITY' : '';
                    const suspended = store.isSuspended(folder) ? ' 💤 SUSPENDED' : '';
                    const alive = extAlive ? '[alive]' : '[dead]';
                    out.appendLine(`${win}: ext=${extHostPid} ${alive}${inPriority}${suspended}`);
                    out.appendLine(`  → ${folder}`);
                }
            } catch (e) { out.appendLine(`Error: ${e}`); }

            out.appendLine('\n══════════════════════════════════════════════════════');
        }),

        vscode.commands.registerCommand('projectcycle.prototypePids', () => {
            const out = vscode.window.createOutputChannel('ProjectCycle · PID Probe');
            out.show(true);
            out.appendLine('══════════════════════════════════════════════════════');
            out.appendLine(' ProjectCycle PID Prototype — ' + new Date().toLocaleTimeString());
            out.appendLine('══════════════════════════════════════════════════════\n');

            // ── 1. All VS Code-related processes ─────────────────────────────
            out.appendLine('── 1. All VS Code processes (ps -ax -o pid,command) ──');
            try {
                const psAll = execSync(
                    'ps -ax -o pid=,command= | grep -i "visual studio code\\|/Code.app\\|Code Helper" | grep -v grep',
                    { timeout: 8000 }
                ).toString().trim();
                out.appendLine(psAll || '(none found)');
            } catch { out.appendLine('(ps query failed)'); }

            // ── 2. Renderer processes only ────────────────────────────────────
            out.appendLine('\n── 2. Renderer processes only ──');
            let rendererPids: number[] = [];
            try {
                const psRaw = execSync(
                    'ps -ax -o pid=,command= | grep -i "Code Helper (Renderer)" | grep -v grep',
                    { timeout: 8000 }
                ).toString().trim();
                out.appendLine(psRaw || '(none found)');

                // Parse out PIDs for later use
                rendererPids = psRaw.split('\n')
                    .map(line => parseInt(line.trim().split(/\s+/)[0], 10))
                    .filter(n => !isNaN(n));
            } catch { out.appendLine('(renderer query failed)'); }

            // ── 3. Try to find --folder-uri in renderer args ──────────────────
            out.appendLine('\n── 3. folder-uri / folder-path args in renderer processes ──');
            try {
                const uriHits = execSync(
                    'ps -ax -o pid=,command= | grep -i "Code Helper (Renderer)" | grep -o "folder[^ ]*" | grep -v grep',
                    { timeout: 8000 }
                ).toString().trim();
                out.appendLine(uriHits || '(no folder args found in renderer command lines)');
            } catch { out.appendLine('(folder-uri scan failed)'); }

            // ── 4. Full args of each renderer PID ────────────────────────────
            out.appendLine('\n── 4. Full command line per renderer PID ──');
            for (const pid of rendererPids.slice(0, 20)) {
                try {
                    // ps -p <pid> -o command= on macOS gives the full args
                    const cmd = execSync(`ps -p ${pid} -o command=`, { timeout: 3000 }).toString().trim();
                    out.appendLine(`\nPID ${pid}:`);
                    // Print each arg on its own line for readability
                    cmd.split(' --').forEach((part, i) => {
                        out.appendLine(`  ${i === 0 ? '' : '--'}${part}`);
                    });
                } catch { out.appendLine(`PID ${pid}: (could not read)`); }
            }

            // ── 5. lsof: which renderer has which project folder open ─────────
            out.appendLine('\n── 5. lsof match: renderer PID → known project paths ──');
            const knownPaths = store.getProjects('allProjects');
            if (knownPaths.length === 0) {
                out.appendLine('(no projects in allProjects list)');
            } else {
                for (const pid of rendererPids.slice(0, 20)) {
                    try {
                        const lsofOut = execSync(`lsof -p ${pid} 2>/dev/null`, { timeout: 5000 }).toString();
                        const matches: string[] = [];
                        for (const p of knownPaths) {
                            if (lsofOut.includes(p)) { matches.push(p); }
                        }
                        if (matches.length > 0) {
                            out.appendLine(`PID ${pid} → ${matches.join(', ')}`);
                        }
                    } catch { /* lsof may fail on some pids, skip */ }
                }
                out.appendLine('(done — PIDs with no match omitted)');
            }

            // ── 6. Current window's own PID for reference ─────────────────────
            out.appendLine(`\n── 6. This window's PID: ${process.pid} ──`);
            out.appendLine(`     Workspace: ${currentProject ?? '(none)'}`);

            out.appendLine('\n══════════════════════════════════════════════════════');
            out.appendLine(' Done. Review sections above to see what\'s reliable.');
            out.appendLine('══════════════════════════════════════════════════════');
        }),

        // Priority section
        vscode.commands.registerCommand('projectcycle.addCurrent', () => {
            addCurrentTo('priorityProjects', 'priority');
            priorityProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.refreshPriorityView', () => {
            store.reload();
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
            store.reload();
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

        vscode.commands.registerCommand('projectcycle.addFavorite', (item: ProjectItem) => {
            store.toggleFavorite(item.projectPath);
            allProvider.refresh();
        }),
        vscode.commands.registerCommand('projectcycle.removeFavorite', (item: ProjectItem) => {
            store.toggleFavorite(item.projectPath);
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
            // Auto-resume suspended projects when the user explicitly clicks on them
            if (store.isSuspended(projectPath)) {
                resumeProjectProcesses(projectPath);
                store.resumeProject(projectPath);
                priorityProvider.refresh();
                allProvider.refresh();
            }
            if (isOpen) {
                if (focusWindow(path.basename(projectPath))) {
                    navHist.push(currentFolder ?? '');
                }
            } else {
                navHist.push(currentFolder ?? '');
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), { forceNewWindow: true });
            }
        }),

        vscode.commands.registerCommand('projectcycle.goBack', () => {
            const prev = navHist.pop();
            if (!prev) {
                vscode.window.showInformationMessage('ProjectCycle: No previous window in history.');
                return;
            }
            focusWindow(path.basename(prev));
        }),

        vscode.commands.registerCommand('projectcycle.closeProjectWindow', (item: ProjectItem) => {
            closeWindow(path.basename(item.projectPath));
            setTimeout(() => {
                openWindowNames = queryOpenWindowNames();
                priorityProvider.refresh();
                allProvider.refresh();
            }, 600);
        }),

        vscode.commands.registerCommand('projectcycle.cycleColorMode', async () => {
            const next = COLOR_MODES[(COLOR_MODES.indexOf(activeColorMode) + 1) % COLOR_MODES.length];
            activeColorMode = next;
            context.workspaceState.update('colorMode', next);
            if (currentProject) {
                const color = store.getColors()[currentProject];
                if (color) { await applyAnimatedProjectColor(color, next, colorPhase); }
            }
            vscode.window.showInformationMessage(`Color Mode: ${MODE_LABELS[next]}`);
        }),

        vscode.commands.registerCommand('projectcycle.toggleColorFreeze', async () => {
            colorFrozen = !colorFrozen;
            context.workspaceState.update('colorFrozen', colorFrozen);
            vscode.window.showInformationMessage(colorFrozen
                ? '$(pin) Color animation frozen — current state locked'
                : '$(pin) Color animation resumed');
        }),

        vscode.commands.registerCommand('projectcycle.tickColor', async () => {
            if (!currentProject || activeColorMode === 'standard') { return; }
            const color = store.getColors()[currentProject];
            if (!color) { return; }
            colorPhase = (colorPhase + COLOR_TICK_MS / COLOR_CYCLE_MS) % 1;
            store.saveColorPhase(colorPhase, Date.now());
            await applyAnimatedProjectColor(color, activeColorMode, colorPhase);
        }),

        vscode.commands.registerCommand('projectcycle.closeAllPriority', async () => {
            const paths = store.getProjects('priorityProjects');
            if (paths.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No priority projects configured.');
                return;
            }
            openWindowNames = queryOpenWindowNames();
            const open = paths.filter(p => isProjectOpen(p) && p !== currentProject);
            if (open.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No other priority project windows are open.');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(
                `Close ${open.length} priority project window${open.length > 1 ? 's' : ''}?`,
                { modal: true },
                'Close All'
            );
            if (confirm !== 'Close All') { return; }
            for (const p of open) {
                closeWindow(path.basename(p));
                await new Promise<void>(r => setTimeout(r, 300));
            }
            setTimeout(() => {
                openWindowNames = queryOpenWindowNames();
                priorityProvider.refresh();
                allProvider.refresh();
            }, 800);
        }),

        vscode.commands.registerCommand('projectcycle.openAllPriority', async () => {
            const paths = store.getProjects('priorityProjects');
            if (paths.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No priority projects configured.');
                return;
            }
            openWindowNames = queryOpenWindowNames();

            const items = paths.map(p => {
                const isOpen = isProjectOpen(p);
                const isSusp = store.isSuspended(p);
                const status = isSusp ? '💤 Suspended' : isOpen ? '● Open' : '○ Closed';
                return {
                    label: path.basename(p),
                    description: status,
                    detail: p,
                    picked: !isOpen && !isSusp, // pre-select only closed non-suspended ones
                    projectPath: p,
                    isOpen,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                title: 'Select projects to open',
                placeHolder: 'Check projects to open → press Enter',
            });
            if (!selected || selected.length === 0) { return; }

            const toOpen = selected.filter(s => !s.isOpen);
            const toFocus = selected.filter(s => s.isOpen);

            if (toOpen.length > 0) {
                vscode.window.showInformationMessage(
                    `ProjectCycle: Opening ${toOpen.length} project${toOpen.length > 1 ? 's' : ''}…`
                );
                for (const s of toOpen) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.projectPath), { forceNewWindow: true });
                    await new Promise<void>(r => setTimeout(r, 400));
                }
            }
            for (const s of toFocus) {
                focusWindow(path.basename(s.projectPath));
                await new Promise<void>(r => setTimeout(r, 150));
            }
        }),

        vscode.commands.registerCommand('projectcycle.suspendAllPriority', async () => {
            const paths = store.getProjects('priorityProjects');
            if (paths.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No priority projects configured.');
                return;
            }
            openWindowNames = queryOpenWindowNames();

            const items = paths
                .filter(p => p !== currentProject)
                .map(p => {
                    const isOpen = isProjectOpen(p);
                    const isSusp = store.isSuspended(p);
                    const status = isSusp ? '💤 Already suspended' : isOpen ? '● Open' : '○ Closed (no window)';
                    return {
                        label: path.basename(p),
                        description: status,
                        detail: p,
                        picked: isOpen && !isSusp, // pre-select open, non-suspended ones
                        projectPath: p,
                        isSusp,
                    };
                });

            if (items.length === 0) {
                vscode.window.showInformationMessage('ProjectCycle: No other priority projects to suspend.');
                return;
            }

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                title: 'Select projects to suspend',
                placeHolder: 'Check projects to pause their language servers → press Enter',
            });
            if (!selected || selected.length === 0) { return; }

            let suspended = 0;
            for (const s of selected) {
                if (s.isSusp) { continue; } // already suspended, skip
                const ok = suspendProjectProcesses(s.projectPath);
                if (ok) {
                    store.suspendProject(s.projectPath);
                    suspended++;
                }
            }
            priorityProvider.refresh();
            allProvider.refresh();
            if (suspended > 0) {
                vscode.window.showInformationMessage(
                    `ProjectCycle: Suspended ${suspended} project${suspended > 1 ? 's' : ''}. Check Activity Monitor — language servers are now paused.`
                );
            }
        }),

        vscode.commands.registerCommand('projectcycle.suspendProject', async (item: ProjectItem) => {
            const folderPath = item.projectPath;
            if (folderPath === currentProject) {
                vscode.window.showWarningMessage('ProjectCycle: Cannot suspend the current window.');
                return;
            }
            const ok = suspendProjectProcesses(folderPath);
            if (ok) {
                store.suspendProject(folderPath);
                vscode.window.showInformationMessage(`ProjectCycle: 💤 Suspended: ${path.basename(folderPath)}`);
            } else {
                vscode.window.showWarningMessage(`ProjectCycle: Could not suspend ${path.basename(folderPath)} — is it open with a git repo?`);
            }
            priorityProvider.refresh();
            allProvider.refresh();
        }),

        vscode.commands.registerCommand('projectcycle.resumeProject', async (item: ProjectItem) => {
            const folderPath = item.projectPath;
            resumeProjectProcesses(folderPath);
            store.resumeProject(folderPath);
            vscode.window.showInformationMessage(`ProjectCycle: ▶ Resumed: ${path.basename(folderPath)}`);
            priorityProvider.refresh();
            allProvider.refresh();
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
                    applyAnimatedProjectColor(a.hex, activeColorMode, colorPhase);
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
            if (isActiveProject) { await applyAnimatedProjectColor(finalHex, activeColorMode, colorPhase); }
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
            const setTimeItem: MenuItem = { label: '$(edit) Set Time', description: `Manually set tracked time for ${projectName}`, action: 'setTime' };
            const items: MenuItem[] = timerStopped
                ? [
                    { label: '$(play) Continue', description: `Resume timing for ${projectName}`, action: 'continue' },
                    setTimeItem,
                    { label: '$(trash) Reset', description: `Clear all tracked time for ${projectName} (${timeStr})`, action: 'reset' },
                ]
                : [
                    { label: '$(debug-pause) Stop Timing', description: `Pause timer for ${projectName}`, action: 'stop' },
                    setTimeItem,
                    { label: '$(trash) Reset', description: `Clear all tracked time for ${projectName} (${timeStr})`, action: 'reset' },
                ];

            items.push(
                { label: '', kind: vscode.QuickPickItemKind.Separator } as MenuItem,
                { label: `$(symbol-event) Color Mode: ${MODE_LABELS[activeColorMode]}`, description: 'Click to cycle to next mode', action: 'cycleColor' },
            );

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
            } else if (picked.action === 'cycleColor') {
                const next = COLOR_MODES[(COLOR_MODES.indexOf(activeColorMode) + 1) % COLOR_MODES.length];
                activeColorMode = next;
                context.workspaceState.update('colorMode', next);
                const color = store.getColors()[currentProject];
                if (color) { await applyAnimatedProjectColor(color, next, colorPhase); }
                vscode.window.showInformationMessage(`Color Mode: ${MODE_LABELS[next]}`);
            } else if (picked.action === 'setTime') {
                const input = await vscode.window.showInputBox({
                    title: `Set Time — ${projectName}`,
                    prompt: `Current: ${timeStr}. Enter new time (e.g. "2h 30m", "90m", "1h", "45", "1:30")`,
                    placeHolder: '2h 30m',
                    validateInput: (v) => parseTimeInput(v) === null
                        ? 'Invalid format. Use e.g. "2h 30m", "90m", "1h", "45" (minutes), or "1:30" (h:mm).'
                        : undefined,
                });
                if (input !== undefined) {
                    const secs = parseTimeInput(input);
                    if (secs !== null) {
                        tracker.setSeconds(currentProject, secs);
                        refreshTree();
                    }
                }
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
    // Only runs while this window is focused — prevents background accumulation.
    const terminalHeartbeat = setInterval(() => {
        if (!currentProject || timerStopped || activeTerminalExecutions === 0) { return; }
        if (!vscode.window.state.focused) { return; }
        lastActivityTime = Date.now();
        updateStatusBar();
    }, 30_000);

    const timer = setInterval(() => {
        if (!currentProject || timerStopped) { return; }
        // Only count time when this window is focused. Without this guard, a
        // running terminal process would accumulate time in the background while
        // the user works in other VS Code windows.
        if (!vscode.window.state.focused) { return; }
        const recentEditorActivity = lastActivityTime !== null && Date.now() - lastActivityTime < ACTIVE_WINDOW_MS;
        const terminalSessionRunning = activeTerminalExecutions > 0;
        if (recentEditorActivity || terminalSessionRunning) {
            tracker.addSeconds(currentProject, 60);
            refreshTree();
        }
        updateStatusBar();
    }, 60_000);

    // Color animation tick — advances phase and repaints when not in Standard mode
    const COLOR_TICK_MS  = 30_000;
    const COLOR_CYCLE_MS = 5 * 60_000;  // full cycle = 5 minutes

    const colorTick = setInterval(() => {
        if (!currentProject || activeColorMode === 'standard' || colorFrozen) { return; }
        const color = store.getColors()[currentProject];
        if (!color) { return; }
        colorPhase = (colorPhase + COLOR_TICK_MS / COLOR_CYCLE_MS) % 1;
        store.saveColorPhase(colorPhase, Date.now());
        applyAnimatedProjectColor(color, activeColorMode, colorPhase).catch(() => {});
    }, COLOR_TICK_MS);

    // Sync data from other windows whenever this window gains focus
    context.subscriptions.push(
        { dispose: () => clearInterval(terminalHeartbeat) },
        { dispose: () => clearInterval(timer) },
        { dispose: () => clearInterval(colorTick) },
        vscode.window.onDidChangeWindowState(e => {
            if (!e.focused) { return; }
            store.reload();
            tracker.reload();
            openWindowNames = queryOpenWindowNames();
            refreshTree(); // patched — also calls revealCurrentProject()
        }),
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

function closeWindow(folderName: string): void {
    const safe = folderName.replace(/"/g, '\\"');
    const script = [
        'tell application "System Events"',
        '    tell process "Code"',
        `        repeat with w in (every window)`,
        `            if name of w contains "${safe}" then`,
        '                perform action "AXPress" of button 1 of w',
        '                exit repeat',
        '            end if',
        '        end repeat',
        '    end tell',
        'end tell',
    ].join('\n');
    try {
        execSync(`osascript -e '${script}'`, { timeout: 5000 });
    } catch {}
}

// ---------------------------------------------------------------------------
// Process suspend / resume helpers
// ---------------------------------------------------------------------------

/** Find the NodeService (extension host) PID for a project by scanning VS Code log directories. */
function findExtHostPidForProject(folderPath: string): number | null {
    try {
        const logBase = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'logs');
        const sessions = fs.readdirSync(logBase)
            .filter(s => /^\d{8}T\d{6}$/.test(s))
            .sort()
            .reverse();

        for (const session of sessions) {
            const sDir = path.join(logBase, session);
            let dirs: string[];
            try { dirs = fs.readdirSync(sDir); } catch { continue; }
            const windows = dirs
                .filter(w => /^window\d+$/.test(w))
                .sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));

            if (windows.length === 0) { continue; }

            for (const win of windows) {
                // Git.log contains the project folder path (for git repos)
                const gitLog = path.join(sDir, win, 'exthost', 'vscode.git', 'Git.log');
                try {
                    if (!fs.readFileSync(gitLog, 'utf8').includes(folderPath)) { continue; }
                } catch { continue; }

                // renderer.log records "Started local extension host with pid N"
                const rendererLog = path.join(sDir, win, 'renderer.log');
                try {
                    const rlContent = fs.readFileSync(rendererLog, 'utf8');
                    const pidMatches = [...rlContent.matchAll(/Started local extension host with pid (\d+)/g)];
                    if (pidMatches.length === 0) { continue; }
                    const pid = parseInt(pidMatches[pidMatches.length - 1][1], 10);
                    try { process.kill(pid, 0); return pid; } catch { continue; } // verify alive
                } catch { continue; }
            }

            if (windows.length > 0) { break; } // only check the session that has windows
        }
    } catch {}
    return null;
}

/** SIGSTOP the language-server child processes of the given project's extension host. */
function suspendProjectProcesses(folderPath: string): boolean {
    const extHostPid = findExtHostPidForProject(folderPath);
    if (!extHostPid) { return false; }
    try {
        const childPids = execSync(`pgrep -P ${extHostPid}`, { timeout: 3000 })
            .toString().trim().split('\n')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);
        for (const childPid of childPids) {
            try { process.kill(childPid, 'SIGSTOP'); } catch {}
        }
        return childPids.length > 0;
    } catch { return false; }
}

/** SIGCONT the language-server child processes of the given project's extension host. */
function resumeProjectProcesses(folderPath: string): void {
    const extHostPid = findExtHostPidForProject(folderPath);
    if (!extHostPid) { return; }
    try {
        const childPids = execSync(`pgrep -P ${extHostPid}`, { timeout: 3000 })
            .toString().trim().split('\n')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);
        for (const childPid of childPids) {
            try { process.kill(childPid, 'SIGCONT'); } catch {}
        }
    } catch {}
}

function cycleList(configKey: 'priorityProjects' | 'allProjects', emptyMsg: string, noneOpenMsg: string): void {
    store.reload(); // pick up suspensions/resumes made by other windows
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
        if (store.isSuspended(paths[idx])) { continue; } // skip sleeping projects
        if (focusWindow(path.basename(paths[idx]))) {
            navHist.push(currentFolder);
            return;
        }
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

function lightenHex(hex: string, amount: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 0xff) + (255 - ((n >> 16) & 0xff)) * amount));
    const g = Math.min(255, Math.round(((n >> 8)  & 0xff) + (255 - ((n >> 8)  & 0xff)) * amount));
    const b = Math.min(255, Math.round((n & 0xff)          + (255 - (n & 0xff))          * amount));
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

function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, b = (n & 0xff) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) { return { h: 0, s: 0, l }; }
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    switch (max) {
        case r:  h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g:  h = ((b - r) / d + 2) / 6; break;
        default: h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t: number) => {
        t = ((t % 1) + 1) % 1;
        if (t < 1/6) { return p + (q - p) * 6 * t; }
        if (t < 1/2) { return q; }
        if (t < 2/3) { return p + (q - p) * (2/3 - t) * 6; }
        return p;
    };
    const r = Math.round(f(h + 1/3) * 255), g = Math.round(f(h) * 255), b = Math.round(f(h - 1/3) * 255);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function blendHex(hex1: string, hex2: string, t: number): string {
    const n1 = parseInt(hex1.replace('#', ''), 16), n2 = parseInt(hex2.replace('#', ''), 16);
    const r = Math.round(((n1 >> 16) & 0xff) * (1-t) + ((n2 >> 16) & 0xff) * t);
    const g = Math.round(((n1 >> 8)  & 0xff) * (1-t) + ((n2 >> 8)  & 0xff) * t);
    const b = Math.round((n1 & 0xff)          * (1-t) + (n2 & 0xff)          * t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

async function applyAnimatedProjectColor(baseHex: string, mode: ColorMode, phase: number): Promise<void> {
    const sin = Math.sin(phase * 2 * Math.PI);
    const t   = (1 + sin) / 2;   // 0..1 smooth oscillation
    const { h, s, l } = hexToHsl(baseHex);

    switch (mode) {
        // Pulse — dramatic brightness swing dark→bright→dark
        case 'pulse': {
            const titleL  = 0.15 + 0.70 * t;          // swings 0.15 → 0.85
            const statusL = 0.05 + 0.50 * t;          // swings 0.05 → 0.55
            return applyProjectColor(baseHex,
                hslToHex(h, s, titleL),
                hslToHex(h, s, l),
                hslToHex(h, s, statusL),
            );
        }

        // Aurora — big hue sweep ±60° so you clearly see it shift
        case 'aurora': {
            const hDrift  = 60 * sin;                  // hue ±60°
            const borderL = 0.50 + 0.40 * t;
            return applyProjectColor(baseHex,
                hslToHex(h + hDrift,       s,  Math.min(0.85, l + 0.30)),
                hslToHex(h + hDrift * 0.5, s,  l),
                hslToHex(h - hDrift,       s,  Math.max(0.05, l - 0.20)),
                hslToHex(h + hDrift,       1,  borderL),
            );
        }

        // Neon — saturation swings 0→1 so color goes grey→vivid
        case 'neon': {
            const sPulse  = t;                          // saturation 0 → 1
            const lGlow   = 0.20 + 0.60 * t;
            return applyProjectColor(baseHex,
                hslToHex(h, sPulse, lGlow),
                hslToHex(h, sPulse, l),
                hslToHex(h, sPulse, Math.max(0.05, l - 0.15)),
                hslToHex(h, 1,      0.30 + 0.60 * t),
            );
        }

        // Ember — hue swings ±40° warm↔cool so it's obviously visible
        case 'ember': {
            const hSwing  = 40 * sin;                  // warm ↔ cool ±40°
            const lFlick  = 0.10 + 0.70 * t;
            return applyProjectColor(baseHex,
                hslToHex(h + hSwing,       s,                          lFlick),
                hslToHex(h + hSwing * 0.5, Math.min(1, s + 0.30 * t), l),
                hslToHex(h - hSwing,       s,                          Math.max(0.05, l - 0.20)),
            );
        }

        default: {
            return applyProjectColor(baseHex,
                lightenHex(baseHex, 0.38),
                baseHex,
                darkenHex(baseHex, 0.15),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Syntax theme — derives a full token + semantic palette from the project hue
// ---------------------------------------------------------------------------

function buildSyntaxPalette(titleHex: string, actHex: string, statusHex: string) {
    const { h: hT } = hexToHsl(titleHex);   // top edge   → keywords, types, classes
    const { h: hA } = hexToHsl(actHex);     // left edge  → functions, methods, namespaces
    const { h: hS } = hexToHsl(statusHex);  // bottom edge → strings, numbers, constants
    const S = 0.80;
    return {
        // ── Title color group (top edge) ──────────────────────────────────────
        keyword:   hslToHex(hT,       S,        0.68), // keywords, control flow, storage
        type:      hslToHex(hT + 35,  S,        0.70), // types, classes, structs
        tag:       hslToHex(hT + 20,  S,        0.68), // HTML/JSX tags
        // ── Activity color group (left edge) ─────────────────────────────────
        func:      hslToHex(hA,       S,        0.72), // functions, methods
        namespace: hslToHex(hA + 35,  S * 0.85, 0.67), // namespaces, modules, imports
        attribute: hslToHex(hA + 60,  S * 0.80, 0.68), // HTML/JSX attributes, decorators
        property:  hslToHex(hA - 30,  S * 0.80, 0.67), // object properties, members
        // ── Status color group (bottom edge) ─────────────────────────────────
        string:    hslToHex(hS,       S,        0.68), // string literals
        number:    hslToHex(hS + 35,  S,        0.70), // numbers, booleans, null
        constant:  hslToHex(hS + 65,  S * 0.75, 0.72), // named constants, enum members
        regexp:    hslToHex(hS - 30,  S,        0.72), // regex literals
        // ── Neutrals (muted, derived from title hue) ──────────────────────────
        variable:  hslToHex(hT,       0.15,     0.87), // variables — near-white faint tint
        parameter: hslToHex(hT,       0.22,     0.80), // parameters — slightly more tinted
        comment:   hslToHex(hT,       0.18,     0.43), // comments — muted dark
        operator:  hslToHex(hT,       0.10,     0.62), // operators, punctuation — mid-grey
    };
}

async function applySyntaxTheme(titleHex: string, actHex: string, statusHex: string): Promise<void> {
    const p = buildSyntaxPalette(titleHex, actHex, statusHex);
    const cfg = vscode.workspace.getConfiguration();

    // ── TextMate token colors (grammar-based, works in all languages) ────────
    await cfg.update('editor.tokenColorCustomizations', {
        textMateRules: [
            // Keywords & control flow
            {
                scope: ['keyword', 'keyword.control', 'keyword.control.flow',
                        'storage.type', 'storage.modifier', 'keyword.declaration'],
                settings: { foreground: p.keyword },
            },
            // Functions
            {
                scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
                settings: { foreground: p.func },
            },
            // Types & classes
            {
                scope: ['entity.name.type', 'entity.name.class', 'entity.other.inherited-class',
                        'support.class', 'entity.name.struct'],
                settings: { foreground: p.type },
            },
            // Properties & members
            {
                scope: ['variable.other.property', 'variable.other.object.property',
                        'support.variable.property', 'meta.property-name'],
                settings: { foreground: p.property },
            },
            // Strings
            {
                scope: ['string', 'string.quoted', 'string.template'],
                settings: { foreground: p.string },
            },
            // Numbers, booleans, null/undefined
            {
                scope: ['constant.numeric', 'constant.language.boolean',
                        'constant.language.null', 'constant.language.undefined'],
                settings: { foreground: p.number },
            },
            // Named constants
            {
                scope: ['constant.other', 'variable.other.constant'],
                settings: { foreground: p.constant },
            },
            // Namespaces, modules, imports
            {
                scope: ['entity.name.namespace', 'entity.name.module',
                        'keyword.control.import', 'keyword.control.from', 'keyword.control.export'],
                settings: { foreground: p.namespace },
            },
            // Variables
            {
                scope: ['variable', 'variable.other', 'variable.other.readwrite'],
                settings: { foreground: p.variable },
            },
            // Parameters
            {
                scope: ['variable.parameter', 'meta.parameter'],
                settings: { foreground: p.parameter, fontStyle: 'italic' },
            },
            // Comments
            {
                scope: ['comment', 'comment.line', 'comment.block', 'punctuation.definition.comment'],
                settings: { foreground: p.comment, fontStyle: 'italic' },
            },
            // Operators & punctuation
            {
                scope: ['keyword.operator', 'punctuation.separator', 'punctuation.terminator'],
                settings: { foreground: p.operator },
            },
            // HTML/JSX tags
            {
                scope: ['entity.name.tag', 'meta.tag.sgml'],
                settings: { foreground: p.tag },
            },
            // HTML/JSX attributes
            {
                scope: ['entity.other.attribute-name'],
                settings: { foreground: p.attribute },
            },
            // Regex
            {
                scope: ['string.regexp', 'constant.regexp'],
                settings: { foreground: p.regexp },
            },
        ],
    }, vscode.ConfigurationTarget.Workspace);

    // ── Semantic token colors (LSP-aware — smarter than TextMate) ────────────
    await cfg.update('editor.semanticTokenColorCustomizations', {
        enabled: true,
        rules: {
            'keyword':                { foreground: p.keyword },
            'function':               { foreground: p.func },
            'function.declaration':   { foreground: p.func, bold: true },
            'method':                 { foreground: p.func },
            'method.declaration':     { foreground: p.func, bold: true },
            'class':                  { foreground: p.type },
            'class.declaration':      { foreground: p.type, bold: true },
            'interface':              { foreground: p.type, italic: true },
            'type':                   { foreground: p.type },
            'typeParameter':          { foreground: p.type, italic: true },
            'property':               { foreground: p.property },
            'property.declaration':   { foreground: p.property },
            'variable':               { foreground: p.variable },
            'variable.declaration':   { foreground: p.variable },
            'parameter':              { foreground: p.parameter, italic: true },
            'namespace':              { foreground: p.namespace },
            'module':                 { foreground: p.namespace },
            'string':                 { foreground: p.string },
            'number':                 { foreground: p.number },
            'regexp':                 { foreground: p.regexp },
            'operator':               { foreground: p.operator },
            'comment':                { foreground: p.comment, italic: true },
            'macro':                  { foreground: p.constant },
            'enumMember':             { foreground: p.constant },
            'enum':                   { foreground: p.type },
            'decorator':              { foreground: p.namespace, italic: true },
            'annotation':             { foreground: p.namespace, italic: true },
            'label':                  { foreground: p.keyword },
        },
    }, vscode.ConfigurationTarget.Workspace);
}

async function removeSyntaxTheme(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update('editor.tokenColorCustomizations',      undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update('editor.semanticTokenColorCustomizations', undefined, vscode.ConfigurationTarget.Workspace);
}

// ---------------------------------------------------------------------------

async function applyProjectColor(baseHex: string, titleHex: string, actHex: string, statusHex: string, cmdBorderHex?: string): Promise<void> {
    const fgTitle  = getContrastColor(titleHex);
    const fgAct    = getContrastColor(actHex);
    const fgStatus = getContrastColor(statusHex);

    const cmdBg     = darkenHex(titleHex, 0.24);
    const cmdFg     = getContrastColor(cmdBg);
    const cmdBorder = cmdBorderHex ?? (titleHex + '55');

    // Deep-dark panel backgrounds: darken the base color heavily so it becomes a
    // near-black tinted solid. e.g. purple #7c3aff → sidebar #130926 (dark purple).
    // Solid colors, not alpha fog — background is clearly colored, text stays readable.
    const deep = (amt: number): string => darkenHex(baseHex, amt);

    const cfg = vscode.workspace.getConfiguration();
    const cur = (cfg.inspect('workbench.colorCustomizations')?.workspaceValue as Record<string, string>) ?? {};
    await cfg.update('workbench.colorCustomizations', {
        ...cur,
        // ── Chrome edges (animated per mode) ──────────────────────────────────
        'titleBar.activeBackground':          titleHex,
        'titleBar.activeForeground':          fgTitle,
        'titleBar.inactiveBackground':        darkenHex(titleHex, 0.12),
        'titleBar.inactiveForeground':        fgTitle + 'aa',
        'commandCenter.background':           cmdBg,
        'commandCenter.foreground':           cmdFg,
        'commandCenter.border':               cmdBorder,
        'commandCenter.activeBorder':         cmdBorderHex ?? lightenHex(titleHex, 0.28),
        'commandCenter.inactiveForeground':   cmdFg + '88',
        'commandCenter.inactiveBackground':   darkenHex(cmdBg, 0.10),
        'activityBar.background':             actHex,
        'activityBar.activeBackground':       actHex,
        'activityBar.activeBorder':           fgAct + '00',
        'activityBar.foreground':             fgAct,
        'activityBar.inactiveForeground':     fgAct + '88',
        'statusBar.background':               statusHex,
        'statusBar.foreground':               fgStatus,
        // ── Panel backgrounds (solid deep-dark tint — not alpha fog) ──────────
        'sideBar.background':                 deep(0.84),   // sidebar list
        'sideBarSectionHeader.background':    deep(0.78),   // section headers — slightly lighter
        'sideBarSectionHeader.border':        deep(0.72),   // divider line between sections
        'editorGroupHeader.tabsBackground':   deep(0.80),   // tab bar strip
        'tab.activeBackground':               deep(0.68),   // active tab — most visible
        'tab.inactiveBackground':             deep(0.86),   // inactive tabs — nearly black
        'tab.hoverBackground':                deep(0.76),   // tab hover
        'tab.activeBorder':                   titleHex,     // accent line under active tab
        'tab.activeBorderTop':                titleHex,     // bright accent line on TOP of active tab
        'panel.background':                   deep(0.82),   // terminal / problems panel
        'panelTitle.activeBorder':            actHex,       // colored underline on active panel tab
        'terminal.background':                deep(0.84),   // terminal interior
        // ── Scrollbar ────────────────────────────────────────────────────────
        'scrollbarSlider.background':         titleHex + '40',  // scrollbar thumb — semi-transparent accent
        'scrollbarSlider.hoverBackground':    titleHex + '70',  // brighter on hover
        'scrollbarSlider.activeBackground':   titleHex + 'aa',  // full accent when dragging
        // ── Command Palette / Quick Pick dropdown ────────────────────────────
        'quickInput.background':              deep(0.80),   // main dropdown bg
        'quickInputTitle.background':         deep(0.72),   // title bar inside quick pick
        'quickInputList.focusBackground':     deep(0.60),   // highlighted item
        'pickerGroup.border':                 deep(0.55),   // divider between groups
        // ── Notification toasts ──────────────────────────────────────────────
        'notifications.background':           deep(0.78),   // toast card bg
        'notifications.border':               deep(0.60),   // divider between toasts
        'notificationToast.border':           titleHex,     // outer border — accent color
        'notificationCenterHeader.background': deep(0.72),  // notification center header
        // ── Sticky scroll (pinned class/method headers while scrolling) ──────
        'editorStickyScroll.background':      deep(0.82),   // sticky header bg — slightly lighter than editor
        'editorStickyScrollHover.background': deep(0.75),   // hover state
        'editorStickyScrollBorder.shadow':    titleHex,     // separator line under sticky headers
        // ── Breadcrumb bar (src > file > Class > method) ─────────────────────
        'breadcrumb.background':              deep(0.85),   // breadcrumb strip bg
        // ── Editor area ──────────────────────────────────────────────────────
        'editor.background':                  deep(0.90),   // code area — very dark tint
        // ── Editor gutter (line-number column) ───────────────────────────────
        'editorGutter.background':            deep(0.88),   // gutter bg
        // ── Corner gaps & borders ─────────────────────────────────────────────
        'activityBar.border':                 deep(0.70),   // border between activity bar and sidebar
        'sideBar.border':                     deep(0.70),   // sidebar right border
        'activityBarBadge.background':        titleHex,     // badge (notification dot) — accent color
        'activityBarBadge.foreground':        fgTitle,      // badge text
        // ── List / tree items (terminal tabs, file explorer, extension list…) ──
        // Without these, text/icons inherit from the base theme but look invisible
        // against our very dark panel backgrounds.
        'list.foreground':                    lightenHex(titleHex, 0.72),  // default item text — light tint of title
        'list.activeSelectionForeground':     lightenHex(titleHex, 0.90),  // selected item text — near white
        'list.activeSelectionBackground':     deep(0.60),                  // selected item bg — lighter panel
        'list.inactiveSelectionForeground':   lightenHex(titleHex, 0.72),  // unfocused selection text
        'list.inactiveSelectionBackground':   deep(0.70),                  // unfocused selection bg
        'list.hoverForeground':               lightenHex(titleHex, 0.82),  // hover text — brighter
        'list.hoverBackground':               deep(0.65),                  // hover bg
        'list.focusForeground':               lightenHex(titleHex, 0.90),  // keyboard-focused item
        // ── Terminal UI ───────────────────────────────────────────────────────
        'terminalCursor.foreground':          titleHex,                    // cursor dot — top edge color
        'terminalCursor.background':          deep(0.90),                  // char under cursor
        'terminal.selectionBackground':       titleHex + '33',             // text selection highlight
        'terminal.inactiveSelectionBackground': titleHex + '1a',           // unfocused selection
        'list.warningForeground':             lightenHex(statusHex, 0.35), // ⚠ warning icons — bright enough to see
        'terminalCommandDecoration.defaultBackground':  actHex + '80',    // gutter marker — left edge color
        'terminalCommandDecoration.successBackground':  lightenHex(actHex, 0.20),  // success marker
        'terminalCommandDecoration.errorBackground':    lightenHex(statusHex, 0.10), // error marker
        // ── Terminal ANSI palette (project-tinted) ────────────────────────────
        // Blue family → title color (top edge)
        'terminal.ansiBlue':                  darkenHex(titleHex, 0.10),
        'terminal.ansiBrightBlue':            lightenHex(titleHex, 0.20),
        // Magenta family → activity color (left edge)
        'terminal.ansiMagenta':               darkenHex(actHex, 0.10),
        'terminal.ansiBrightMagenta':         lightenHex(actHex, 0.20),
        // Yellow family → status color (bottom edge) — replaces the default golden yellow
        'terminal.ansiYellow':                darkenHex(statusHex, 0.10),
        'terminal.ansiBrightYellow':          lightenHex(statusHex, 0.20),
        // Cyan family → blend of title + activity
        'terminal.ansiCyan':                  blendHex(titleHex, actHex, 0.5),
        'terminal.ansiBrightCyan':            lightenHex(blendHex(titleHex, actHex, 0.5), 0.20),
        // ── Buttons (global — affects all VS Code buttons incl. notification popups) ──
        'button.background':                  titleHex,              // primary button (Yes / Install / Save)
        'button.foreground':                  fgTitle,               // primary button text
        'button.hoverBackground':             lightenHex(titleHex, 0.15), // primary hover
        'button.secondaryBackground':         deep(0.62),            // secondary button (No / Cancel)
        'button.secondaryForeground':         '#ffffffcc',           // secondary button text
        'button.secondaryHoverBackground':    deep(0.50),            // secondary hover
        // ── Find widget + editor widgets (inline search bar, hover tooltip) ───
        'editorWidget.background':            deep(0.78),            // find/replace widget bg
        'editorWidget.foreground':            lightenHex(titleHex, 0.72), // widget text
        'editorWidget.border':                titleHex + '60',       // widget border — subtle accent
        'editorWidget.resizeBorder':          titleHex,              // resize handle
        // ── Input fields (find box, settings inputs) ──────────────────────────
        'input.background':                   deep(0.82),            // input field bg
        'input.foreground':                   lightenHex(titleHex, 0.75), // typed text
        'input.border':                       deep(0.55),            // input border
        'input.placeholderForeground':        lightenHex(titleHex, 0.38), // placeholder hint text
        'inputOption.activeBackground':       titleHex + '50',       // active toggle (Aa / ab / .*) bg
        'inputOption.activeBorder':           titleHex,              // active toggle border
        'inputOption.activeForeground':       lightenHex(titleHex, 0.90), // active toggle text
        // ── Find match highlights in editor ───────────────────────────────────
        'editor.findMatchBackground':         titleHex + '55',       // current match — accent bg
        'editor.findMatchBorder':             titleHex,              // current match — accent border
        'editor.findMatchHighlightBackground': actHex + '35',        // other matches — activity color
        'editor.findMatchHighlightBorder':    actHex + '55',         // other match borders
        'editor.findRangeHighlightBackground': deep(0.70),           // search scope region
        // ── Hover tooltip widget ──────────────────────────────────────────────
        'editorHoverWidget.background':       deep(0.78),            // hover tooltip bg
        'editorHoverWidget.foreground':       lightenHex(titleHex, 0.75), // hover text
        'editorHoverWidget.border':           titleHex + '60',       // hover border
        'editorHoverWidget.statusBarBackground': deep(0.70),         // status strip inside hover
        // ── Autocomplete / suggest widget ─────────────────────────────────────
        'editorSuggestWidget.background':     deep(0.78),            // dropdown bg
        'editorSuggestWidget.border':         titleHex + '60',       // dropdown border
        'editorSuggestWidget.foreground':     lightenHex(titleHex, 0.72), // item text
        'editorSuggestWidget.selectedBackground': deep(0.60),        // selected item bg
        'editorSuggestWidget.selectedForeground': lightenHex(titleHex, 0.90), // selected item text
        'editorSuggestWidget.highlightForeground': titleHex,         // matched chars — accent
        'editorSuggestWidget.focusHighlightForeground': lightenHex(titleHex, 0.20), // focus match
        // ── Peek view (go to definition inline panel) ─────────────────────────
        'peekView.border':                    titleHex,              // peek panel outer border
        'peekViewEditor.background':          deep(0.88),            // peek editor area
        'peekViewEditor.matchHighlightBackground': titleHex + '45',  // match in peek editor
        'peekViewResult.background':          deep(0.80),            // results list bg
        'peekViewResult.fileForeground':      lightenHex(titleHex, 0.72), // file name text
        'peekViewResult.lineForeground':      lightenHex(titleHex, 0.55), // line text
        'peekViewResult.matchHighlightBackground': actHex + '50',    // match in results
        'peekViewResult.selectionBackground': deep(0.60),            // selected result bg
        'peekViewResult.selectionForeground': lightenHex(titleHex, 0.90), // selected result text
        'peekViewTitle.background':           deep(0.72),            // peek title strip
        'peekViewTitleLabel.foreground':      lightenHex(titleHex, 0.80), // peek file name
        'peekViewTitleDescription.foreground': lightenHex(titleHex, 0.50), // peek path description
    }, vscode.ConfigurationTarget.Workspace);

    // Drive syntax palette from all three edge colors so each tick/mode state
    // produces a unique 3-anchor palette: title→keywords/types, act→functions/namespaces,
    // status→strings/numbers/constants.
    await applySyntaxTheme(titleHex, actHex, statusHex);
}

async function removeProjectColor(): Promise<void> {
    const ours = [
        'titleBar.activeBackground', 'titleBar.activeForeground',
        'titleBar.inactiveBackground', 'titleBar.inactiveForeground',
        'commandCenter.background', 'commandCenter.foreground',
        'commandCenter.border', 'commandCenter.activeBorder',
        'commandCenter.inactiveForeground', 'commandCenter.inactiveBackground',
        'activityBar.background', 'activityBar.activeBackground', 'activityBar.activeBorder',
        'activityBar.foreground', 'activityBar.inactiveForeground',
        'statusBar.background', 'statusBar.foreground',
        'sideBar.background', 'sideBarSectionHeader.background', 'sideBarSectionHeader.border',
        'editor.background',
        'editorGroupHeader.tabsBackground', 'tab.activeBackground', 'tab.inactiveBackground',
        'tab.hoverBackground', 'tab.activeBorder', 'tab.activeBorderTop',
        'panel.background', 'panelTitle.activeBorder', 'terminal.background',
        'editorGutter.background',
        'scrollbarSlider.background', 'scrollbarSlider.hoverBackground', 'scrollbarSlider.activeBackground',
        'notifications.background', 'notifications.border', 'notificationToast.border',
        'notificationCenterHeader.background',
        'quickInput.background', 'quickInputTitle.background',
        'quickInputList.focusBackground', 'pickerGroup.border',
        'activityBar.border', 'sideBar.border',
        'activityBarBadge.background', 'activityBarBadge.foreground',
        'editorStickyScroll.background', 'editorStickyScrollHover.background', 'editorStickyScrollBorder.shadow',
        'breadcrumb.background',
        'list.foreground', 'list.activeSelectionForeground', 'list.activeSelectionBackground',
        'list.inactiveSelectionForeground', 'list.inactiveSelectionBackground',
        'list.hoverForeground', 'list.hoverBackground', 'list.focusForeground',
        'terminalCursor.foreground', 'terminalCursor.background',
        'terminal.selectionBackground', 'terminal.inactiveSelectionBackground',
        'list.warningForeground',
        'terminalCommandDecoration.defaultBackground', 'terminalCommandDecoration.successBackground', 'terminalCommandDecoration.errorBackground',
        'terminal.ansiBlue', 'terminal.ansiBrightBlue',
        'terminal.ansiMagenta', 'terminal.ansiBrightMagenta',
        'terminal.ansiYellow', 'terminal.ansiBrightYellow',
        'terminal.ansiCyan', 'terminal.ansiBrightCyan',
        'button.background', 'button.foreground', 'button.hoverBackground',
        'button.secondaryBackground', 'button.secondaryForeground', 'button.secondaryHoverBackground',
        'editorWidget.background', 'editorWidget.foreground', 'editorWidget.border', 'editorWidget.resizeBorder',
        'input.background', 'input.foreground', 'input.border', 'input.placeholderForeground',
        'inputOption.activeBackground', 'inputOption.activeBorder', 'inputOption.activeForeground',
        'editor.findMatchBackground', 'editor.findMatchBorder',
        'editor.findMatchHighlightBackground', 'editor.findMatchHighlightBorder',
        'editor.findRangeHighlightBackground',
        'editorHoverWidget.background', 'editorHoverWidget.foreground', 'editorHoverWidget.border', 'editorHoverWidget.statusBarBackground',
        'editorSuggestWidget.background', 'editorSuggestWidget.border', 'editorSuggestWidget.foreground',
        'editorSuggestWidget.selectedBackground', 'editorSuggestWidget.selectedForeground',
        'editorSuggestWidget.highlightForeground', 'editorSuggestWidget.focusHighlightForeground',
        'peekView.border', 'peekViewEditor.background', 'peekViewEditor.matchHighlightBackground',
        'peekViewResult.background', 'peekViewResult.fileForeground', 'peekViewResult.lineForeground',
        'peekViewResult.matchHighlightBackground', 'peekViewResult.selectionBackground', 'peekViewResult.selectionForeground',
        'peekViewTitle.background', 'peekViewTitleLabel.foreground', 'peekViewTitleDescription.foreground',
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

    await removeSyntaxTheme();
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

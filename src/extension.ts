import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Sidebar Tree Views
// ---------------------------------------------------------------------------

class ProjectItem extends vscode.TreeItem {
    constructor(
        public readonly projectPath: string,
        public readonly index: number,
        public readonly contextVal: string,
    ) {
        super(path.basename(projectPath), vscode.TreeItemCollapsibleState.None);
        this.description = `#${index + 1}`;
        this.tooltip = projectPath;
        this.contextValue = contextVal;
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly configKey: string, private readonly contextVal: string) {}

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: ProjectItem): vscode.TreeItem { return element; }

    getChildren(): ProjectItem[] {
        const paths: string[] = vscode.workspace.getConfiguration('projectcycle').get<string[]>(this.configKey) ?? [];
        return paths.map((p, i) => new ProjectItem(p, i, this.contextVal));
    }
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    const priorityProvider = new ProjectsProvider('priorityProjects', 'priorityItem');
    const allProvider = new ProjectsProvider('allProjects', 'allItem');

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

import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell } from 'electron';
import path from 'path';
import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import { autoUpdater } from 'electron-updater';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

// In dev mode, share the same userData as the installed app so tasks/lists are identical
if (!app.isPackaged) {
    app.setPath('userData', path.join(app.getPath('appData'), 'Injaz'));
}

let mainWindow: BrowserWindow | null = null;
const quickAddWindows = new Set<BrowserWindow>();
let primaryQuickAddWindow: BrowserWindow | null = null; // Single persistent window for toggle
let tray: Tray | null = null;
let isQuitting = false;

let wasMainWindowFullScreen = false;
let wasMainWindowMaximized = false;

function hideMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    wasMainWindowFullScreen = mainWindow.isFullScreen();
    wasMainWindowMaximized = mainWindow.isMaximized();
    mainWindow.hide();
}

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    if (wasMainWindowFullScreen) {
        mainWindow.setFullScreen(true);
    } else if (wasMainWindowMaximized) {
        mainWindow.maximize();
    }
    mainWindow.focus();
}

let currentGlobalShortcut = 'Alt+Shift+W';
let currentAppToggleShortcut = 'Control+Alt+A';
let currentHideNotesShortcut = 'Alt+Shift+H';

const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../Public');

const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
};

// --- GOOGLE TASKS CONFIG ---
const GOOGLE_CLIENT_ID = '4575547852-4a6ffeepfncovsvbq5p213lde0rr0h0u.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_PORT = 4007; // Changed to avoid conflicts
const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_REDIRECT_PORT}`;

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

// Scopes for Google Tasks
const SCOPES = ['https://www.googleapis.com/auth/tasks'];

import * as net from 'net';

// Use the .ico file for windows
const ICON_PATH = path.join(__dirname, '../Public/Injaz 1 (1).ico');

/**
 * Returns true if the Vite dev server is reachable on port 3000.
 * Allows `npm run electron:run` to use HMR automatically without NODE_ENV.
 */
function checkDevServer(): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(4000, '127.0.0.1');
    });
}

// Resolved once at startup — used by createMainWindow & createQuickAddWindow
let isDev = process.env.NODE_ENV === 'development';

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        showMainWindow();
        return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 1200;
    const windowHeight = 800;

    mainWindow = new BrowserWindow({
        width: 1753,
        height: 644,
        x: 0,
        y: 1,
        icon: ICON_PATH,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    // Load the Vite dev server URL or local file
    if (isDev) {
        mainWindow.loadURL('http://localhost:4000');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            hideMainWindow();
        }
        return false;
    });

    // Notify renderer when window loses focus (for auto-closing sidebar)
    mainWindow.on('blur', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window-blur');
        }
    });
}

function createQuickAddWindow() {
    // Avoid creating multiple windows if primary is already being initialized or exists
    if (primaryQuickAddWindow && !primaryQuickAddWindow.isDestroyed()) {
        return primaryQuickAddWindow;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 500;
    const windowHeight = 500;

    const x = Math.floor((width - windowWidth) / 2);
    const y = Math.floor((height - windowHeight) / 2);

    const win = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: true,
        show: false,
        skipTaskbar: false,
        icon: ICON_PATH,
        minWidth: 300,
        minHeight: 200,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    if (isDev) {
        win.loadURL('http://localhost:4000/#/quick-add');
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'quick-add' });
    }

    win.once('ready-to-show', () => {
        // Initial state: Opacity 1 (electron window visible), 
        // but Renderer content will be Opacity 0 until 'show-quick-note' is sent.
        win.setOpacity(1);
        win.setAlwaysOnTop(true, 'screen-saver'); // Always on top whenever shown
        win.show();
        win.setIgnoreMouseEvents(false);
        win.focus();

        // Signal renderer to show content (fade in)
        win.webContents.send('show-quick-note');
        win.webContents.send('focus-quick-add');
    });

    win.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            // Don't hide immediately! Let renderer animate out.
            win.setIgnoreMouseEvents(true); // Prevent interaction while fading out
            // Request clear and close (vs just hide)
            win.webContents.send('request-clear-and-close');

            // Safety fallback: if the renderer never sends 'quick-note-hidden'
            // (e.g. window is frozen/minimized), force-hide after 1.5s
            const safetyTimer = setTimeout(() => {
                if (!win.isDestroyed() && win.isVisible()) {
                    win.hide();
                    win.setIgnoreMouseEvents(false);
                }
            }, 1500);

            // Cancel the safety timer if the window hides normally
            win.once('hide', () => clearTimeout(safetyTimer));
        }
    });

    // Re-assert alwaysOnTop on blur so Windows can't push it behind other windows
    win.on('blur', () => {
        if (!win.isDestroyed() && !isQuitting && win.isVisible()) {
            win.setAlwaysOnTop(true, 'screen-saver');
            win.setIgnoreMouseEvents(false);
        }
    });

    win.on('closed', () => {
        if (primaryQuickAddWindow === win) primaryQuickAddWindow = null;
        quickAddWindows.delete(win);
    });

    primaryQuickAddWindow = win;
    quickAddWindows.add(win);
    return win;
}

function createTray() {
    try {
        // Ensure icon exists, or use default if missing to prevent crash
        tray = new Tray(ICON_PATH);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open Injaz', click: () => showMainWindow() },
            {
                label: 'Quit', click: () => {
                    isQuitting = true;
                    app.quit();
                }
            }
        ]);
        tray.setToolTip('Injaz Task Manager');
        tray.setContextMenu(contextMenu);

        tray.on('double-click', () => {
            showMainWindow();
        });
    } catch (error) {
        console.error("Failed to create tray:", error);
    }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            showMainWindow();
        }
    });

    app.whenReady().then(async () => {
        // Check once if dev server is running (enables HMR without NODE_ENV=development)
        // Only in non-packaged mode to avoid production apps connecting to localhost
        if (!isDev && !app.isPackaged) isDev = await checkDevServer();
        createMainWindow();
        // Quick Note window is created on demand (not at startup)
        createTray();

        // Check for updates and notify user
        autoUpdater.autoDownload = false;
        autoUpdater.checkForUpdatesAndNotify();

        autoUpdater.on('checking-for-update', () => {
            mainWindow?.webContents.send('checking_for_update');
        });

        autoUpdater.on('update-available', () => {
            mainWindow?.webContents.send('update_available');
        });

        autoUpdater.on('update-not-available', () => {
            mainWindow?.webContents.send('update_not_available');
        });

        autoUpdater.on('update-downloaded', () => {
            mainWindow?.webContents.send('update_downloaded');
        });

        autoUpdater.on('error', (err) => {
            mainWindow?.webContents.send('update_error', err.message || err);
        });

        registerGlobalShortcut(currentGlobalShortcut);
        registerAppToggleShortcut(currentAppToggleShortcut);
        registerHideNotesShortcut(currentHideNotesShortcut);

        // Handle activation (macOS mostly, but good practice)
        app.on('activate', () => {
            // On macOS it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    }); // End of whenReady inside the lock block? No, typical pattern:
    // Actually, standard pattern:
    // if (!lock) quit
    // else { 
    //   app.on('second-instance', ...)
    //   app.whenReady().then(...)
    // }

    // Let's adjust the closing brace of the else block.
    // The previous chunk opened the `else {`. We need to close it at the end of app lifecycle logic or at file end?
    // Usually around the initialization logic.
    // Step 125 replacement: `else { ... app.whenReady()...`
    // So we need to close the `}` after the whenReady block.
    // But wait, `app.on('activate')` is inside `whenReady` callback in existing code?
    // Existing code lines 138-142 are inside `whenReady`.
    // Line 142 is `});` closing `whenReady`.
    // So we need to close the `else {` after line 142.

    // Refined strategy:
    // 1. Wrap the entire `app.whenReady` block in `if (gotTheLock) { ... } else { app.quit() }`? 
    // 2. Or just putting that check at top level.

    // Let's stick to the ReplacementChunk logic.
    // Chunk 1 replaces `app.whenReady().then(() => {` with the lock check and the start of the `else` block. 
    // Implementation:
    // const lock = app.requestSingleInstanceLock();
    // if (!lock) { app.quit(); } else {
    //    app.on('second-instance', ...)
    //    app.whenReady().then(() => { ...
    //       ...
    //    }); // closes whenReady
    // } // closes else

    // So I need a chunk to add the closing `}` for the `else` block.
    // Use a separate chunk for the end.


    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            // Do not quit, stay in tray
        }
    });

    // --- IPC HANDLERS ---

    ipcMain.on('app-quit', () => {
        isQuitting = true;
        app.quit();
    });

    ipcMain.on('quit-and-install', () => {
        autoUpdater.quitAndInstall();
    });

    ipcMain.on('download_update', () => {
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('maximize-window', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.maximize();
        }
    });

    ipcMain.on('unmaximize-window', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.unmaximize();
        }
    });

    ipcMain.on('close-quick-note', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.close();
    });

    ipcMain.on('set-always-on-top', (event, flag) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            win.setAlwaysOnTop(flag);
        }
    });

    ipcMain.handle('resize-window', (event, bounds) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            win.setBounds(bounds, false); // false = animate: false
        }
        return true; // Acknowledge completion
    });

    ipcMain.handle('set-window-size', (event, { width, height }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            win.setSize(width, height, true); // true = animate
        }
        return true;
    });

    ipcMain.handle('toggle-quick-note-size', (event, maximize) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
            const newWidth = maximize ? 900 : 500;
            const newHeight = maximize ? 1000 : 500;
            const x = Math.round((screenWidth - newWidth) / 2);
            const y = Math.round((screenHeight - newHeight) / 2);
            win.setBounds({ x, y, width: newWidth, height: newHeight }, true);
        }
        return true;
    });

    // Auto-launch Settings
    ipcMain.on('set-auto-launch', (event, enable) => {
        app.setLoginItemSettings({
            openAtLogin: enable,
            path: app.getPath('exe'),
        });
    });

    ipcMain.handle('get-auto-launch', () => {
        const settings = app.getLoginItemSettings();
        return settings.openAtLogin;
    });

    // Broadcast sync: Notify all windows when data changes
    ipcMain.on('data-updated', (event, type) => {
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed() && win.webContents !== event.sender) {
                win.webContents.send('data-updated', type);
            }
        });
    });

    // Quick Task Addition: Get lists from main window with task counts
    ipcMain.handle('get-lists', async () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            return await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedLists = localStorage.getItem('injaz_lists');
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    const lists = savedLists ? JSON.parse(savedLists) : [];
                    const tasks = savedTasks ? JSON.parse(savedTasks) : [];
                    return lists.map(list => ({
                        ...list,
                        taskCount: tasks.filter(t => t.listId === list.id && !t.isCompleted && t.parentId === null && t.type !== 'folder').length
                    }));
                })()
            `);
        }
        return [];
    });

    // Quick Task Addition: Get folders for a specific list with task counts
    ipcMain.handle('get-folders-for-list', async (event, listId: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            return await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    const tasks = savedTasks ? JSON.parse(savedTasks) : [];
                    const folders = tasks.filter(t => t.type === 'folder' && t.parentId === null && t.listId === ${JSON.stringify(listId)});
                    
                    return folders.map(folder => {
                        const countChildren = (f) => {
                            let count = 0;
                            const children = f.children || [];
                            children.forEach(child => {
                                if (child.type !== 'folder' && !child.isCompleted) count++;
                            });
                            return count;
                        };

                        const getLastActivity = (f) => {
                            let last = f.createdAt || 0;
                            const checkRecursive = (nodes) => {
                                nodes.forEach(n => {
                                    const activity = Math.max(n.createdAt || 0, n.completedAt || 0);
                                    if (activity > last) last = activity;
                                    if (n.children && n.children.length > 0) checkRecursive(n.children);
                                });
                            };
                            if (f.children) checkRecursive(f.children);
                            return last;
                        };

                        return { 
                            ...folder, 
                            taskCount: countChildren(folder),
                            lastActivityAt: getLastActivity(folder)
                        };
                    });
                })()
            `);
        }
        return [];
    });

    // Quick Task Addition: Add task to a specific list (optionally inside a folder)
    ipcMain.handle('add-task-to-list', async (event, { listId, title, parentId, priority, initialSubtaskTitle }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const escapedTitle = JSON.stringify(title);
            const escapedListId = JSON.stringify(listId);
            const escapedParentId = parentId ? JSON.stringify(parentId) : 'null';
            const escapedSubtaskTitle = initialSubtaskTitle !== undefined && initialSubtaskTitle !== null ? JSON.stringify(initialSubtaskTitle) : 'null';
            const taskPriority = priority || 2;

            await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    let tasks = savedTasks ? JSON.parse(savedTasks) : [];
                    const parentTaskId = crypto.randomUUID();
                    const initialSubtaskTitle = ${escapedSubtaskTitle};
                    
                    const childrenArr = initialSubtaskTitle !== null ? [{
                        id: crypto.randomUUID(),
                        title: initialSubtaskTitle,
                        type: 'item',
                        color: '#6366f1',
                        priority: ${taskPriority},
                        parentId: parentTaskId,
                        listId: ${escapedListId},
                        children: [],
                        isCompleted: false,
                        createdAt: Date.now()
                    }] : [];

                    const newTask = {
                        id: parentTaskId,
                        title: ${escapedTitle},
                        type: 'item',
                        color: '#6366f1',
                        priority: ${taskPriority},
                        parentId: ${escapedParentId},
                        listId: ${escapedListId},
                        children: childrenArr,
                        isCompleted: false,
                        createdAt: Date.now()
                    };
                    
                    const pId = ${escapedParentId};
                    if (pId) {
                        const addToParent = (list) => {
                            let found = false;
                            const result = list.map(t => {
                                if (t.id === pId) {
                                    found = true;
                                    // If parent has exactly one placeholder child (empty title), replace it
                                    const activeChildren = (t.children || []).filter(c => !c.isCompleted);
                                    if (t.type === 'item' && activeChildren.length === 1 && activeChildren[0].title === "") {
                                        const placeholderId = activeChildren[0].id;
                                        const newChildren = (t.children || []).map(c => c.id === placeholderId ? { ...newTask, parentId: t.id } : c);
                                        return { ...t, isArchived: false, children: newChildren };
                                    }
                                    return { ...t, isArchived: false, children: [newTask, ...(t.children || [])] };
                                }
                                if (t.children) {
                                    const updatedChildren = addToParent(t.children);
                                    if (updatedChildren !== t.children) {
                                        found = true;
                                        return { ...t, isArchived: false, children: updatedChildren };
                                    }
                                }
                                return t;
                            });
                            return found ? result : list;
                        };
                        tasks = addToParent(tasks);
                    } else {
                        tasks.unshift(newTask);
                    }
                    localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
                    window.dispatchEvent(new CustomEvent('injaz-task-added', { detail: newTask }));
                })()
            `);
            // Notify other windows
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed() && win.webContents !== event.sender) {
                    win.webContents.send('data-updated', 'tasks');
                }
            });
            return true;
        }
        return false;
    });

    // Quick Task Addition: Create new list
    ipcMain.handle('create-list', async (event, title) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const escapedTitle = JSON.stringify(title);
            const newList = await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedLists = localStorage.getItem('injaz_lists');
                    const lists = savedLists ? JSON.parse(savedLists) : [];
                    const nl = {
                        id: crypto.randomUUID(),
                        title: ${escapedTitle},
                        themeColor: 'indigo',
                        createdAt: Date.now(),
                        smartParams: { active: false }
                    };
                    lists.push(nl);
                    localStorage.setItem('injaz_lists', JSON.stringify(lists));
                    window.dispatchEvent(new CustomEvent('injaz-list-added', { detail: nl }));
                    return nl;
                })()
            `);
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed() && win.webContents !== event.sender) {
                    win.webContents.send('data-updated', 'lists');
                }
            });
            return newList;
        }
        return null;
    });

    // Quick Task Addition: Create new folder (Group)
    ipcMain.handle('create-folder', async (event, { listId, title }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const escapedTitle = JSON.stringify(title);
            const escapedListId = JSON.stringify(listId);
            const newFolder = await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    const tasks = savedTasks ? JSON.parse(savedTasks) : [];
                    const nf = {
                        id: crypto.randomUUID(),
                        title: ${escapedTitle},
                        type: 'folder',
                        color: '#3b82f6',
                        priority: 2,
                        listId: ${escapedListId},
                        parentId: null,
                        children: [],
                        isCompleted: false,
                        createdAt: Date.now()
                    };
                    tasks.unshift(nf);
                    localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
                    window.dispatchEvent(new CustomEvent('injaz-task-added', { detail: nf }));
                    return nf;
                })()
            `);
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed() && win.webContents !== event.sender) {
                    win.webContents.send('data-updated', 'tasks');
                }
            });
            return newFolder;
        }
        return null;
    });

    ipcMain.handle('delete-folder', async (event, folderId) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const escapedId = JSON.stringify(folderId);
            await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    if (!savedTasks) return;
                    let tasks = JSON.parse(savedTasks);
                    tasks = tasks.filter(t => t.id !== ${escapedId});
                    localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
                    window.dispatchEvent(new CustomEvent('injaz-task-added'));
                })()
            `);
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed()) win.webContents.send('data-updated', 'tasks');
            });
            return true;
        }
        return false;
    });

    ipcMain.handle('update-folder', async (event, { folderId, title }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const escapedId = JSON.stringify(folderId);
            const escapedTitle = JSON.stringify(title);
            await mainWindow.webContents.executeJavaScript(`
                (function() {
                    const savedTasks = localStorage.getItem('injaz_tasks');
                    if (!savedTasks) return;
                    let tasks = JSON.parse(savedTasks);
                    tasks = tasks.map(t => {
                        if (t.id === ${escapedId}) {
                            return { ...t, title: ${escapedTitle} };
                        }
                        return t;
                    });
                    localStorage.setItem('injaz_tasks', JSON.stringify(tasks));
                    window.dispatchEvent(new CustomEvent('injaz-task-added'));
                })()
            `);
            return true;
        }
        return false;
    });

    // Helper for registering shortcut
    function registerGlobalShortcut(shortcut: string) {
        if (currentGlobalShortcut) {
            globalShortcut.unregister(currentGlobalShortcut);
        }

        // Check if shortcut is valid, if empty do nothing
        if (!shortcut) return;

        try {
            const ret = globalShortcut.register(shortcut, () => {
                if (!primaryQuickAddWindow || primaryQuickAddWindow.isDestroyed()) {
                    primaryQuickAddWindow = createQuickAddWindow();
                    primaryQuickAddWindow.once('ready-to-show', () => {
                        primaryQuickAddWindow!.setOpacity(1);
                        primaryQuickAddWindow!.setAlwaysOnTop(true, 'screen-saver');
                        primaryQuickAddWindow!.show();
                        primaryQuickAddWindow!.webContents.send('show-quick-note');
                    });
                } else {
                    if (primaryQuickAddWindow.isVisible()) {
                        // Window is visible AND focused → hide it (toggle off)
                        primaryQuickAddWindow.webContents.send('hide-quick-note');

                        // Safety fallback in case the renderer animation never completes
                        const safetyTimer = setTimeout(() => {
                            if (primaryQuickAddWindow && !primaryQuickAddWindow.isDestroyed() && primaryQuickAddWindow.isVisible()) {
                                primaryQuickAddWindow.hide();
                                primaryQuickAddWindow.setIgnoreMouseEvents(false);
                            }
                        }, 1500);
                        primaryQuickAddWindow.once('hide', () => clearTimeout(safetyTimer));
                    } else {
                        // Window is hidden OR visible but behind other apps → bring to front
                        primaryQuickAddWindow.setIgnoreMouseEvents(false); // Ensure clickable
                        primaryQuickAddWindow.setOpacity(1);
                        primaryQuickAddWindow.setAlwaysOnTop(true, 'screen-saver'); // Force to front
                        primaryQuickAddWindow.show();
                        primaryQuickAddWindow.restore();
                        primaryQuickAddWindow.focus();
                        primaryQuickAddWindow.webContents.send('show-quick-note');
                        primaryQuickAddWindow.webContents.send('focus-quick-add');
                    }
                }
            });
            if (!ret) console.log('Registration failed for', shortcut);
            else currentGlobalShortcut = shortcut;
        } catch (e) {
            console.error('Failed to register shortcut', e);
        }
    }

    function registerHideNotesShortcut(shortcut: string) {
        if (currentHideNotesShortcut && currentHideNotesShortcut !== shortcut) {
            try { globalShortcut.unregister(currentHideNotesShortcut); } catch (e) { }
        }

        if (!shortcut) return;

        try {
            const ret = globalShortcut.register(shortcut, () => {
                // Toggle: if any visible, hide all. If all hidden, show all.
                let hasVisible = false;
                for (const win of quickAddWindows) {
                    if (!win.isDestroyed() && win.isVisible()) {
                        hasVisible = true;
                        break;
                    }
                }

                quickAddWindows.forEach(win => {
                    if (!win.isDestroyed()) {
                        if (hasVisible) {
                            win.hide();
                        } else {
                            win.showInactive(); // Show without focus to prevent flash
                        }
                    }
                });
            });
            if (!ret) console.log('Hide Notes Registration failed for', shortcut);
            else currentHideNotesShortcut = shortcut;
        } catch (e) {
            console.error('Failed to register Hide Notes shortcut', e);
        }
    }

    ipcMain.on('set-hide-notes-shortcut', (event, shortcut) => {
        registerHideNotesShortcut(shortcut);
    });

    ipcMain.on('set-global-shortcut', (event, shortcut) => {
        registerGlobalShortcut(shortcut);
    });

    function registerAppToggleShortcut(shortcut: string) {
        // We can't unregisterAll here because it would kill the other shortcut
        // So we need to track if we want to unregister specific? 
        // Electron globalShortcut.unregister(accelerator) exists.
        // Ideally we should unregister the OLD one. 
        // For simplicity, let's unregister the specific old one if valid?
        // Actually, `globalShortcut.unregisterAll()` clears EVERYTHING.
        // If we want to support 2 independent shortcuts, we shouldn't use unregisterAll in the other function either!

        // FIX: We need to refactor registerGlobalShortcut to NOT unregisterAll, OR just re-register both every time.
        // Simpler approach: Re-register logic.

        if (currentAppToggleShortcut) {
            globalShortcut.unregister(currentAppToggleShortcut);
        }

        if (!shortcut) return;

        try {
            const ret = globalShortcut.register(shortcut, () => {
                if (!mainWindow) return;

                // Logic: If visible AND focused -> Hide. Otherwise -> Show & Focus.
                if (mainWindow.isVisible() && mainWindow.isFocused()) {
                    hideMainWindow();
                } else {
                    showMainWindow();
                }
            });
            if (!ret) console.log('App Toggle Registration failed for', shortcut);
            else currentAppToggleShortcut = shortcut;
        } catch (e) {
            console.error('Failed to register app toggle shortcut', e);
        }
    }

    ipcMain.on('set-app-toggle-shortcut', (event, shortcut) => {
        registerAppToggleShortcut(shortcut);
    });

    // Handle opening external URLs
    ipcMain.handle('open-external', async (event, url: string) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Failed to open external URL:', error);
            return { success: false, error };
        }
    });

    // Handle fetching parent tasks (tasks with subtasks) for a folder
    // Single module-level handler: hide the window that sent the signal
    ipcMain.on('quick-note-hidden', (event) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) {
                win.hide();
                win.setIgnoreMouseEvents(false); // Re-enable for next show
            }
        } catch (e) {
            console.error('Error hiding quick note window:', e);
        }
    });

    ipcMain.handle('get-parent-tasks-for-folder', async (event, { listId, folderId }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                const escapedListId = JSON.stringify(listId);
                const escapedFolderId = JSON.stringify(folderId);

                return await mainWindow.webContents.executeJavaScript(`
                    (function() {
                        const savedTasks = localStorage.getItem('injaz_tasks');
                        if (!savedTasks) return [];
                        
                        const allTasks = JSON.parse(savedTasks);
                        const folderId = ${escapedFolderId};
                        
                        // Helper function to find tasks with children inside a folder
                        const findParentTasksInFolder = (tasks, parentId) => {
                            const results = [];
                            for (const task of tasks) {
                                // Check if this task is inside the target folder
                                if (task.id === parentId || (parentId === null && task.type !== 'folder')) {
                                    // This is a direct child of the folder, check if it has uncompleted children AND is not completed
                                    const activeSubtasks = task.children ? task.children.filter(c => !c.isCompleted) : [];
                                    if (activeSubtasks.length > 0 && task.type !== 'folder' && !task.isCompleted) {
                                        results.push({
                                            id: task.id,
                                            title: task.title,
                                            subtaskCount: activeSubtasks.length
                                        });
                                    }
                                }
                                // Recursively search in children
                                if (task.children && task.children.length > 0) {
                                    // If this is the folder we're looking for, get its direct children that have subtasks
                                    if (task.id === folderId) {
                                        for (const child of task.children) {
                                            const activeSubtasks = child.children ? child.children.filter(c => !c.isCompleted) : [];
                                            if (activeSubtasks.length > 0 && child.type !== 'folder' && !child.isCompleted) {
                                                results.push({
                                                    id: child.id,
                                                    title: child.title,
                                                    subtaskCount: activeSubtasks.length
                                                });
                                            }
                                        }
                                    } else {
                                        // Continue searching deeper
                                        const deeper = findParentTasksInFolder(task.children, parentId);
                                        results.push(...deeper);
                                    }
                                }
                            }
                            return results;
                        };
                        
                        // Search starting from root
                        return findParentTasksInFolder(allTasks, folderId);
                    })()
                `);
            } catch (error) {
                console.error('Error fetching parent tasks:', error);
                return [];
            }
        }
        return [];
    });

    // --- GOOGLE TASKS IPC HANDLERS ---

    ipcMain.handle('google-tasks:auth', async () => {
        return new Promise((resolve, reject) => {
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                prompt: 'consent'
            });

            let settled = false;

            const server = http.createServer(async (req, res) => {
                // Ignore favicon requests or anything that doesn't have a code
                if (!req.url || !req.url.includes('code=')) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><p>Waiting...</p></body></html>');
                    return;
                }

                try {
                    const parsedUrl = url.parse(req.url, true);
                    const code = parsedUrl.query.code as string;

                    if (!code) {
                        res.writeHead(400);
                        res.end('No code received.');
                        return;
                    }

                    // Send success page to browser immediately
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <html><body style="font-family:sans-serif;text-align:center;padding:40px;direction:rtl">
                            <h2 style="color:green">✅ تم الربط بنجاح!</h2>
                            <p>يمكنك إغلاق هذا التبويب والعودة إلى تطبيق إنجاز.</p>
                        </body></html>
                    `);

                    if (!settled) {
                        settled = true;
                        server.close();
                        const { tokens } = await oauth2Client.getToken(code);
                        oauth2Client.setCredentials(tokens);
                        resolve(tokens);
                    }
                } catch (e) {
                    if (!settled) {
                        settled = true;
                        res.writeHead(500);
                        res.end('Authentication failed.');
                        server.close();
                        reject(e);
                    }
                }
            });

            server.on('error', (e: any) => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`Server error: ${e.message}. Port ${GOOGLE_REDIRECT_PORT} may be in use.`));
                }
            });

            server.listen(GOOGLE_REDIRECT_PORT, '127.0.0.1', () => {
                console.log(`[Google Auth] Listening on http://127.0.0.1:${GOOGLE_REDIRECT_PORT}`);
                shell.openExternal(authUrl);
            });

            // 5-minute timeout
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    server.close();
                    reject(new Error('Authentication timed out after 5 minutes.'));
                }
            }, 5 * 60 * 1000);
        });
    });

    ipcMain.handle('google-tasks:fetch-lists', async (event, tokens) => {
        try {
            oauth2Client.setCredentials(tokens);
            const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
            const res = await tasksApi.tasklists.list();
            return res.data.items || [];
        } catch (error) {
            console.error('[Google Tasks] Fetch Lists Error:', error);
            return [];
        }
    });

    ipcMain.handle('google-tasks:fetch', async (event, { tokens, listIds }) => {
        try {
            oauth2Client.setCredentials(tokens);
            const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
            
            let allTasks: any[] = [];
            const ids = listIds && listIds.length > 0 ? listIds : ['@default'];

            for (const listId of ids) {
                const res = await tasksApi.tasks.list({
                    tasklist: listId,
                    showCompleted: true,
                    showHidden: true,
                    maxResults: 100
                });
                if (res.data.items) {
                    const tasksWithListId = res.data.items.map(t => ({ ...t, listId }));
                    allTasks = [...allTasks, ...tasksWithListId];
                }
            }
            
            return { tasks: allTasks };
        } catch (error) {
            console.error('Google Tasks Fetch Error:', error);
            return { tasks: [] };
        }
    });

    ipcMain.handle('google-tasks:update-task', async (event, { tokens, taskId, listId, completed, title }) => {
        try {
            oauth2Client.setCredentials(tokens);
            const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
            
            const requestBody: any = {};
            if (completed !== undefined) requestBody.status = completed ? 'completed' : 'needsAction';
            if (title !== undefined) requestBody.title = title;

            await tasksApi.tasks.patch({
                tasklist: listId || '@default',
                task: taskId,
                requestBody
            });
            return true;
        } catch (error) {
            console.error('[Google Tasks] Update Error:', error);
            return false;
        }
    });

    ipcMain.handle('google-tasks:create-task', async (event, { tokens, listId, title, parentId }) => {
        try {
            oauth2Client.setCredentials(tokens);
            const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
            
            const res = await tasksApi.tasks.insert({
                tasklist: listId || '@default',
                parent: parentId,
                requestBody: {
                    title: title || '(بدون عنوان)',
                    status: 'needsAction'
                }
            });
            return res.data.id;
        } catch (error) {
            console.error('[Google Tasks] Create Error:', error);
            return null;
        }
    });
}

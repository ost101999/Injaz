import type { App, BrowserWindow, Dialog, IpcMain } from 'electron';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import * as fs from 'fs';
import http from 'http';
import * as net from 'net';
import path from 'path';
import { pathToFileURL } from 'url';

export const FULL_DEV_ENV = 'INJAZ_DEV_FULL';
export const INSTALLED_APP_ENV = 'INJAZ_INSTALLED_APP_PATH';
const ENGINE_FILES = ['electron/main.ts', 'electron/dev-mode.ts'];

interface RegisterDevModeOptions {
    app: App;
    ipcMain: IpcMain;
    dialog: Dialog;
    distDir: string;
    getMainWindow: () => BrowserWindow | null;
    beforeLoadSwitch?: () => void;
    afterLoadSwitch?: () => void;
}

export function registerDevMode({
    app,
    ipcMain,
    dialog,
    distDir,
    getMainWindow,
    beforeLoadSwitch,
    afterLoadSwitch,
}: RegisterDevModeOptions) {
    let devModeUrl: string | null = null;
    let devModeChild: ReturnType<typeof spawn> | null = null;
    let devModeBusy = false;
    let devStorage: Record<string, string> | null = null;
    const fullSource = !app.isPackaged && process.env[FULL_DEV_ENV] === '1';

    const installedUrl = pathToFileURL(path.join(distDir, 'dist', 'index.html')).href;
    const devRecoveryFile = path.join(app.getPath('userData'), 'dev-mode-recovery.json');
    const handoffFile = path.join(app.getPath('userData'), 'dev-mode-handoff.json');

    const stopVite = () => {
        try { devModeChild?.kill(); } catch { /* ignore */ }
        devModeChild = null;
    };
    app.on('will-quit', stopVite);

    const validRoot = (root: string) =>
        Boolean(root) &&
        fs.existsSync(path.join(root, 'vite.config.ts')) &&
        fs.existsSync(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'));

    const findRoot = (): string => {
        const candidates: string[] = [];
        try {
            const saved = fs.readFileSync(path.join(app.getPath('userData'), 'project-root.txt'), 'utf8').trim();
            if (saved) candidates.push(saved);
        } catch { /* ignore */ }
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'project-meta.json'), 'utf8'));
            if (meta?.projectRoot) candidates.push(meta.projectRoot);
        } catch { /* ignore */ }
        candidates.push(path.resolve(__dirname, '..'));
        return candidates.find(validRoot) || '';
    };

    const getElectronBinary = (root: string): string | null => {
        if (!root) return null;
        const bin = process.platform === 'darwin'
            ? path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
            : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
        return fs.existsSync(bin) ? bin : null;
    };

    const getInstalledAppPath = (): string | null => {
        const fromEnv = process.env[INSTALLED_APP_ENV];
        if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
        if (app.isPackaged) {
            return process.platform === 'darwin'
                ? path.resolve(process.execPath, '../../..')
                : process.execPath;
        }
        return null;
    };

    const hashFile = (filePath: string): string | null => {
        try {
            if (!fs.existsSync(filePath)) return null;
            return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        } catch {
            return null;
        }
    };

    const readBaselineHashes = (): Record<string, string> | null => {
        if (app.isPackaged) {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'project-meta.json'), 'utf8'));
                if (meta?.engineHashes && typeof meta.engineHashes === 'object') {
                    return meta.engineHashes;
                }
            } catch { /* ignore */ }
            return null;
        }
        if (fullSource) {
            const root = findRoot();
            if (!root) return null;
            const snapshot: Record<string, string> = {};
            for (const rel of ENGINE_FILES) {
                const h = hashFile(path.join(root, rel));
                if (h) snapshot[rel] = h;
            }
            return snapshot;
        }
        return null;
    };

    const baselineHashes = readBaselineHashes();

    const hasEngineChanges = (root = findRoot()): boolean => {
        if (!root || !baselineHashes) return false;
        return ENGINE_FILES.some((rel) => {
            const base = baselineHashes[rel];
            const live = hashFile(path.join(root, rel));
            return Boolean(base) && Boolean(live) && base !== live;
        });
    };

    const startViteServer = async (root: string) => {
        const port = await new Promise<number>((resolve, reject) => {
            const server = net.createServer();
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') return reject(new Error('تعذر اختيار منفذ.'));
                const p = address.port;
                server.close(() => resolve(p));
            });
        });
        const proc = spawn(
            process.execPath,
            [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
            {
                cwd: root,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                stdio: 'ignore',
                windowsHide: true,
            }
        );
        let spawnError: Error | null = null;
        proc.on('error', (err) => { spawnError = err; });
        await new Promise<void>((resolve, reject) => {
            const end = Date.now() + 30000;
            const poll = () => {
                if (spawnError || proc.exitCode !== null || proc.signalCode !== null || Date.now() > end) {
                    return reject(spawnError || new Error('تعذر تشغيل خادم التطوير.'));
                }
                const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
                    response.resume();
                    if (response.statusCode === 200) resolve();
                    else setTimeout(poll, 250);
                });
                request.setTimeout(500, () => request.destroy());
                request.on('error', () => setTimeout(poll, 250));
            };
            poll();
        });
        return { proc, url: `http://127.0.0.1:${port}/` };
    };

    const compileElectronInRoot = (root: string): { ok: boolean; error?: string } => {
        const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
        if (!fs.existsSync(tscBin)) {
            return { ok: false, error: 'أداة TypeScript غير مثبتة في مجلد المشروع.' };
        }
        const res = spawnSync(
            process.execPath,
            [tscBin, '-p', path.join(root, 'tsconfig.electron.json')],
            {
                cwd: root,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                encoding: 'utf8',
                windowsHide: true,
            }
        );
        if (res.status !== 0) {
            return { ok: false, error: (res.stdout || res.stderr || 'تعذر ترجمة كود Electron.').slice(0, 300) };
        }
        return { ok: true };
    };

    const delayedSpawn = (cmd: string, args: string[], cwd: string, envObj: NodeJS.ProcessEnv) => {
        const helperScript = `
          const { spawn } = require('child_process');
          const cfg = JSON.parse(process.argv[1]);
          setTimeout(() => {
            try {
              const p = spawn(cfg.cmd, cfg.args, { cwd: cfg.cwd, env: cfg.env, detached: true, stdio: 'ignore', windowsHide: false });
              p.unref();
            } catch {}
          }, 400);
        `;
        const launcher = spawn(
            process.execPath,
            ['-e', helperScript, JSON.stringify({ cmd, args, cwd, env: envObj })],
            {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            }
        );
        launcher.unref();
    };

    const writeRecoveryFiles = (storage: Record<string, string>) => {
        try { fs.writeFileSync(handoffFile, JSON.stringify(storage), 'utf8'); } catch { /* ignore */ }
        try { fs.writeFileSync(devRecoveryFile, JSON.stringify(storage), 'utf8'); } catch { /* ignore */ }
    };

    const launchFullSourceProcess = (root: string, storage: Record<string, string>) => {
        const electronBin = getElectronBinary(root);
        if (!electronBin) return { ok: false, error: 'تعذر العثور على Electron في مجلد المشروع.' };
        const compiled = compileElectronInRoot(root);
        if (!compiled.ok) return compiled;

        writeRecoveryFiles(storage);
        beforeLoadSwitch?.();
        const installedAppPath = getInstalledAppPath();
        const childEnv: NodeJS.ProcessEnv = { ...process.env, [FULL_DEV_ENV]: '1' };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        delete childEnv.NODE_ENV;
        delete childEnv.INJAZ_SHARED_PREVIEW;
        if (installedAppPath) childEnv[INSTALLED_APP_ENV] = installedAppPath;
        stopVite();
        try { app.releaseSingleInstanceLock?.(); } catch { /* ignore */ }
        delayedSpawn(electronBin, ['.'], root, childEnv);
        setTimeout(() => app.exit(0), 60);
        return { ok: true, relaunching: true };
    };

    const launchInstalledProcess = (storage: Record<string, string>) => {
        const installedAppPath = getInstalledAppPath();
        if (!installedAppPath) return { ok: false, error: 'تعذر العثور على مسار النسخة المثبتة.' };
        writeRecoveryFiles(storage);
        beforeLoadSwitch?.();
        const childEnv: NodeJS.ProcessEnv = { ...process.env };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        delete childEnv[FULL_DEV_ENV];
        delete childEnv[INSTALLED_APP_ENV];
        delete childEnv.NODE_ENV;
        delete childEnv.INJAZ_SHARED_PREVIEW;
        stopVite();
        try { app.releaseSingleInstanceLock?.(); } catch { /* ignore */ }
        if (process.platform === 'darwin') {
            delayedSpawn('open', ['-n', installedAppPath], process.cwd(), childEnv);
        } else {
            delayedSpawn(installedAppPath, [], path.dirname(installedAppPath), childEnv);
        }
        setTimeout(() => app.exit(0), 60);
        return { ok: true, relaunching: true };
    };

    const isAvailable = () => app.isPackaged || fullSource;

    ipcMain.on('dev-mode:persist', (event, data: Record<string, string>) => {
        const win = getMainWindow();
        if (win && event.sender === win.webContents && devModeUrl) {
            try {
                const temp = devRecoveryFile + '.tmp';
                fs.writeFileSync(temp, JSON.stringify(data));
                fs.renameSync(temp, devRecoveryFile);
            } catch (error) {
                console.error('Dev mode storage backup failed:', error);
            }
        }
    });

    ipcMain.on('dev-mode:restore', (event) => {
        const win = getMainWindow();
        if (win && event.sender === win.webContents) {
            let saved = devStorage;
            if (!saved && fs.existsSync(handoffFile)) {
                try { saved = JSON.parse(fs.readFileSync(handoffFile, 'utf8')); } catch { /* ignore */ }
                try { fs.unlinkSync(handoffFile); } catch { /* ignore */ }
            }
            if (!saved && !devModeUrl) {
                try { saved = JSON.parse(fs.readFileSync(devRecoveryFile, 'utf8')); } catch { /* ignore */ }
            }
            event.returnValue = saved;
            if (saved && !devModeUrl) {
                try { fs.unlinkSync(devRecoveryFile); } catch { /* ignore */ }
            }
            devStorage = null;
        } else {
            event.returnValue = null;
        }
    });

    ipcMain.handle('dev-mode:status', () => {
        const root = findRoot();
        const active = Boolean(devModeUrl || fullSource);
        return {
            available: isAvailable(),
            active,
            fullSource,
            mainOutdated: active || fullSource ? hasEngineChanges(root) : false,
        };
    });

    ipcMain.handle('dev-mode:toggle', async (event, storage: Record<string, string>) => {
        const win = getMainWindow();
        if (!isAvailable() || !win || event.sender !== win.webContents || devModeBusy) {
            return { ok: false, error: 'تعذر تغيير وضع التطوير.' };
        }
        devModeBusy = true;
        const oldUrl = devModeUrl;
        let newChild: ReturnType<typeof spawn> | null = null;
        try {
            const rootFile = path.join(app.getPath('userData'), 'project-root.txt');
            let root = findRoot();
            if (!validRoot(root)) {
                const choice = await dialog.showOpenDialog(win, { title: 'اختر مجلد مشروع إنجاز', properties: ['openDirectory'] });
                if (choice.canceled) return { ok: false, canceled: true };
                root = choice.filePaths[0];
                if (!validRoot(root)) return { ok: false, error: 'مجلد المشروع غير صالح أو اعتماديات التطوير غير مثبتة.' };
                fs.writeFileSync(rootFile, root, 'utf8');
            }

            storage = await win.webContents.executeJavaScript(
                `Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }))`
            );

            if (hasEngineChanges(root) && getElectronBinary(root)) {
                return launchFullSourceProcess(root, storage);
            }

            if (fullSource) {
                return launchInstalledProcess(storage);
            }

            let target = installedUrl;
            if (!oldUrl) {
                const started = await startViteServer(root);
                newChild = started.proc;
                target = started.url;
            }
            beforeLoadSwitch?.();
            devStorage = storage;
            if (!oldUrl) fs.writeFileSync(devRecoveryFile, JSON.stringify(storage));
            devModeUrl = oldUrl ? null : target;
            const oldChild = devModeChild;
            if (newChild) devModeChild = newChild;
            setImmediate(async () => {
                try {
                    await win.loadURL(target);
                    if (oldUrl) {
                        oldChild?.kill();
                        devModeChild = null;
                    }
                } catch {
                    beforeLoadSwitch?.();
                    newChild?.kill();
                    devModeChild = oldChild;
                    devModeUrl = oldUrl;
                    devStorage = storage;
                    try { await win.loadURL(oldUrl || installedUrl); } catch { /* ignore */ }
                    dialog.showErrorBox('وضع التطوير', 'تعذر تحميل الواجهة.');
                } finally {
                    devModeBusy = false;
                    afterLoadSwitch?.();
                }
            });
            return { ok: true };
        } catch (error: any) {
            newChild?.kill();
            return { ok: false, error: String(error?.message || error) };
        } finally {
            if (!devStorage) devModeBusy = false;
        }
    });

    const prepareFullDevUrl = async () => {
        if (!fullSource) return null;
        const root = findRoot();
        if (!root) return null;
        try {
            const started = await startViteServer(root);
            devModeChild = started.proc;
            devModeUrl = started.url;
            return devModeUrl;
        } catch {
            return null;
        }
    };

    return {
        getActiveUrl: () => devModeUrl,
        prepareFullDevUrl,
    };
}

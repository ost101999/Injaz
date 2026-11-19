const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-quick-note-'));
const entry = path.join(dir, 'test.cjs');
const dev = process.argv.includes('--dev');

fs.writeFileSync(entry, `
const { app, BrowserWindow, globalShortcut, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const shortcuts = new Map();
const ready = new Set();

app.setPath('userData', ${JSON.stringify(dir)});
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => { if (name !== 'userData') setPath(name, value); };
app.requestSingleInstanceLock = () => true;
globalShortcut.register = (key, callback) => { shortcuts.set(key, callback); return true; };
globalShortcut.unregister = key => shortcuts.delete(key);

app.once('ready', () => {
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (details, callback) => callback({ cancel: new URL(details.url).origin !== 'http://localhost:4000' })
    );
});

ipcMain.on('quick-note-ready', event => ready.add(event.sender.id));
require(${JSON.stringify(path.join(root, 'dist-electron', 'main.js'))});

async function until(read) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
        const result = await read();
        if (result) return result;
        await delay(15);
    }
    throw Error('Timed out waiting for: ' + read);
}

app.whenReady().then(async () => {
    const press = await until(() => shortcuts.get('Alt+Shift+W'));
    const warmed = await until(() => BrowserWindow.getAllWindows().find(
        win => ready.has(win.webContents.id)
    ));
    assert.equal(warmed.isVisible(), false, 'preloading must keep the note hidden');
    shortcuts.get('Alt+Shift+H')();
    assert.equal(warmed.isVisible(), false, 'hide-notes must leave a never-opened note hidden');

    const editor = 'document.querySelector("[contenteditable=true]")';
    const focused = win => until(() => win.isVisible() && win.webContents.executeJavaScript(
        'document.activeElement === ' + editor
    ));
    const warmStart = performance.now();
    press();
    await focused(warmed);
    await warmed.webContents.insertText('Quick draft');
    assert.equal(await warmed.webContents.executeJavaScript(editor + '.textContent'), 'Quick draft');
    const warmMs = Math.round(performance.now() - warmStart);
    assert.match(warmed.webContents.getURL(), /#quick-add$/);
    assert.equal(await warmed.webContents.executeJavaScript(
        'getComputedStyle(' + editor + ').overflowY'
    ), 'auto');
    assert.equal(await warmed.webContents.executeJavaScript(
        "document.fonts.load('20px Amiri', 'عربي').then(fonts => fonts.length > 0)"
    ), true);

    press();
    await until(() => !warmed.isVisible());
    press();
    await focused(warmed);
    assert.equal(await warmed.webContents.executeJavaScript(editor + '.textContent'), 'Quick draft');

    warmed.destroy();
    const coldStart = performance.now();
    press();
    press();
    const created = BrowserWindow.getAllWindows().find(win => !win.isVisible());
    assert.ok(created, 'cold open creates a single hidden note while loading');
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await focused(created);
    await created.webContents.insertText('First input');
    assert.equal(await created.webContents.executeJavaScript(editor + '.textContent'), 'First input');
    console.log(JSON.stringify({ warmMs, coldMs: Math.round(performance.now() - coldStart) }));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);

try {
    const env = { ...process.env, NODE_ENV: dev ? 'development' : 'production' };
    if (!dev) env.INJAZ_SHARED_PREVIEW = '1';
    else delete env.INJAZ_SHARED_PREVIEW;
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [entry], { encoding: 'utf8', env, timeout: 35000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    console.log(result.stdout.trim());
} finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}


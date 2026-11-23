const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('injaz dev-mode detects electron source changes cleanly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-devmode-'));
    try {
        const projectDir = path.join(tmp, 'project');
        const userDataDir = path.join(tmp, 'userData');
        const distElectronDir = path.join(projectDir, 'dist-electron');
        fs.mkdirSync(path.join(projectDir, 'electron'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'node_modules', 'vite', 'bin'), { recursive: true });
        fs.mkdirSync(distElectronDir, { recursive: true });
        fs.mkdirSync(userDataDir, { recursive: true });

        fs.writeFileSync(path.join(projectDir, 'vite.config.ts'), '', 'utf8');
        fs.writeFileSync(path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js'), '', 'utf8');
        fs.writeFileSync(path.join(projectDir, 'electron', 'main.ts'), 'const v = 1;\n', 'utf8');
        fs.writeFileSync(path.join(projectDir, 'electron', 'dev-mode.ts'), 'const d = 1;\n', 'utf8');
        fs.writeFileSync(path.join(userDataDir, 'project-root.txt'), projectDir, 'utf8');

        // Copy compiled dev-mode.js into temp distElectronDir so __dirname resolves inside tmp.
        const compiledDevMode = path.resolve(__dirname, '..', 'dist-electron', 'dev-mode.js');
        fs.copyFileSync(compiledDevMode, path.join(distElectronDir, 'dev-mode.js'));

        const mainHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(projectDir, 'electron', 'main.ts'))).digest('hex');
        const devHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(projectDir, 'electron', 'dev-mode.ts'))).digest('hex');
        fs.writeFileSync(
            path.join(distElectronDir, 'project-meta.json'),
            JSON.stringify({ projectRoot: projectDir, engineHashes: { 'electron/main.ts': mainHash, 'electron/dev-mode.ts': devHash } }),
            'utf8'
        );

        const { registerDevMode } = require(path.join(distElectronDir, 'dev-mode.js'));
        const handlers = new Map();
        const prevFull = process.env.INJAZ_DEV_FULL;
        process.env.INJAZ_DEV_FULL = '1';
        try {
            registerDevMode({
                app: {
                    isPackaged: false,
                    getPath: () => userDataDir,
                    on: () => {},
                },
                ipcMain: {
                    on: () => {},
                    handle: (name, fn) => handlers.set(name, fn),
                },
                dialog: {},
                distDir: projectDir,
                getMainWindow: () => null,
            });

            assert.equal(handlers.get('dev-mode:status')().mainOutdated, false);
            fs.writeFileSync(path.join(projectDir, 'electron', 'main.ts'), 'const v = 2;\n', 'utf8');
            assert.equal(handlers.get('dev-mode:status')().mainOutdated, true);
        } finally {
            if (prevFull === undefined) delete process.env.INJAZ_DEV_FULL;
            else process.env.INJAZ_DEV_FULL = prevFull;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

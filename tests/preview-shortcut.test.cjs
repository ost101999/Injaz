const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('preview launcher starts development commands without packaging', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-preview-test-'));
    const tools = path.join(root, 'tools');
    const bin = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(tools, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'تشغيل وبناء إنجاز', 'Preview.ps1'), path.join(tools, 'Preview.ps1'));
    fs.writeFileSync(path.join(bin, 'concurrently.cmd'), '@echo off\r\necho %*\r\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tools, 'Preview.ps1')], { encoding: 'utf8', env: { ...process.env, INJAZ_NONINTERACTIVE: '1' }, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /npm run dev -- --strictPort/);
    assert.match(result.stdout, /npm run compile:electron && npm run electron/);
    assert.doesNotMatch(result.stdout, /electron-builder/);
});

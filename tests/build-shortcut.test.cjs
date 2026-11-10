const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('a failed installer build preserves the previous output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-build-test-'));
    const tools = path.join(root, 'tools');
    const bin = path.join(root, 'node_modules', '.bin');
    const output = path.join(tools, 'Build Output');
    fs.mkdirSync(output, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(output, '.injaz-build-output'), 'marker');
    fs.writeFileSync(path.join(output, 'old-installer.exe'), 'previous');
    fs.writeFileSync(path.join(root, 'npm.cmd'), '@echo off\r\nexit /b 0\r\n');
    fs.writeFileSync(path.join(bin, 'electron-builder.cmd'), '@echo off\r\nexit /b 1\r\n');
    fs.copyFileSync(path.join(__dirname, '..', 'تشغيل وبناء إنجاز', 'Build.ps1'), path.join(tools, 'Build.ps1'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tools, 'Build.ps1')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, INJAZ_NONINTERACTIVE: '1', INJAZ_NO_OPEN: '1' }, timeout: 15000
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(path.join(output, 'old-installer.exe'), 'utf8'), 'previous');
});

test('a successful build replaces the previous output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-build-test-'));
    const tools = path.join(root, 'tools');
    const bin = path.join(root, 'node_modules', '.bin');
    const output = path.join(tools, 'Build Output');
    fs.mkdirSync(output, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(output, '.injaz-build-output'), 'marker');
    fs.writeFileSync(path.join(output, 'old-installer.exe'), 'previous');
    fs.writeFileSync(path.join(root, 'npm.cmd'), '@echo off\r\nexit /b 0\r\n');
    fs.writeFileSync(path.join(bin, 'electron-builder.cmd'), '@echo off\r\nfor /d %%D in ("%CD%\\release\\.injaz-build-stage-*") do echo new>"%%~fD\\Injaz Setup.exe"\r\nexit /b 0\r\n');
    fs.copyFileSync(path.join(__dirname, '..', 'تشغيل وبناء إنجاز', 'Build.ps1'), path.join(tools, 'Build.ps1'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tools, 'Build.ps1')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, INJAZ_NONINTERACTIVE: '1', INJAZ_NO_OPEN: '1' }, timeout: 15000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(output, 'old-installer.exe')), false);
    assert.equal(fs.readFileSync(path.join(output, 'Injaz Setup.exe'), 'utf8').trim(), 'new');
    assert.equal(fs.readdirSync(tools).some(name => name.startsWith('.previous-build-')), false);
});

test('a temporary NSIS spawn EPERM is retried and the previous output is kept until success', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-build-test-'));
    const tools = path.join(root, 'tools');
    const bin = path.join(root, 'node_modules', '.bin');
    const output = path.join(tools, 'Build Output');
    fs.mkdirSync(output, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(output, '.injaz-build-output'), 'marker');
    fs.writeFileSync(path.join(output, 'old-installer.exe'), 'previous');
    fs.writeFileSync(path.join(root, 'npm.cmd'), '@echo off\r\nexit /b 0\r\n');
    fs.writeFileSync(path.join(bin, 'electron-builder.cmd'), '@echo off\r\nif exist "%CD%\\retried" goto succeed\r\necho first>"%CD%\\retried"\r\necho spawn EPERM computeScriptAndSignUninstaller 1>&2\r\nexit /b 1\r\n:succeed\r\nif not exist "%CD%\\tools\\Build Output\\old-installer.exe" exit /b 2\r\nfor /d %%D in ("%CD%\\release\\.injaz-build-stage-*") do echo new>"%%~fD\\Injaz Setup.exe"\r\nexit /b 0\r\n');
    fs.copyFileSync(path.join(__dirname, '..', 'تشغيل وبناء إنجاز', 'Build.ps1'), path.join(tools, 'Build.ps1'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(tools, 'Build.ps1')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, INJAZ_NONINTERACTIVE: '1', INJAZ_NO_OPEN: '1' }, timeout: 20000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Retrying/);
    assert.equal(fs.readFileSync(path.join(output, 'Injaz Setup.exe'), 'utf8').trim(), 'new');
});

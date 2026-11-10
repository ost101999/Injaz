const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'injaz-origin-'));
const script = path.join(dir, 'check.js');
fs.writeFileSync(script, `
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.join(__dirname, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadFile(path.join(__dirname, 'installed.html'));
  await win.webContents.executeJavaScript("localStorage.setItem('injaz_test', 'same data')");
  await win.loadFile(path.join(__dirname, 'preview.html'));
  const result = await win.webContents.executeJavaScript("localStorage.getItem('injaz_test')");
  app.exit(result === 'same data' ? 0 : 1);
}).catch(() => app.exit(2));
`);
fs.writeFileSync(path.join(dir, 'installed.html'), '<html></html>');
fs.writeFileSync(path.join(dir, 'preview.html'), '<html></html>');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [script], { env, timeout: 20000, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || String(result.error));
console.log('File origins share localStorage in the same profile.');

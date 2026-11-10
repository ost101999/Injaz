const { spawn } = require('node:child_process');

// Some Electron installations write a trailing newline to `path.txt`.
// Trim it before spawning so development mode works reliably on macOS and Windows.
const executable = require('electron').trim();
const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit' });

child.on('error', (error) => {
    console.error(`Unable to start Electron: ${error.message}`);
    process.exitCode = 1;
});

child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});

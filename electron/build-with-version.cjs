const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const pkg = require('../package.json');

function computeVersion() {
    if (process.env.INJAZ_RELEASE_VERSION) {
        return process.env.INJAZ_RELEASE_VERSION.replace(/^v/i, '');
    }
    try {
        const countOutput = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
            cwd: path.resolve(__dirname, '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const commitCount = Number.parseInt(countOutput, 10);
        if (Number.isFinite(commitCount) && commitCount > 0) {
            const parts = String(pkg.version || '0.0.0').split('.');
            const major = Number.parseInt(parts[0], 10) || 0;
            const minor = Number.parseInt(parts[1], 10) || 0;
            return `${major}.${minor}.${commitCount}`;
        }
    } catch {
        // Fallback to package.json version if git is unavailable
    }
    return pkg.version || '0.0.10';
}

const fs = require('fs');

// Record the current project root so the installed app can locate its local build tool
try {
    const distElectronDir = path.resolve(__dirname, '..', 'dist-electron');
    if (!fs.existsSync(distElectronDir)) {
        fs.mkdirSync(distElectronDir, { recursive: true });
    }
    const metaFile = path.join(distElectronDir, 'project-meta.json');
    fs.writeFileSync(metaFile, JSON.stringify({ projectRoot: path.resolve(__dirname, '..') }, null, 2), 'utf8');
} catch {
    // Ignore meta writing errors
}

if (process.argv.includes('--print-version')) {
    process.stdout.write(computeVersion());
    process.exit(0);
}

const version = computeVersion();
const extraArgs = process.argv.slice(2);
const builderCli = require.resolve('electron-builder/out/cli/cli.js');

console.log(`[Injaz Build] Building version ${version}...`);

const result = spawnSync(
    process.execPath,
    [builderCli, `--config.extraMetadata.version=${version}`, ...extraArgs],
    {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        shell: false
    }
);

process.exit(result.status ?? 1);

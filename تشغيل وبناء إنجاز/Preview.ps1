$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
try {
    Set-Location -LiteralPath $root
    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\.bin\concurrently.cmd'))) {
        throw 'Dependencies are missing. Open a terminal in the project folder and run npm install.'
    }
    $installed = @(Get-Process -Name 'injaz---advanced-task-manager' -ErrorAction SilentlyContinue)
    if ($installed.Count -gt 0) {
        # A normal window close only hides the installed app in the tray.
        Write-Host 'Stopping the installed Injaz app before starting preview...' -ForegroundColor Cyan
        $installed | Stop-Process -Force -ErrorAction SilentlyContinue
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Process -Name 'injaz---advanced-task-manager' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
        if (Get-Process -Name 'injaz---advanced-task-manager' -ErrorAction SilentlyContinue) {
            throw 'Injaz did not close. Close it from the system tray and try again.'
        }
    }
    Write-Host 'Starting Injaz preview. Keep this window open while using the app.' -ForegroundColor Cyan
    Write-Host 'Close this window when you finish.'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Initial preview build failed.' }
    & npm run compile:electron
    if ($LASTEXITCODE -ne 0) { throw 'Electron compilation failed.' }
    $env:INJAZ_SHARED_PREVIEW = '1'
    & (Join-Path $root 'node_modules\.bin\concurrently.cmd') -k 'npm run build -- --watch' 'npx electron .'
    if ($LASTEXITCODE -ne 0) { throw "Preview stopped with exit code $LASTEXITCODE." }
} catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    if (-not $env:INJAZ_NONINTERACTIVE) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

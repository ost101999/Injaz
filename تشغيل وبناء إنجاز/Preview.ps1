$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
try {
    Set-Location -LiteralPath $root
    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\.bin\concurrently.cmd'))) {
        throw 'Dependencies are missing. Open a terminal in the project folder and run npm install.'
    }
    Write-Host 'Starting Injaz preview. Keep this window open while using the app.' -ForegroundColor Cyan
    Write-Host 'Close this window when you finish.'
    & (Join-Path $root 'node_modules\.bin\concurrently.cmd') -k 'npm run dev -- --strictPort' 'npm run compile:electron && npm run electron'
    if ($LASTEXITCODE -ne 0) { throw "Preview stopped with exit code $LASTEXITCODE." }
} catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    if (-not $env:INJAZ_NONINTERACTIVE) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

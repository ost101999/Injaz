$ErrorActionPreference = 'Stop'
$tools = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$root = [IO.Path]::GetFullPath((Split-Path -Parent $tools))
$output = Join-Path $tools 'Build Output'
$id = [Guid]::NewGuid().ToString('N')
$stageRoot = [IO.Path]::GetFullPath((Join-Path $root 'release')).TrimEnd('\')
$stage = Join-Path $stageRoot ('.injaz-build-stage-' + $id)
$backup = Join-Path $tools ('.previous-build-' + $id)
$marker = '.injaz-build-output'

function Assert-SafeTarget([string] $target) {
    $resolved = [IO.Path]::GetFullPath($target)
    $isToolOutput = $resolved.StartsWith($tools + '\', [StringComparison]::OrdinalIgnoreCase)
    $isOurStage = $resolved.Equals([IO.Path]::GetFullPath($stage), [StringComparison]::OrdinalIgnoreCase)
    if (-not $isToolOutput -and -not $isOurStage) {
        throw 'Refusing to modify a path outside the build tools folder.'
    }
    if (Test-Path -LiteralPath $resolved) {
        $item = Get-Item -LiteralPath $resolved -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Refusing to modify a linked build output folder.'
        }
    }
    return $resolved
}

function Remove-SafeDirectory([string] $target) {
    $resolved = Assert-SafeTarget $target
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

try {
    Set-Location -LiteralPath $root
    $builder = Join-Path $root 'node_modules\.bin\electron-builder.cmd'
    if (-not (Test-Path -LiteralPath $builder)) {
        throw 'Dependencies are missing. Open a terminal in the project folder and run npm install.'
    }
    if (-not (Test-Path -LiteralPath $stageRoot)) { New-Item -ItemType Directory -Path $stageRoot | Out-Null }
    foreach ($parent in @($tools, $stageRoot)) {
        if (((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Refusing to use a linked build folder.'
        }
    }
    $null = Assert-SafeTarget $output
    $null = Assert-SafeTarget $stage
    $null = Assert-SafeTarget $backup
    if (Test-Path -LiteralPath $output) {
        if (-not (Test-Path -LiteralPath (Join-Path $output $marker) -PathType Leaf)) {
            throw 'Build Output exists but is not marked as an Injaz build folder. Rename it and try again.'
        }
    }
    Write-Host 'Building the application...' -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed. The previous installer was kept.' }
    & npm.cmd run compile:electron
    if ($LASTEXITCODE -ne 0) { throw 'Electron compilation failed. The previous installer was kept.' }
    New-Item -ItemType Directory -Path $stage | Out-Null
    & $builder --win --publish never "--config.directories.output=$stage"
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed. The previous installer was kept.' }
    $installer = @(Get-ChildItem -LiteralPath $stage -File -Filter '*Setup*.exe')
    if ($installer.Count -ne 1) { throw 'Expected installer was not found. The previous installer was kept.' }
    Set-Content -LiteralPath (Join-Path $stage $marker) -Value 'Generated Injaz build output.' -Encoding ASCII
    if (Test-Path -LiteralPath $output) { Move-Item -LiteralPath $output -Destination $backup }
    try {
        Move-Item -LiteralPath $stage -Destination $output
    } catch {
        if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $output)) {
            Move-Item -LiteralPath $backup -Destination $output
        }
        throw
    }
    Remove-SafeDirectory $backup
    Write-Host "`nBuild completed. The new installer is in: $output" -ForegroundColor Green
    if (-not $env:INJAZ_NO_OPEN) { Invoke-Item -LiteralPath $output }
    if (-not $env:INJAZ_NONINTERACTIVE) { Read-Host 'Press Enter to close' | Out-Null }
} catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    if (Test-Path -LiteralPath $stage) { Remove-SafeDirectory $stage }
    if (-not $env:INJAZ_NONINTERACTIVE) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

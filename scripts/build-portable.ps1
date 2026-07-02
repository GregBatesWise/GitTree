#Requires -Version 5.1
<#
.SYNOPSIS
    Bumps the minor version, builds GitTree, packages Windows executables, installs
    the portable GitTree.exe to the user's Programs folder, and creates a Desktop shortcut.

.DESCRIPTION
    Each run:
      1. Bumps the version in package.json (minor by default: 0.2.0 -> 0.3.0).
      2. Builds the main / preload / renderer bundles with electron-vite.
      3. Packages both the NSIS installer and portable .exe with electron-builder.
      4. Installs the portable GitTree.exe to %LOCALAPPDATA%\Programs\GitTree and
         (re)creates a GitTree.lnk shortcut on the Desktop pointing to it. Any old
         GitTree*.exe copied directly onto the Desktop by previous builds is removed.

    The version bump edits package.json only - it does NOT create a git commit or tag.
    The version is embedded in the executable's file/product version metadata.

.PARAMETER Bump
    Which semver segment to increment: 'major', 'minor' or 'patch' (default).

.EXAMPLE
    ./scripts/build-portable.ps1
    Bumps the minor version, installs to Programs, and refreshes the Desktop shortcut.

.EXAMPLE
    ./scripts/build-portable.ps1 -Bump patch
    Bumps the patch version instead (0.3.0 -> 0.3.1).
#>
[CmdletBinding()]
param(
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump = 'minor'
)

$ErrorActionPreference = 'Stop'

# Repo root is the parent folder of this script (scripts/..).
$repoRoot = Split-Path -Parent $PSScriptRoot
$pkgPath = Join-Path $repoRoot 'package.json'

Push-Location $repoRoot
try {
    if (-not (Test-Path -LiteralPath $pkgPath)) {
        throw "package.json not found at '$pkgPath'."
    }

    $before = (Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json).version
    Write-Host "Current version: $before" -ForegroundColor DarkGray

    Write-Host "==> Bumping $Bump version (package.json only)..." -ForegroundColor Cyan
    npm version $Bump --no-git-tag-version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm version bump failed (exit $LASTEXITCODE)." }

    $version = (Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json).version
    Write-Host "    $before -> $version" -ForegroundColor Green

    Write-Host "==> Building bundles (electron-vite)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Bundle build failed (exit $LASTEXITCODE)." }

    Write-Host "==> Packaging Windows executables (electron-builder)..." -ForegroundColor Cyan
    $electronBuilder = Join-Path $repoRoot 'node_modules\.bin\electron-builder.cmd'
    if (-not (Test-Path -LiteralPath $electronBuilder)) {
        throw "electron-builder not found. Run 'npm install' first."
    }
    & $electronBuilder --win --x64
    if ($LASTEXITCODE -ne 0) { throw "electron-builder packaging failed (exit $LASTEXITCODE)." }

    # The portable artifact is always dist\GitTree.exe (no version in filename).
    $artifact = Join-Path $repoRoot 'dist\GitTree.exe'
    if (-not (Test-Path -LiteralPath $artifact)) {
        throw "Portable exe not found at '$artifact'. Check electron-builder output."
    }

    # Install location: %LOCALAPPDATA%\Programs\GitTree (per-user, no admin needed).
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\GitTree'
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null

    $installedExe = Join-Path $installDir 'GitTree.exe'
    Write-Host "==> Installing to $installedExe" -ForegroundColor Cyan
    Copy-Item -LiteralPath $artifact -Destination $installedExe -Force

    # Remove any legacy GitTree*.exe copies left directly on the Desktop by old builds.
    $desktop = [Environment]::GetFolderPath('Desktop')
    Get-ChildItem -Path $desktop -Filter 'GitTree*.exe' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "==> Removing old Desktop exe: $($_.Name)" -ForegroundColor Cyan
            Remove-Item -LiteralPath $_.FullName -Force
        }

    # Create / refresh a Desktop shortcut pointing at the installed exe.
    $shortcutPath = Join-Path $desktop 'GitTree.lnk'
    Write-Host "==> Creating Desktop shortcut: $shortcutPath" -ForegroundColor Cyan
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedExe
    $shortcut.WorkingDirectory = $installDir
    $shortcut.IconLocation = $installedExe
    $shortcut.Description = "GitTree $version"
    $shortcut.Save()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

    Write-Host ''
    Write-Host "GitTree $version installed." -ForegroundColor Green
    Write-Host "    App:      $installedExe" -ForegroundColor Green
    Write-Host "    Shortcut: $shortcutPath" -ForegroundColor Green
}
finally {
    Pop-Location
}

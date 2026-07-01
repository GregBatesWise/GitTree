#Requires -Version 5.1
<#
.SYNOPSIS
    Bumps the minor version, builds GitTree, packages Windows executables, and
    copies the portable GitTree.exe to the Desktop.

.DESCRIPTION
    Each run:
      1. Bumps the version in package.json (minor by default: 0.2.0 -> 0.3.0).
      2. Builds the main / preload / renderer bundles with electron-vite.
      3. Packages both the NSIS installer and portable .exe with electron-builder.
      4. Replaces any previous GitTree.exe on the Desktop with the new build.

    The version bump edits package.json only - it does NOT create a git commit or tag.
    The version is embedded in the executable's file/product version metadata.

.PARAMETER Bump
    Which semver segment to increment: 'major', 'minor' or 'patch' (default).

.EXAMPLE
    ./scripts/build-portable.ps1
    Bumps the minor version and copies GitTree.exe to the Desktop.

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

    # Replace any previous GitTree exe on the Desktop (including old versioned names).
    $desktop = [Environment]::GetFolderPath('Desktop')
    Get-ChildItem -Path $desktop -Filter 'GitTree*.exe' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "==> Removing old Desktop build: $($_.Name)" -ForegroundColor Cyan
            Remove-Item -LiteralPath $_.FullName -Force
        }

    $dest = Join-Path $desktop 'GitTree.exe'
    Copy-Item -LiteralPath $artifact -Destination $dest -Force

    Write-Host ''
    Write-Host "GitTree $version published to Desktop." -ForegroundColor Green
    Write-Host "    $dest" -ForegroundColor Green
}
finally {
    Pop-Location
}

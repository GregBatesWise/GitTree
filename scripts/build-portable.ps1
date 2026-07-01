#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the GitTree portable Windows executable and publishes it to the Desktop.

.DESCRIPTION
    Each run:
      1. Bumps the version in package.json (minor by default: 0.1.0 -> 0.2.0).
      2. Builds the main / preload / renderer bundles with electron-vite.
      3. Packages a portable .exe with electron-builder.
      4. Removes any previous GitTree portable build from the Desktop and copies
         the freshly built one in its place.

    The version bump edits package.json only - it does NOT create a git commit or tag.

.PARAMETER Bump
    Which semver segment to increment: 'major', 'minor' (default) or 'patch'.

.EXAMPLE
    ./scripts/build-portable.ps1
    Bumps the minor version and publishes GitTree-<new>-portable.exe to the Desktop.

.EXAMPLE
    ./scripts/build-portable.ps1 -Bump patch
    Bumps the patch version instead (0.2.0 -> 0.2.1).
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

    $pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
    $version = $pkg.version
    $product = $pkg.productName
    Write-Host "    $before -> $version" -ForegroundColor Green

    Write-Host "==> Building bundles (electron-vite)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Bundle build failed (exit $LASTEXITCODE)." }

    Write-Host "==> Packaging portable .exe (electron-builder)..." -ForegroundColor Cyan
    $electronBuilder = Join-Path $repoRoot 'node_modules\.bin\electron-builder.cmd'
    if (-not (Test-Path -LiteralPath $electronBuilder)) {
        throw "electron-builder not found. Run 'npm install' first."
    }
    & $electronBuilder --win portable --x64
    if ($LASTEXITCODE -ne 0) { throw "electron-builder packaging failed (exit $LASTEXITCODE)." }

    # Locate the built artifact (dist/GitTree-<version>-portable.exe).
    $artifact = Join-Path $repoRoot "dist\$product-$version-portable.exe"
    if (-not (Test-Path -LiteralPath $artifact)) {
        $newest = Get-ChildItem -Path (Join-Path $repoRoot 'dist') -Filter "$product-*-portable.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($newest) { $artifact = $newest.FullName }
    }
    if (-not (Test-Path -LiteralPath $artifact)) {
        throw "Could not find a portable .exe in '$repoRoot\dist'."
    }

    $desktop = [Environment]::GetFolderPath('Desktop')
    $fileName = Split-Path -Leaf $artifact

    # Remove previous portable builds from the Desktop so only the latest remains.
    $old = Get-ChildItem -Path $desktop -Filter "$product-*-portable.exe" -ErrorAction SilentlyContinue
    foreach ($f in $old) {
        Write-Host "==> Removing previous build from Desktop: $($f.Name)" -ForegroundColor Cyan
        Remove-Item -LiteralPath $f.FullName -Force
    }

    $dest = Join-Path $desktop $fileName
    Copy-Item -LiteralPath $artifact -Destination $dest -Force

    Write-Host ''
    Write-Host "Published $fileName to the Desktop." -ForegroundColor Green
    Write-Host "    $dest" -ForegroundColor Green
}
finally {
    Pop-Location
}

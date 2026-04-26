param(
  [switch]$SkipInstall,
  [switch]$NoCacheClean,
  [switch]$PortableOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Action
}

function Show-ExeOutputs {
  $releaseDir = Join-Path $repoRoot "release"
  if (-not (Test-Path $releaseDir)) {
    Write-Warning "release directory not found."
    return
  }
  $exes = Get-ChildItem -Path $releaseDir -Filter "UI-LLM.exe" -Recurse -ErrorAction SilentlyContinue
  if (-not $exes -or $exes.Count -eq 0) {
    Write-Warning "No UI-LLM.exe found under release."
    return
  }
  Write-Host "EXE outputs:" -ForegroundColor Green
  foreach ($exe in $exes) {
    Write-Host " - $($exe.FullName)" -ForegroundColor Green
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$env:NODE_OPTIONS = "--use-system-ca"
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}

if (-not $NoCacheClean) {
  Invoke-Step "Clean Electron Cache" {
    $cacheDirs = @(
      (Join-Path $env:LOCALAPPDATA "electron\Cache"),
      (Join-Path $env:LOCALAPPDATA "electron-builder\Cache")
    )
    foreach ($dir in $cacheDirs) {
      if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir
      }
    }
  }
}

if (-not $SkipInstall) {
  Invoke-Step "Install Dependencies" {
    npm install
  }
}

Invoke-Step "Build Renderer" {
  npm run build
}

if ($PortableOnly) {
  Invoke-Step "Package Portable" {
    npm run pack:portable
  }
  Show-ExeOutputs
  exit 0
}

try {
  Invoke-Step "Package Installer (NSIS)" {
    npm run pack:win
  }
  Write-Host "Installer package completed. Check release directory." -ForegroundColor Green
  Show-ExeOutputs
} catch {
  Write-Warning "Installer packaging failed, fallback to portable."
  Invoke-Step "Package Portable (Fallback)" {
    npm run pack:portable
  }
  Show-ExeOutputs
}

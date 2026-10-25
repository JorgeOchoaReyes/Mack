# Sets up Lean 4 + Mathlib natively on Windows for Mack.
# Installs elan (the Lean toolchain manager) if missing, creates a Lake
# project with Mathlib, and downloads Mathlib's prebuilt cache (~5 GB) so
# nothing has to compile. Re-running is safe.
param([string]$Workspace = "$env:USERPROFILE\mack-lean")

$ErrorActionPreference = "Stop"

if (-not (Get-Command lake -ErrorAction SilentlyContinue)) {
  Write-Host "Installing elan (Lean toolchain manager)..."
  $installer = Join-Path $env:TEMP "elan-init.ps1"
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1" -OutFile $installer
  & $installer -NoPrompt $true -DefaultToolchain stable
  $env:Path = "$env:USERPROFILE\.elan\bin;$env:Path"
}

if (-not (Test-Path (Join-Path $Workspace "lakefile.toml")) -and -not (Test-Path (Join-Path $Workspace "lakefile.lean"))) {
  $parent = Split-Path $Workspace -Parent
  $name = Split-Path $Workspace -Leaf
  Push-Location $parent
  try { lake +leanprover-community/mathlib4:lean-toolchain new $name math } finally { Pop-Location }
}

Push-Location $Workspace
try {
  Write-Host "Downloading Mathlib's prebuilt cache..."
  lake exe cache get
  Write-Host "Checking that Mathlib imports..."
  Set-Content -Path "MackCheck.lean" -Value "import Mathlib`n#print `"mack: lean ok`""
  lake env lean MackCheck.lean
  Remove-Item MackCheck.lean
} finally { Pop-Location }

Write-Host ""
Write-Host "Done. In Mack's Settings, set the Lean workspace to: $Workspace"

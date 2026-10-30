# Сборка FocusGlass под Windows: git pull -> npm ci -> tauri build -> копирование артефактов.
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1
# Падает с ненулевым кодом, если любой шаг завершился ошибкой.
param(
    [string]$Repo = (Resolve-Path "$PSScriptRoot\..\.."),
    [string]$OutDir = 'C:\FocusGlassApp',
    [switch]$NoPull
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$env:RUSTUP_HOME = 'C:\rust\rustup'
$env:CARGO_HOME = 'C:\rust\cargo'
$env:Path = "C:\git\cmd;C:\node;C:\rust\cargo\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$env:CI = 'true'

function Step([string]$Name, [scriptblock]$Cmd) {
    Write-Host "==> $Name"
    & $Cmd
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Set-Location $Repo
if (-not $NoPull) { Step 'git pull' { git pull --ff-only } }
Step 'git rev' { git log --oneline -1 }
Step 'npm ci' { npm.cmd ci --no-audit --no-fund }
Step 'tauri build' { npx.cmd tauri build }

$exe = Join-Path $Repo 'src-tauri\target\release\focusglass.exe'
$setup = Get-ChildItem (Join-Path $Repo 'src-tauri\target\release\bundle\nsis\*-setup.exe') | Select-Object -First 1
if (-not (Test-Path $exe)) { throw "No exe: $exe" }
if (-not $setup) { throw 'No NSIS installer produced' }

New-Item -ItemType Directory $OutDir -Force | Out-Null
Copy-Item $exe (Join-Path $OutDir 'FocusGlass.exe') -Force
Copy-Item $setup.FullName $OutDir -Force
Get-ChildItem $OutDir | Format-Table Name, Length, LastWriteTime -AutoSize
Write-Host 'BUILD_OK'

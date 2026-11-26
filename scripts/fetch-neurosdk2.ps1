<#
.SYNOPSIS
Downloads the official BrainBit NeuroSDK2 Windows x64 runtime library into
src-tauri/vendor/neurosdk2-x64.dll (gitignored).
#>
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$VendorDir = Join-Path $RepoRoot 'src-tauri\vendor'
$TargetDll = Join-Path $VendorDir 'neurosdk2-x64.dll'
$SourceUrl = 'https://raw.githubusercontent.com/BrainbitLLC/neurosdk2-cpp/main/neurosdk2-x64.dll'
$MinBytes = 1000000

function Assert-ValidPeBinary([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Downloaded DLL not found: $Path"
    }
    $Item = Get-Item $Path
    if ($Item.Length -lt $MinBytes) {
        throw "Invalid neurosdk2-x64.dll size ($($Item.Length) bytes; expected > $MinBytes bytes)."
    }
    $Stream = [System.IO.File]::OpenRead($Path)
    try {
        $B0 = $Stream.ReadByte()
        $B1 = $Stream.ReadByte()
    } finally {
        $Stream.Dispose()
    }
    if ($B0 -ne 0x4D -or $B1 -ne 0x5A) {
        throw "Invalid PE header in $Path (expected MZ magic bytes, got 0x$($B0.ToString('X2')) 0x$($B1.ToString('X2')))."
    }
}

New-Item -ItemType Directory -Path $VendorDir -Force | Out-Null

if ((Test-Path $TargetDll) -and -not $Force) {
    try {
        Assert-ValidPeBinary $TargetDll
        $ExistingSize = (Get-Item $TargetDll).Length
        Write-Host "neurosdk2-x64.dll already present and valid ($ExistingSize bytes): $TargetDll"
        exit 0
    } catch {
        Write-Warning "Existing neurosdk2-x64.dll failed validation ($($_.Exception.Message)); re-downloading..."
    }
}

$TempDll = "$TargetDll.tmp"
if (Test-Path $TempDll) {
    Remove-Item $TempDll -Force
}

Write-Host "Downloading $SourceUrl -> $TargetDll"
Invoke-WebRequest -Uri $SourceUrl -OutFile $TempDll -UseBasicParsing
try {
    Assert-ValidPeBinary $TempDll
    Move-Item -Path $TempDll -Destination $TargetDll -Force
} catch {
    if (Test-Path $TempDll) {
        Remove-Item $TempDll -Force
    }
    throw
}

$FinalSize = (Get-Item $TargetDll).Length
Write-Host "Successfully verified neurosdk2-x64.dll ($FinalSize bytes) at $TargetDll"

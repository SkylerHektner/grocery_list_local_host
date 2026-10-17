<#
.SYNOPSIS
  Runs every project check in order and stops at the first failure.
.DESCRIPTION
  cargo fmt --check, cargo clippy (-D warnings), cargo test, node unit tests, Playwright e2e.
  Exit code 0 = all green; non-zero = the first failing step's exit code (or 1).
.PARAMETER Quick
  Skip the Playwright e2e step.
.EXAMPLE
  pwsh -File scripts/check.ps1
  pwsh -File scripts/check.ps1 -Quick
#>
param([switch]$Quick)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$onWindows = $env:OS -eq 'Windows_NT'
$npm = if ($onWindows) { 'npm.cmd' } else { 'npm' }
$results = [System.Collections.Generic.List[string]]::new()

function Write-Summary([string]$status) {
    Write-Host ''
    Write-Host '==== check summary ===='
    foreach ($line in $results) { Write-Host $line }
    $color = if ($status -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host "OVERALL: $status" -ForegroundColor $color
}

function Invoke-Step([string]$name, [string]$dir, [scriptblock]$command) {
    Write-Host ''
    Write-Host "==> $name" -ForegroundColor Cyan
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $dir
    try {
        $global:LASTEXITCODE = 0
        & $command
        $code = $LASTEXITCODE
    } catch {
        Write-Host $_ -ForegroundColor Red
        $code = 1
    } finally {
        Pop-Location
    }
    $secs = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    if ($code -ne 0) {
        $results.Add("FAIL  $name  (${secs}s, exit $code)")
        Write-Summary 'FAIL'
        exit $code
    }
    $results.Add("PASS  $name  (${secs}s)")
}

$e2e = Join-Path $root 'e2e'

Invoke-Step 'cargo fmt --check' $root { cargo fmt --check }
Invoke-Step 'cargo clippy --all-targets -- -D warnings' $root { cargo clippy --all-targets -- -D warnings }
Invoke-Step 'cargo test' $root { cargo test }
Invoke-Step 'node --test (public/js)' $root { node --test 'public/js/**/*.test.js' }

if ($Quick) {
    $results.Add('SKIP  playwright e2e  (-Quick)')
} else {
    if (-not (Test-Path (Join-Path $e2e 'node_modules'))) {
        Invoke-Step 'npm ci (e2e)' $e2e { & $npm ci --no-fund --no-audit }
    }
    Invoke-Step 'playwright e2e (npm test)' $e2e { & $npm test }
}

Write-Summary 'PASS'
exit 0

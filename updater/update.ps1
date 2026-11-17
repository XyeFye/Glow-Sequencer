# Glow Theme for Online Sequencer - updater.
# Checks the GitHub repo named in ..\update.json and, when it has a newer version, copies it into this extension folder.
# Glow Theme notices the new files within a minute or two and reloads itself into them; your settings and Sequence
# library stay (they belong to the extension in Opera, not to these files). Run every hour by the task that
# "Install auto-updates.cmd" sets up. A short log is kept in updater\update.log.
$ErrorActionPreference = "Stop"
$ext = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot "update.log"
function Say($t) { $line = "{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $t; Add-Content -Path $log -Value $line; $all = Get-Content $log; if ($all.Count -gt 60) { $all | Select-Object -Last 60 | Set-Content $log } }
try {
  $cfg = Get-Content (Join-Path $ext "update.json") -Raw | ConvertFrom-Json
  if (-not $cfg.repo -or $cfg.channel -ne "github") { exit 0 }
  $branch = if ($cfg.branch) { $cfg.branch } else { "main" }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $here = (Get-Content (Join-Path $ext "manifest.json") -Raw | ConvertFrom-Json).version
  $there = ((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/$($cfg.repo)/$branch/manifest.json?t=$([DateTimeOffset]::Now.ToUnixTimeSeconds())").Content | ConvertFrom-Json).version
  if ([version]$there -le [version]$here) { exit 0 }
  $tmp = Join-Path $env:TEMP "glow-theme-update"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp "update.zip"
  Invoke-WebRequest -UseBasicParsing "https://github.com/$($cfg.repo)/archive/refs/heads/$branch.zip" -OutFile $zip
  Expand-Archive $zip (Join-Path $tmp "x") -Force
  $src = Get-ChildItem (Join-Path $tmp "x") -Directory | Select-Object -First 1
  if (-not (Test-Path (Join-Path $src.FullName "manifest.json"))) { throw "the download has no manifest.json" }
  # everything except the manifest first, then the manifest last: Glow Theme reloads only once the new manifest is in place
  Get-ChildItem $src.FullName -Recurse -File | Where-Object { $_.Name -ne "manifest.json" -or $_.DirectoryName -ne $src.FullName } | ForEach-Object {
    $rel = $_.FullName.Substring($src.FullName.Length + 1); $to = Join-Path $ext $rel
    New-Item -ItemType Directory -Force (Split-Path -Parent $to) | Out-Null
    Copy-Item $_.FullName $to -Force
  }
  Copy-Item (Join-Path $src.FullName "manifest.json") (Join-Path $ext "manifest.json") -Force
  Remove-Item $tmp -Recurse -Force
  Say "updated $here -> $there"
} catch { Say ("couldn't update: " + $_.Exception.Message) }

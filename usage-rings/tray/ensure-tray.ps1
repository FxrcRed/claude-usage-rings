# Windows only. Makes sure the tray icon is installed, running and set to start at login. Safe to run repeatedly.
$ErrorActionPreference = 'SilentlyContinue'
$pyw = (Get-Command pythonw).Source
if (-not $pyw) { exit 0 }
$py = Join-Path (Split-Path $pyw) 'python.exe'

& $py -c "import pystray, PIL" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $py -m pip install -q -r (Join-Path $PSScriptRoot 'requirements.txt') 2>$null
    if ($LASTEXITCODE -ne 0) { exit 0 }
}

# Run from a copy outside the plugin folder: a process working in the plugin cache keeps Windows from replacing it,
# so plugin updates and reinstalls failed with EPERM.
$dir = Join-Path $env:USERPROFILE '.claude\usage-rings-tray'
$tray = Join-Path $dir 'tray.py'
$src = Join-Path $PSScriptRoot 'tray.py'
New-Item -ItemType Directory -Force $dir | Out-Null
$changed = -not (Test-Path $tray) -or (Get-FileHash $src).Hash -ne (Get-FileHash $tray).Hash
if ($changed) { Copy-Item $src $tray -Force }

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'ClaudeTray.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $pyw
$sc.Arguments = "`"$tray`""
$sc.WorkingDirectory = $dir
$sc.Save()

# Stop icons started from the plugin folder by older versions, or running an outdated copy.
# Only this plugin's icon: its copy, or tray.py under a usage-rings / usage-band (old name) plugin folder.
$running = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.CommandLine -match 'usage-(rings|band)[^"]*[\\/]tray\.py' })
$stale = $running | Where-Object { $changed -or -not $_.CommandLine.Contains($tray) }
$stale | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if ($running.Count -eq @($stale).Count) {
    Start-Sleep -Milliseconds 500
    Start-Process $pyw -ArgumentList "`"$tray`"" -WorkingDirectory $dir -WindowStyle Hidden
}

# Windows only. Makes sure the tray icon is installed, running and set to start at login. Safe to run repeatedly.
$ErrorActionPreference = 'SilentlyContinue'
$tray = Join-Path $PSScriptRoot 'tray.py'
$pyw = (Get-Command pythonw).Source
if (-not $pyw) { exit 0 }
$py = Join-Path (Split-Path $pyw) 'python.exe'

& $py -c "import pystray, PIL" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $py -m pip install -q -r (Join-Path $PSScriptRoot 'requirements.txt') 2>$null
    if ($LASTEXITCODE -ne 0) { exit 0 }
}

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'ClaudeTray.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $pyw
$sc.Arguments = "`"$tray`""
$sc.WorkingDirectory = $PSScriptRoot
$sc.Save()

$running = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.CommandLine -match 'tray\.py' }
if (-not $running) { Start-Process $pyw -ArgumentList "`"$tray`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden }

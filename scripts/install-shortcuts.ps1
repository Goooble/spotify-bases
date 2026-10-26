param([string]$DesktopPath = [Environment]::GetFolderPath('Desktop'))

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $PSScriptRoot 'launcher.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
    throw "Desktop folder does not exist: $DesktopPath"
}
$shell = New-Object -ComObject WScript.Shell
$entries = @(
    @{ Name = 'Spotify Bases'; Action = 'Start'; Icon = 138; Description = 'Start Spotify Bases and open it in your default browser' },
    @{ Name = 'Stop Spotify Bases'; Action = 'Stop'; Icon = 131; Description = 'Stop the local Spotify Bases server started by the launcher' }
)
# Check both names before writing either shortcut; preserve unrelated shortcuts.
foreach ($entry in $entries) {
    $path = Join-Path $DesktopPath ($entry.Name + '.lnk')
    if (Test-Path -LiteralPath $path) {
        $existing = $shell.CreateShortcut($path)
        if ($existing.TargetPath -ne $powershell -or -not $existing.Arguments.Contains('"' + $launcher + '"')) {
            throw "A different shortcut already exists at $path. Rename it before installing Spotify Bases shortcuts."
        }
    }
}
foreach ($entry in $entries) {
    $path = Join-Path $DesktopPath ($entry.Name + '.lnk')
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '" -Action ' + $entry.Action
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $entry.Description
    $shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',' + $entry.Icon
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Output "Created $path"
}

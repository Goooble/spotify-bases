param(
    [ValidateSet('Start', 'Stop')]
    [string]$Action = 'Start',
    [ValidateRange(1024, 65535)]
    [int]$Port = 5173,
    [switch]$NoBrowser,
    [switch]$NoDialogs
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $projectRoot '.runtime'
$statePath = Join-Path $runtimeDirectory "server-$Port.json"
$vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$url = "http://127.0.0.1:$Port"

function Test-AppReady {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('<title>Spotify Bases</title>')
    } catch {
        return $false
    }
}

function Get-ManagedServer {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($state.projectRoot -ne $projectRoot) { return $null }
        $server = Get-Process -Id $state.processId -ErrorAction Stop
        if ($server.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startedTicks) { return $null }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($server.Id)"
        if ($details.Name -ne 'node.exe' -or -not $details.CommandLine.Contains('"' + $vitePath + '"')) {
            return $null
        }
        return $server
    } catch {
        return $null
    }
}

function Open-App {
    if (-not $NoBrowser) { Start-Process -FilePath $url }
    Write-Output "Spotify Bases is ready at $url"
}

$mutex = $null
$lockHeld = $false
try {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '')
    } finally {
        $hasher.Dispose()
    }
    $mutex = New-Object Threading.Mutex($false, "Local\SpotifyBases-$hash-$Port")
    try { $lockHeld = $mutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { throw 'Another Spotify Bases launcher is busy. Try again in a moment.' }

    $server = Get-ManagedServer
    if ($Action -eq 'Stop') {
        if ($server) {
            Stop-Process -Id $server.Id
            if (-not $server.WaitForExit(10000)) { throw 'The local server has not stopped yet. Try again.' }
            Write-Output 'Spotify Bases stopped. You can close its browser tab.'
        } elseif (Test-AppReady) {
            throw 'Spotify Bases was started outside this launcher. Close its terminal to stop it; other processes will not be stopped.'
        } else {
            Write-Output 'Spotify Bases is already stopped.'
        }
        if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    } else {
        if (Test-AppReady) {
            Open-App
        } else {
            if (-not (Test-Path -LiteralPath $vitePath)) {
                throw 'Dependencies are missing. Run npm.cmd ci in the Spotify Bases folder, then launch again.'
            }
            if (-not $server) {
                $probe = New-Object Net.Sockets.TcpClient
                try {
                    $connecting = $probe.ConnectAsync('127.0.0.1', $Port)
                    try { $portInUse = $connecting.Wait(500) -and $probe.Connected } catch { $portInUse = $false }
                } finally { $probe.Dispose() }
                if ($portInUse) { throw "Port $Port is already being used by another application. Close that application and try again." }
                $node = (Get-Command node.exe -ErrorAction Stop).Source
                New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
                $server = Start-Process -FilePath $node -ArgumentList ('"' + $vitePath + '" --host 127.0.0.1 --port ' + $Port + ' --strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory "server-$Port.log") -RedirectStandardError (Join-Path $runtimeDirectory "server-$Port-error.log")
                @{
                    projectRoot = $projectRoot
                    processId = $server.Id
                    startedTicks = $server.StartTime.ToUniversalTime().Ticks.ToString()
                } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
            }
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            while (-not (Test-AppReady)) {
                $server.Refresh()
                if ($server.HasExited) { throw "Spotify Bases could not start. See $runtimeDirectory\server-$Port-error.log for details." }
                if ([DateTime]::UtcNow -ge $deadline) { throw "Spotify Bases took too long to start. Check $runtimeDirectory\server-$Port-error.log, or use the Stop shortcut and try again." }
                Start-Sleep -Milliseconds 250
            }
            Open-App
        }
    }
} catch {
    $message = $_.Exception.Message
    if (-not $NoDialogs) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($message, 'Spotify Bases', 'OK', 'Error') | Out-Null
    }
    Write-Error $message -ErrorAction Continue
    exit 1
} finally {
    if ($lockHeld) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}

[CmdletBinding()]
param([string]$WorkRoot,[switch]$WithService,[switch]$UsePackageCache)
$ErrorActionPreference='Stop'
if(-not $WorkRoot){$WorkRoot=Join-Path $PSScriptRoot '..\outputs\native-codex-probe'}
$WorkRoot=[IO.Path]::GetFullPath($WorkRoot)
$repoRoot=Split-Path $PSScriptRoot -Parent
$package=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1
$executable=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
$bridgeRoot=Join-Path $WorkRoot 'bridge'
& (Join-Path $PSScriptRoot 'Build-Native.ps1') -OutputRoot $bridgeRoot|Out-Null
@{executablePath=$executable;launchDaemon=[bool]$WithService;stateRoot=(Join-Path $WorkRoot 'state');nodePath=(Get-Command node).Source;servicePath=(Join-Path $repoRoot 'service.mjs');daemonPath=(Join-Path $repoRoot 'daemon.mjs')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $bridgeRoot 'bridge-config.json') -Encoding utf8
Add-Type -Path (Join-Path $repoRoot 'tests\native-process.cs')
$environment=[Environment]::GetEnvironmentVariables()
$environment['CODEX_ELECTRON_USER_DATA_PATH']=Join-Path $WorkRoot 'electron'
$environment['CODEX_HOME']=Join-Path $WorkRoot 'codex'
$environment['CODEX_PANEL_STATE_DIR']=Join-Path $WorkRoot 'state'
$environment['CODEX_PANEL_DISABLE_ACCOUNT']='1'
$env:CODEX_HOME=Join-Path $WorkRoot 'codex'
$env:CODEX_PANEL_DISABLE_ACCOUNT='1'
$block=[string]::Join("`0",@($environment.Keys|Sort-Object|ForEach-Object {$_+'='+$environment[$_]}))+"`0`0"
$profile=Join-Path $WorkRoot 'web'
if($UsePackageCache){$profile=Join-Path $env:LOCALAPPDATA ("Packages\$($package.PackageFamilyName)\LocalCache\Roaming\CodexContextPanel-Probe\"+[guid]::NewGuid().ToString('N'))}
$command='"'+$executable+'" "--user-data-dir='+$profile+'" --no-first-run --no-startup-window'
$target=[PanelFixtureProcess]::Start($executable,$command,$block)
try{
  $helper=Start-Process -FilePath (Join-Path $bridgeRoot 'StartupBridge.exe') -ArgumentList @('-p',"$($target.pid)",'-tid',"$($target.tid)") -WindowStyle Hidden -PassThru
  if(-not $helper.WaitForExit(5000)){throw 'Startup helper timeout'}
  $portFile=Join-Path $profile 'DevToolsActivePort'
  $verified=$false
  for($attempt=0;$attempt -lt 70;$attempt++){
    if(Test-Path -LiteralPath $portFile){
      try{
        $port=[int]((Get-Content -LiteralPath $portFile -Raw).Split("`n")[0])
        $response=Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2 -UseBasicParsing
        $targets=$response.Content|ConvertFrom-Json
        if(@($targets|Where-Object {$_.url -match '^app://(-|codex)/index\.html'}).Count){
          [PSCustomObject]@{nativeCodex='PASS';pid=$target.pid;port=$port;profile=$profile;httpStatus=$response.StatusCode;explicitDebugArgument=$false;startup=(Get-Content -LiteralPath (Join-Path $WorkRoot 'state\startup-status.json') -Raw|ConvertFrom-Json)}|ConvertTo-Json -Depth 5
          $verified=$true;break
        }
      }catch{}
    }
    if([PanelFixtureProcess]::WaitForSingleObject($target.process,0) -eq 0){$exitCode=[uint32]0;[void][PanelFixtureProcess]::GetExitCodeProcess($target.process,[ref]$exitCode);throw ('Isolated Codex exited: 0x'+$exitCode.ToString('X8'))}
    Start-Sleep -Milliseconds 200
  }
  if(-not $verified){throw 'Isolated Codex did not expose the expected local endpoint'}
  if($WithService){
    $connected=$false
    for($attempt=0;$attempt -lt 50;$attempt++){
      try{$status=Get-Content -LiteralPath (Join-Path $WorkRoot 'state\status.json') -Raw -Encoding UTF8|ConvertFrom-Json;if($status.phase -eq 'connected' -and $status.ownerPid -eq $target.pid){$connected=$true;break}}catch{}
      Start-Sleep -Milliseconds 200
    }
    if(-not $connected){throw 'Native startup did not connect its panel service'}
    Write-Output ('native service: PASS; owner='+$status.ownerPid+'; service='+$status.pid)
  }
}finally{
  if([PanelFixtureProcess]::WaitForSingleObject($target.process,0) -ne 0){[void][PanelFixtureProcess]::TerminateProcess($target.process,0);[void][PanelFixtureProcess]::WaitForSingleObject($target.process,2000)}
  [void][PanelFixtureProcess]::CloseHandle($target.thread);[void][PanelFixtureProcess]::CloseHandle($target.process)
}
if($WithService){
  for($attempt=0;$attempt -lt 30;$attempt++){
    $status=Get-Content -LiteralPath (Join-Path $WorkRoot 'state\status.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($status.phase -eq 'stopped'){Write-Output 'native service shutdown with owner: PASS';break}
    Start-Sleep -Milliseconds 100
  }
  if($status.phase -ne 'stopped'){throw 'Panel service remained active after its owner exited'}
}

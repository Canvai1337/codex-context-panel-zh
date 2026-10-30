param([string]$WorkRoot)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$env:CODEX_PANEL_STATE_DIR=Join-Path $WorkRoot 'state'
$bridgeRoot=Join-Path $WorkRoot 'bridge'
& (Join-Path $repoRoot '.code\Build-Native.ps1') -OutputRoot $bridgeRoot | Out-Null
$fixture=Join-Path $WorkRoot 'fixture.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Web.Extensions.dll "/out:$fixture" (Join-Path $PSScriptRoot 'native-fixture.cs')
if($LASTEXITCODE -ne 0){throw 'fixture build failed'}
Add-Type -Path (Join-Path $PSScriptRoot 'native-process.cs')
foreach($scenario in @('wrong-target','renderer','existing-port','missing-config','normal')){
  $result=Join-Path $WorkRoot ($scenario+'.json')
  $config=@{executablePath=$fixture;launchDaemon=$false;stateRoot=(Join-Path $WorkRoot 'state')}
  if($scenario -eq 'wrong-target'){$config.executablePath=Join-Path $WorkRoot 'other.exe'}
  $configPath=Join-Path $bridgeRoot 'bridge-config.json'
  if($scenario -eq 'missing-config'){Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue}else{$config|ConvertTo-Json|Set-Content -LiteralPath $configPath -Encoding utf8}
  $extra=if($scenario -eq 'renderer'){' --type=renderer'}elseif($scenario -eq 'existing-port'){' --remote-debugging-port=12345'}else{''}
  $command='"'+$fixture+'" "'+$result+'" "spaced argument" "unicode: '+[char]0x4e2d+[char]0x6587+'"'+$extra
  $target=[PanelFixtureProcess]::Start($fixture,$command)
  try{
    $helper=Start-Process -FilePath (Join-Path $bridgeRoot 'StartupBridge.exe') -ArgumentList @('-p',"$($target.pid)",'-tid',"$($target.tid)") -WindowStyle Hidden -PassThru
    if(-not $helper.WaitForExit(5000)){throw 'bridge did not exit promptly'}
    if([PanelFixtureProcess]::WaitForSingleObject($target.process,5000) -ne 0){throw "target did not resume: $scenario"}
    if(-not (Test-Path -LiteralPath $result)){$exitCode=[uint32]0;[void][PanelFixtureProcess]::GetExitCodeProcess($target.process,[ref]$exitCode);throw ('fixture did not write result; helper='+$helper.ExitCode+'; target=0x'+$exitCode.ToString('X8')+'; command='+$command)}
    $observed=Get-Content -LiteralPath $result -Raw -Encoding UTF8|ConvertFrom-Json
    if($observed.args[2] -ne 'spaced argument' -or $observed.args[3] -ne ('unicode: '+[char]0x4e2d+[char]0x6587)){throw 'original arguments changed'}
    if($scenario -eq 'normal'){
      if($observed.args -notcontains '--remote-debugging-port=0' -or $observed.args -notcontains '--remote-debugging-address=127.0.0.1'){throw 'debug flags were not appended'}
    }elseif($observed.command -ne $command){throw "fail-open changed original command: $scenario"}
    Write-Output "native scenario passed: $scenario"
  }finally{
    if([PanelFixtureProcess]::WaitForSingleObject($target.process,0) -ne 0){[void][PanelFixtureProcess]::TerminateProcess($target.process,1)}
    [void][PanelFixtureProcess]::CloseHandle($target.thread);[void][PanelFixtureProcess]::CloseHandle($target.process)
  }
}
Write-Output 'native startup: 5 isolated launch/argument/fail-open scenarios passed'

# Exercise the real service entrypoint as well as command-line patching.
$serviceState=Join-Path $WorkRoot 'service-state'
$env:CODEX_PANEL_DISABLE_ACCOUNT='1'
$env:CODEX_HOME=Join-Path $WorkRoot 'codex-data'
@{executablePath=$fixture;launchDaemon=$true;stateRoot=$serviceState;userDataDirectory=(Join-Path $WorkRoot 'profile');nodePath=(Get-Command node).Source;servicePath=(Join-Path $repoRoot 'service.mjs')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $bridgeRoot 'bridge-config.json') -Encoding utf8
$target=[PanelFixtureProcess]::Start($fixture,('"'+$fixture+'" "'+(Join-Path $WorkRoot 'service-fixture.json')+'" --fixture-hold'))
$service=$null
try{
  $helper=Start-Process -FilePath (Join-Path $bridgeRoot 'StartupBridge.exe') -ArgumentList @('-p',"$($target.pid)",'-tid',"$($target.tid)") -WindowStyle Hidden -PassThru
  if(-not $helper.WaitForExit(5000)){throw 'service bridge did not exit'}
  $status=$null
  for($attempt=0;$attempt -lt 80;$attempt++){
    try{$status=Get-Content -LiteralPath (Join-Path $serviceState 'status.json') -Raw -Encoding UTF8|ConvertFrom-Json}catch{}
    if($status.supervisorPid -and $status.ownerPid -eq $target.pid){break}
    Start-Sleep -Milliseconds 100
  }
  if(-not $status.supervisorPid -or $status.ownerPid -ne $target.pid){throw 'bridge did not launch supervised background'}
  $service=Get-Process -Id $status.supervisorPid -ErrorAction Stop
  [void][PanelFixtureProcess]::TerminateProcess($target.process,0)
  if(-not $service.WaitForExit(7000)){throw 'supervised background did not exit with owner'}
  $final=Get-Content -LiteralPath (Join-Path $serviceState 'service-status.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($final.phase -ne 'stopped'){throw 'service did not record shutdown'}
  Write-Output 'native startup: supervised service launch and owner shutdown passed'
}finally{
  if([PanelFixtureProcess]::WaitForSingleObject($target.process,0) -ne 0){[void][PanelFixtureProcess]::TerminateProcess($target.process,1)}
  if($service -and -not $service.HasExited){& "$env:WINDIR\System32\taskkill.exe" /PID $service.Id /T /F 2>$null|Out-Null}
  [void][PanelFixtureProcess]::CloseHandle($target.thread);[void][PanelFixtureProcess]::CloseHandle($target.process)
}

[CmdletBinding()]
param([string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel\1.6.3'),[Alias('SkipShortcut')][switch]$SkipIntegration)
$ErrorActionPreference='Stop'
$nodePath=(Get-Command node -ErrorAction Stop).Source
$cliPath=(Get-Command codex -ErrorAction Stop).Source
$nodeMajor=[int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 22){throw '需要 Node.js 22 或更新版本'}
$running=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.CommandLine -notmatch '--type='}|Select-Object -First 1
$desktopPath=if($running){$running.ExecutablePath}else{''}
New-Item -ItemType Directory -Force -Path $InstallRoot|Out-Null
$files=@('data.mjs','account.mjs','usage.mjs','widget.js','cdp.mjs','daemon.mjs','service.mjs','runtime.mjs','Start.ps1','Launch.vbs','Shortcuts.ps1','NativeStartup.ps1','Recover-NativeStartup.ps1','Uninstall.ps1','使用说明.md','THIRD-PARTY-NOTICES.txt','LICENSE')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $InstallRoot $file) -Force}
$bridge=Join-Path $PSScriptRoot 'StartupBridge.exe'
if(-not (Test-Path -LiteralPath $bridge)){$bridge=& (Join-Path $PSScriptRoot '.code\Build-Native.ps1')}
Copy-Item -LiteralPath $bridge -Destination (Join-Path $InstallRoot 'StartupBridge.exe') -Force
@{version='1.6.3';startupMode='native';nodePath=$nodePath;cliPath=$cliPath;desktopPath=$desktopPath}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $InstallRoot 'install-config.json') -Encoding utf8
if(-not $SkipIntegration){
  . (Join-Path $InstallRoot 'NativeStartup.ps1')
  Enable-PanelNativeStartup $InstallRoot
  . (Join-Path $PSScriptRoot 'Shortcuts.ps1')
  $stateRoot=Get-PanelStateRoot
  $shortcutRecord=Join-Path $stateRoot 'shortcut-backups.json'
  $restored=@()
  if(Test-Path -LiteralPath $shortcutRecord){
    $records=Get-Content -LiteralPath $shortcutRecord -Raw|ConvertFrom-Json
    foreach($record in $records){
      if(Test-Path -LiteralPath $record.backup){$restored+=[PSCustomObject]@{path=$record.path;sha256=(Get-FileHash -LiteralPath $record.backup -Algorithm SHA256).Hash}}
      Restore-PanelShortcuts -InstallRoot $record.installRoot -StateRoot $stateRoot
    }
    if($restored.Count){Write-PanelJson (Join-Path $stateRoot 'restored-shortcuts.json') $restored}
  }
  $shell=New-Object -ComObject WScript.Shell
  foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
    $path=Join-Path $folder 'Codex 上下文面板.lnk'
    if(Test-Path -LiteralPath $path){
      $link=$shell.CreateShortcut($path)
      if($link.Arguments -match 'Programs\\CodexContextPanel\\.+\\Launch\.vbs'){$link.Arguments='"'+(Join-Path $InstallRoot 'Launch.vbs')+'"';$link.WorkingDirectory=$InstallRoot;$link.Save()}
    }
  }
  $panelRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel'))+[IO.Path]::DirectorySeparatorChar
  Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($panelRoot) -and $_.CommandLine -match '(service|daemon)\.mjs'}|Sort-Object @{Expression={if($_.CommandLine -match 'service\.mjs'){0}else{1}}}|ForEach-Object {
    $daemonId=$_.ProcessId
    if(Get-Process -Id $daemonId -ErrorAction SilentlyContinue){Start-Process -FilePath "$env:WINDIR\System32\taskkill.exe" -ArgumentList @('/PID',"$daemonId",'/T','/F') -WindowStyle Hidden -Wait|Out-Null}
  }
  & (Join-Path $InstallRoot 'Start.ps1') -NoMessage -NoActivate
}
Write-Output "已安装：$InstallRoot"

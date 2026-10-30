[CmdletBinding()]
param([switch]$NoMessage)
$ErrorActionPreference='Stop'
$stateRoot=Join-Path $env:LOCALAPPDATA 'CodexContextPanel'
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-config.json') -Raw | ConvertFrom-Json
$nodePath=$config.nodePath
if($config.cliPath -and (Test-Path -LiteralPath $config.cliPath)){$env:CODEX_PANEL_CLI=$config.cliPath}else{$cliCommand=Get-Command codex -ErrorAction SilentlyContinue;if($cliCommand){$env:CODEX_PANEL_CLI=$cliCommand.Source}}
if(-not (Test-Path -LiteralPath $nodePath)){ $nodePath=(Get-Command node -ErrorAction Stop).Source }
$mutex=[Threading.Mutex]::new($false,'Local\BossCodexContextPanelLauncher')
$locked=$false
function Show-Notice([string]$Message){
  [IO.File]::WriteAllText((Join-Path $stateRoot 'launcher-message.txt'),$Message,[Text.UTF8Encoding]::new($false))
  if(-not $NoMessage){Add-Type -AssemblyName PresentationFramework;[void][System.Windows.MessageBox]::Show($Message,'Codex 上下文面板')}
}
function Test-PanelPort([int]$Port){
  try{
    $targets=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
    return @($targets|Where-Object {$_.type -eq 'page' -and $_.url -match '^app://(-|codex)/index\.html'}).Count -gt 0
  }catch{return $false}
}
try{
  $locked=$mutex.WaitOne(0)
  if(-not $locked){return}
  New-Item -ItemType Directory -Force -Path $stateRoot|Out-Null
  $runtimePath=Join-Path $stateRoot 'runtime.json'
  $runtime=$null
  if(Test-Path -LiteralPath $runtimePath){try{$runtime=Get-Content -LiteralPath $runtimePath -Raw|ConvertFrom-Json}catch{}}
  $activePort=0
  if($runtime -and (Test-PanelPort $runtime.port)){$activePort=[int]$runtime.port}
  if(-not $activePort){
    $running=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {$_.CommandLine -notmatch '--type='})
    foreach($process in $running){if($process.CommandLine -match '--remote-debugging-port=(\d+)'){if(Test-PanelPort ([int]$Matches[1])){$activePort=[int]$Matches[1];break}}}
    if(-not $activePort -and $running.Count){
      Show-Notice '当前 Codex 没有开放本机面板接入端口。请先保存工作并正常退出 Codex，再双击“Codex 上下文面板”。面板不会强制关闭或重启你的聊天。'
      return
    }
  }
  if(-not $activePort){
    foreach($candidate in 9340..9371){
      $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$candidate)
      try{$listener.Server.ExclusiveAddressUse=$true;$listener.Start();$activePort=$candidate;break}catch{}finally{$listener.Stop()}
    }
    if(-not $activePort){throw '没有可用的本机端口'}
    $package=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    $launchArgs="--remote-debugging-port=$activePort --remote-debugging-address=127.0.0.1 --remote-allow-origins=http://127.0.0.1:$activePort"
    if($package){
      $manifest=[xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
      $application=@($manifest.Package.Applications.Application)|Where-Object {$_.Executable -match 'ChatGPT\.exe$'}|Select-Object -First 1
      if(-not $application){throw '无法确定 Store 应用入口'}
      if(-not ('BossContextActivation.Launcher' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace BossContextActivation {
 [ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IActivation { [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,[MarshalAs(UnmanagedType.LPWStr)] string args,int options,out uint pid); }
 [ComImport,Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class Activation {}
 public static class Launcher {public static uint Start(string id,string args){uint pid;var result=((IActivation)new Activation()).ActivateApplication(id,args,2,out pid);Marshal.ThrowExceptionForHR(result);return pid;}}
}
'@}
      [void][BossContextActivation.Launcher]::Start("$($package.PackageFamilyName)!$($application.Id)",$launchArgs)
    }else{
      $desktopPath=$config.desktopPath
      if(-not (Test-Path -LiteralPath $desktopPath)){throw '未找到 Codex 应用，请重新安装面板以发现应用路径'}
      Start-Process -FilePath $desktopPath -ArgumentList $launchArgs -WindowStyle Normal|Out-Null
    }
  }
  # Reuse only a daemon launched from this exact installed path and port.
  $daemon=Join-Path $PSScriptRoot 'daemon.mjs'
  $owned=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($daemon) -and $_.CommandLine -match "--port $activePort(?:\s|$)"})
  if(-not $owned.Count){
    $log=Join-Path $stateRoot 'daemon.log';$err=Join-Path $stateRoot 'daemon-error.log'
    $process=Start-Process -FilePath $nodePath -ArgumentList @("`"$daemon`"",'--port',"$activePort") -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
    $daemonId=$process.Id
  }else{$daemonId=$owned[0].ProcessId}
  @{port=$activePort;daemonPid=$daemonId;installRoot=$PSScriptRoot;startedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $runtimePath -Encoding utf8
}catch{Show-Notice ('启动失败：'+$_.Exception.Message);throw}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}

[CmdletBinding()]
param([switch]$NoMessage,[switch]$NoActivate)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'NativeStartup.ps1')
$stateRoot=Get-PanelStateRoot
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$mutex=[Threading.Mutex]::new($false,'Local\BossCodexContextPanelLauncher')
$locked=$false
function Get-PanelProcess([string]$Executable){
  Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" |
    Where-Object {$_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -eq $Executable} |
    Sort-Object CreationDate | Select-Object -First 1
}
function Get-PanelPort([string]$PortFile,$ApplicationProcess){
  if(-not $ApplicationProcess){return 0}
  $port=0
  if($ApplicationProcess.CommandLine -match '--remote-debugging-port=(\d+)'){$port=[int]$Matches[1]}
  if(-not $port -and (Test-Path -LiteralPath $PortFile)){
    $lines=@(Get-Content -LiteralPath $PortFile -TotalCount 2 -ErrorAction SilentlyContinue)
    if($lines.Count -eq 2 -and $lines[1] -match '^/devtools/browser/[\w-]+$'){[void][int]::TryParse($lines[0],[ref]$port)}
  }
  if($port -lt 1024 -or $port -gt 65535){return 0}
  # Old Chromium port files survive an update. Only use a loopback listener
  # owned by the current application, never a recycled port from the old PID.
  $listener=Get-NetTCPConnection -State Listen -LocalPort $port -OwningProcess $ApplicationProcess.ProcessId -ErrorAction SilentlyContinue |
    Where-Object LocalAddress -eq '127.0.0.1'
  if($listener){return $port}
  return 0
}
try{
  $locked=$mutex.WaitOne(0);if(-not $locked){return}
  $package=Get-PanelPackage
  $executable=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  $applicationProcess=Get-PanelProcess $executable
  $coldStart=-not $applicationProcess
  if(-not $NoActivate){
    Enable-PanelNativeStartup $PSScriptRoot -NoMaintenance
    $manifest=[xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
    $application=@($manifest.Package.Applications.Application)|Where-Object {$_.Executable -match 'ChatGPT\.exe$'}|Select-Object -First 1
    if(-not ('PanelActivation.Launcher' -as [type])){Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace PanelActivation {
 [ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IActivation { [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,[MarshalAs(UnmanagedType.LPWStr)] string args,int options,out uint pid); }
 [ComImport,Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class Activation {}
 public static class Launcher {public static void Start(string id,string args){uint pid;Marshal.ThrowExceptionForHR(((IActivation)new Activation()).ActivateApplication(id,args,2,out pid));}}
}
"@}
    $launchArgs=if($coldStart){'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'}else{''}
    [PanelActivation.Launcher]::Start("$($package.PackageFamilyName)!$($application.Id)",$launchArgs)
  }
  $bridgeConfig=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bridge-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $portFile=Join-Path $bridgeConfig.userDataDirectory 'DevToolsActivePort'
  $port=Get-PanelPort $portFile $applicationProcess
  if($coldStart -and -not $NoActivate){
    $timer=[Diagnostics.Stopwatch]::StartNew()
    while(-not $port -and $timer.ElapsedMilliseconds -lt 12000){
      Start-Sleep -Milliseconds 250
      $applicationProcess=Get-PanelProcess $executable
      $port=Get-PanelPort $portFile $applicationProcess
    }
  }
  if($port){
    $daemon=Join-Path $PSScriptRoot 'service.mjs'
    $daemonArgument='"'+$daemon+'"'
    # Keep rediscovering the port after renderer / application handover.
    $arguments=@($daemonArgument,'--owner-pid',"$($applicationProcess.ProcessId)")
    if($applicationProcess.CommandLine -match '--remote-debugging-port=([1-9]\d*)'){$arguments+=@('--port',"$port")}
    else{$arguments+=@('--port-file',('"'+$portFile+'"'))}
    $previousState=$env:CODEX_PANEL_STATE_DIR
    try{
      $env:CODEX_PANEL_STATE_DIR=$stateRoot
      Start-Process -FilePath $config.nodePath -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden|Out-Null
    }finally{$env:CODEX_PANEL_STATE_DIR=$previousState}
  }elseif(-not $NoActivate){throw '此 Codex 进程没有开放状态栏接入口。请保存工作后完全退出，再从“Codex 上下文面板”打开。'}
}catch{
  New-Item -ItemType Directory -Force -Path $stateRoot|Out-Null
  $message='启动失败：'+$_.Exception.Message
  [IO.File]::WriteAllText((Join-Path $stateRoot 'launcher-message.txt'),$message,[Text.UTF8Encoding]::new($false))
  if(-not $NoMessage){Add-Type -AssemblyName PresentationFramework;[void][System.Windows.MessageBox]::Show($message,'Codex 上下文面板')}
  throw
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}

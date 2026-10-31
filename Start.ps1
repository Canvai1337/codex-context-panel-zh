[CmdletBinding()]
param([switch]$NoMessage,[switch]$NoActivate)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'NativeStartup.ps1')
$stateRoot=Get-PanelStateRoot
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$mutex=[Threading.Mutex]::new($false,'Local\BossCodexContextPanelLauncher')
$locked=$false
function Test-PanelPort([int]$Port){
  try{$list=Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 1;return @($list|Where-Object {$_.type -eq 'page' -and $_.url -match '^app://(-|codex)/(index|detached-window)\.html'}).Count -gt 0}catch{return $false}
}
try{
  $locked=$mutex.WaitOne(0);if(-not $locked){return}
  if(-not $NoActivate){
    $package=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1
    if(-not $package){throw '未找到 Windows Store 版 Codex'}
    $manifest=[xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
    $application=@($manifest.Package.Applications.Application)|Where-Object {$_.Executable -match 'ChatGPT\.exe$'}|Select-Object -First 1
    if(-not ('PanelActivation.Launcher' -as [type])){Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace PanelActivation {
 [ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IActivation { [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,[MarshalAs(UnmanagedType.LPWStr)] string args,int options,out uint pid); }
 [ComImport,Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class Activation {}
 public static class Launcher {public static void Start(string id){uint pid;Marshal.ThrowExceptionForHR(((IActivation)new Activation()).ActivateApplication(id,"",2,out pid));}}
}
"@}
    [PanelActivation.Launcher]::Start("$($package.PackageFamilyName)!$($application.Id)")
  }
  # Existing windows can be attached during upgrades. Cold starts are handled
  # by Windows and StartupBridge, without this launcher or a modified shortcut.
  $applicationProcess=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match '\\OpenAI\.Codex_'}|Select-Object -First 1
  if(-not $applicationProcess){return}
  $port=0;$portFile=$null
  if($applicationProcess.CommandLine -match '--remote-debugging-port=(\d+)' -and [int]$Matches[1] -gt 0){$port=[int]$Matches[1]}
  if(-not $port){
    $bridgeConfig=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bridge-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $portFile=Join-Path $bridgeConfig.userDataDirectory 'DevToolsActivePort'
    if(Test-Path -LiteralPath $portFile){$port=[int]((Get-Content -LiteralPath $portFile -Raw).Split("`n")[0])}
  }
  if($port -and (Test-PanelPort $port)){
    $daemon=Join-Path $PSScriptRoot 'service.mjs'
    $daemonArgument='"'+$daemon+'"'
    # Keep rediscovering the port after renderer / application handover.
    $arguments=@($daemonArgument,'--owner-pid',"$($applicationProcess.ProcessId)")
    if($portFile){$arguments+=@('--port-file',('"'+$portFile+'"'))}else{$arguments+=@('--port',"$port")}
    $previousState=$env:CODEX_PANEL_STATE_DIR
    try{
      $env:CODEX_PANEL_STATE_DIR=$stateRoot
      Start-Process -FilePath $config.nodePath -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden|Out-Null
    }finally{$env:CODEX_PANEL_STATE_DIR=$previousState}
  }
}catch{
  New-Item -ItemType Directory -Force -Path $stateRoot|Out-Null
  $message='启动失败：'+$_.Exception.Message
  [IO.File]::WriteAllText((Join-Path $stateRoot 'launcher-message.txt'),$message,[Text.UTF8Encoding]::new($false))
  if(-not $NoMessage){Add-Type -AssemblyName PresentationFramework;[void][System.Windows.MessageBox]::Show($message,'Codex 上下文面板')}
  throw
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}

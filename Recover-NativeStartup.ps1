[CmdletBinding()]
param([string]$StateRoot)
$ErrorActionPreference='Stop'
if(-not $StateRoot){$StateRoot=Join-Path $env:LOCALAPPDATA 'CodexContextPanel'}
$recordPath=Join-Path $StateRoot 'native-startup.json'
if(-not (Test-Path -LiteralPath $recordPath)){Write-Output '未启用原生启动接入。';return}
$record=Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8|ConvertFrom-Json
$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel'))+[IO.Path]::DirectorySeparatorChar
if(-not ([IO.Path]::GetFullPath($record.installRoot)).StartsWith($expected,[StringComparison]::OrdinalIgnoreCase) -or $record.packageFullName -notmatch '^OpenAI\.Codex_.+__2p2nqsd0c76g0$'){throw '启动配置不属于本面板，已停止恢复操作'}
if(-not ('PanelRecovery.Settings' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace PanelRecovery {
 [ComImport,Guid("F27C3930-8029-4AD1-94E3-3DBA417810C1"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface ISettings {
  [PreserveSig] int EnableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package,[MarshalAs(UnmanagedType.LPWStr)] string debugger,IntPtr environment);
  [PreserveSig] int DisableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package);
 }
 public static class Settings {
  public static void Disable(string package){var settings=(ISettings)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));try{Marshal.ThrowExceptionForHR(settings.DisableDebugging(package));}finally{Marshal.ReleaseComObject(settings);}}
 }
}
'@}
$task=Get-ScheduledTask -TaskName 'CodexContextPanel-RepairStartup' -ErrorAction SilentlyContinue
if($task -and @($task.Actions|Where-Object {$_.Arguments -and $_.Arguments.Contains($record.installRoot)}).Count){Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false}
[PanelRecovery.Settings]::Disable($record.packageFullName)
Remove-Item -LiteralPath $recordPath -Force
Write-Output '已撤销原生启动接入；当前已打开的 Codex 和聊天不受影响。'

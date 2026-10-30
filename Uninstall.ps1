[CmdletBinding()]
param([switch]$RemoveSettings)
$ErrorActionPreference='Stop'
$installPath=[IO.Path]::GetFullPath($PSScriptRoot)
$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel'))+[IO.Path]::DirectorySeparatorChar
if(-not $installPath.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){throw '仅可从已安装的 CodexContextPanel 版本目录卸载'}
. (Join-Path $PSScriptRoot 'NativeStartup.ps1')
Disable-PanelNativeStartup $installPath
. (Join-Path $PSScriptRoot 'Shortcuts.ps1')
Restore-PanelShortcuts -InstallRoot $installPath
Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object {$_.CommandLine -and ($_.CommandLine.Contains((Join-Path $installPath 'service.mjs')) -or $_.CommandLine.Contains((Join-Path $installPath 'daemon.mjs')))}|Sort-Object @{Expression={if($_.CommandLine -match 'service\.mjs'){0}else{1}}}|ForEach-Object {
  $daemonId=$_.ProcessId
  if(Get-Process -Id $daemonId -ErrorAction SilentlyContinue){Start-Process -FilePath "$env:WINDIR\System32\taskkill.exe" -ArgumentList @('/PID',"$daemonId",'/T','/F') -WindowStyle Hidden -Wait|Out-Null}
}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
  $link=Join-Path $folder 'Codex 上下文面板.lnk'
  if(Test-Path -LiteralPath $link){$shortcut=$shell.CreateShortcut($link);if($shortcut.Arguments.Contains($installPath)){Remove-Item -LiteralPath $link -Force}}
}
if($RemoveSettings){$state=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CodexContextPanel'));if($state -eq (Join-Path ([IO.Path]::GetFullPath($env:LOCALAPPDATA)) 'CodexContextPanel')){Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue}}
Remove-Item -LiteralPath $installPath -Recurse -Force
Write-Output '已卸载。已打开窗口中的临时面板会在下次正常重启 Codex 后消失。'

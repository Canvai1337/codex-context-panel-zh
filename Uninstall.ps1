[CmdletBinding()]
param([switch]$RemoveSettings)
$ErrorActionPreference='Stop'
$installPath=[IO.Path]::GetFullPath($PSScriptRoot)
$expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel'))+[IO.Path]::DirectorySeparatorChar
if(-not $installPath.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){throw '仅可从已安装的 CodexContextPanel 版本目录卸载'}
$daemon=Join-Path $installPath 'daemon.mjs'
Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($daemon)}|ForEach-Object {
  $daemonId=$_.ProcessId
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$daemonId" | Where-Object {$_.Name -eq 'codex.exe' -and $_.CommandLine -match 'app-server.*stdio://'} | ForEach-Object {Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
  Stop-Process -Id $daemonId -ErrorAction SilentlyContinue
}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
  $link=Join-Path $folder 'Codex 上下文面板.lnk'
  if(Test-Path -LiteralPath $link){$shortcut=$shell.CreateShortcut($link);if($shortcut.Arguments.Contains($installPath)){Remove-Item -LiteralPath $link -Force}}
}
if($RemoveSettings){$state=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CodexContextPanel'));if($state -eq (Join-Path ([IO.Path]::GetFullPath($env:LOCALAPPDATA)) 'CodexContextPanel')){Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue}}
Remove-Item -LiteralPath $installPath -Recurse -Force
Write-Output '已卸载。已打开窗口中的临时面板会在下次正常重启 Codex 后消失。'

param([string]$WorkRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\Shortcuts.ps1')
foreach($file in @('Start.ps1','Install.ps1','Uninstall.ps1','Shortcuts.ps1')){
  $parseErrors=$null;$tokens=$null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "..\$file"),[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count){throw ($parseErrors|Out-String)}
}
$shell=New-Object -ComObject WScript.Shell
$shortcutPath=Join-Path $WorkRoot 'ChatGPT.lnk'
$link=$shell.CreateShortcut($shortcutPath);$link.TargetPath=Join-Path $env:WINDIR 'System32\notepad.exe';$link.Description='original';$link.Save()
$original=[Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath))
$state=Join-Path $WorkRoot 'state';$install=Join-Path $WorkRoot '1.5.0';New-Item -ItemType Directory -Path $install|Out-Null
Install-PanelShortcuts -InstallRoot $install -Paths @($shortcutPath) -StateRoot $state
$updated=$shell.CreateShortcut($shortcutPath)
if($updated.TargetPath -ne (Join-Path $env:WINDIR 'System32\wscript.exe') -or -not $updated.Arguments.Contains($install)){throw 'shortcut target was not updated'}
$next=Join-Path $WorkRoot 'next';New-Item -ItemType Directory -Path $next|Out-Null
Install-PanelShortcuts -InstallRoot $next -StateRoot $state
Restore-PanelShortcuts -InstallRoot $install -StateRoot $state
if(-not $shell.CreateShortcut($shortcutPath).Arguments.Contains($next)){throw 'old uninstall changed upgraded shortcut'}
Restore-PanelShortcuts -InstallRoot $next -StateRoot $state
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath)) -ne $original){throw 'original binary link was not restored'}
Write-Output 'shortcut install / upgrade / restore and PowerShell syntax passed'

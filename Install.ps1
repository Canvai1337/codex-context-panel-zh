[CmdletBinding()]
param([string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel\1.5.1'),[switch]$SkipShortcut,[string[]]$ShortcutPath=@())
$ErrorActionPreference='Stop'
$nodePath=(Get-Command node -ErrorAction Stop).Source
$cliPath=(Get-Command codex -ErrorAction Stop).Source
$nodeMajor=[int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 22){throw '需要 Node.js 22 或更新版本'}
$running=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.CommandLine -notmatch '--type='}|Select-Object -First 1
$desktopPath=if($running){$running.ExecutablePath}else{''}
New-Item -ItemType Directory -Force -Path $InstallRoot|Out-Null
$files=@('data.mjs','account.mjs','usage.mjs','widget.js','cdp.mjs','daemon.mjs','Start.ps1','Launch.vbs','Shortcuts.ps1','Uninstall.ps1','使用说明.md','THIRD-PARTY-NOTICES.txt','LICENSE')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $InstallRoot $file) -Force}
@{version='1.5.1';nodePath=$nodePath;cliPath=$cliPath;desktopPath=$desktopPath}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $InstallRoot 'install-config.json') -Encoding utf8
if(-not $SkipShortcut){
  . (Join-Path $PSScriptRoot 'Shortcuts.ps1')
  Install-PanelShortcuts -InstallRoot $InstallRoot -Paths $ShortcutPath -IconPath $desktopPath
  $shell=New-Object -ComObject WScript.Shell
  foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
    $link=$shell.CreateShortcut((Join-Path $folder 'Codex 上下文面板.lnk'))
    $link.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
    $link.Arguments='"'+(Join-Path $InstallRoot 'Launch.vbs')+'"'
    $link.WorkingDirectory=$InstallRoot
    if($desktopPath){$link.IconLocation=$desktopPath+',0'}
    $link.Description='启动 Codex 与中文上下文占比面板';$link.Save()
  }
}
Write-Output "已安装：$InstallRoot"

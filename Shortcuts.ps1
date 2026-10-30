# Retarget only explicitly selected existing shortcuts. Keep the original binary
# link (including UWP PIDLs) so uninstall can restore it without reconstruction.
function Install-PanelShortcuts {
  param([string]$InstallRoot,[string[]]$Paths=@(),[string]$IconPath,[string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'CodexContextPanel'))
  New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
  $manifestPath=Join-Path $StateRoot 'shortcut-backups.json'
  $entries=@();if(Test-Path -LiteralPath $manifestPath){$parsed=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;foreach($record in $parsed){$entries+=$record}}
  $allPaths=@(@($Paths)+@($entries|ForEach-Object {$_.path})|Select-Object -Unique)
  $shell=New-Object -ComObject WScript.Shell
  foreach($path in $allPaths){
    if(-not $path){continue}
    $full=[IO.Path]::GetFullPath($path)
    if([IO.Path]::GetExtension($full) -ne '.lnk' -or -not (Test-Path -LiteralPath $full)){throw "未找到现有快捷方式：$full"}
    $entry=$entries|Where-Object {$_.path -eq $full}|Select-Object -First 1
    if(-not $entry){
      $backup=Join-Path $StateRoot (([guid]::NewGuid().ToString())+'.lnk')
      Copy-Item -LiteralPath $full -Destination $backup
      $entry=[PSCustomObject]@{path=$full;backup=$backup;installRoot=$InstallRoot};$entries+= $entry
    }
    $entry.installRoot=$InstallRoot
    # Persist recovery information before replacing the original.
    ConvertTo-Json -InputObject @($entries) -Depth 5|Set-Content -LiteralPath $manifestPath -Encoding utf8
    $original=$shell.CreateShortcut($full)
    $temp=Join-Path ([IO.Path]::GetDirectoryName($full)) (([guid]::NewGuid().ToString())+'.lnk')
    try{
      $link=$shell.CreateShortcut($temp);$link.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
      $link.Arguments='"'+(Join-Path $InstallRoot 'Launch.vbs')+'"';$link.WorkingDirectory=$InstallRoot
      if($original.IconLocation -and $original.IconLocation -ne ',0'){$link.IconLocation=$original.IconLocation}elseif($IconPath){$link.IconLocation=$IconPath+',0'}
      $link.Description=$original.Description;$link.Hotkey=$original.Hotkey;$link.Save()
      Move-Item -LiteralPath $temp -Destination $full -Force
    }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}}
  }
}
function Restore-PanelShortcuts {
  param([string]$InstallRoot,[string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'CodexContextPanel'))
  $manifestPath=Join-Path $StateRoot 'shortcut-backups.json';if(-not (Test-Path -LiteralPath $manifestPath)){return}
  $shell=New-Object -ComObject WScript.Shell;$keep=@()
  $parsed=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
  foreach($entry in $parsed){
    if($entry.installRoot -ne $InstallRoot){$keep+=$entry;continue}
    if(Test-Path -LiteralPath $entry.path){
      $link=$shell.CreateShortcut($entry.path)
      if($link.TargetPath -ne (Join-Path $env:WINDIR 'System32\wscript.exe') -or $link.Arguments -ne ('"'+(Join-Path $InstallRoot 'Launch.vbs')+'"')){$keep+=$entry;continue}
      Copy-Item -LiteralPath $entry.backup -Destination $entry.path -Force
    }
    Remove-Item -LiteralPath $entry.backup -Force
  }
  ConvertTo-Json -InputObject @($keep) -Depth 5|Set-Content -LiteralPath $manifestPath -Encoding utf8
}

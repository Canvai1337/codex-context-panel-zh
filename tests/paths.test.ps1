param([string]$WorkRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\NativeStartup.ps1')
$oldLocal=$env:LOCALAPPDATA;$oldRoaming=$env:APPDATA;$oldState=$env:CODEX_PANEL_STATE_DIR
try{
  $env:LOCALAPPDATA=Join-Path $WorkRoot 'Local'
  $env:APPDATA=Join-Path $WorkRoot 'ordinary-Roaming-must-not-be-used'
  $env:CODEX_PANEL_STATE_DIR=$null
  $family='OpenAI.Codex_2p2nqsd0c76g0'
  $cache=Join-Path $env:LOCALAPPDATA "Packages\$family\LocalCache"
  $profile=Get-PanelProfile $family $true
  if($profile -ne (Join-Path $cache 'Roaming\Codex\web\Codex')){throw 'Store profile must use its explicit backing directory'}
  if((Get-PanelProfile $family $false) -ne (Join-Path $cache 'Roaming\Codex')){throw 'classic profile mapping is wrong'}
  if((Get-PanelStateRoot) -ne (Join-Path $cache 'Local\CodexContextPanel')){throw 'state must use one shared backing directory'}
  $env:CODEX_PANEL_STATE_DIR=Join-Path $WorkRoot 'override'
  if((Get-PanelStateRoot) -ne $env:CODEX_PANEL_STATE_DIR){throw 'isolated state override was lost'}
  Write-Output 'Store profile and state paths are explicit; ordinary Roaming is ignored'
}finally{$env:LOCALAPPDATA=$oldLocal;$env:APPDATA=$oldRoaming;$env:CODEX_PANEL_STATE_DIR=$oldState}

[CmdletBinding()]
param([string]$OutputRoot)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
if(-not $OutputRoot){$OutputRoot=Join-Path $repoRoot 'dist'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$version=(Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
$name="codex-context-panel-zh-v$version-windows"
$staging=Join-Path $OutputRoot ($name+'-staging-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $staging|Out-Null
$files=@('data.mjs','account.mjs','usage.mjs','widget.js','cdp.mjs','daemon.mjs','service.mjs','runtime.mjs','Install.ps1','Start.ps1','Launch.vbs','Shortcuts.ps1','NativeStartup.ps1','Recover-NativeStartup.ps1','Uninstall.ps1','README.md','CHANGELOG.md','使用说明.md','THIRD-PARTY-NOTICES.txt','LICENSE')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $staging $file) -Force}
Copy-Item -LiteralPath (Join-Path $repoRoot 'assets') -Destination $staging -Recurse -Force
& (Join-Path $PSScriptRoot 'Build-Native.ps1') -OutputRoot $staging|Out-Null
$zip=Join-Path $OutputRoot ($name+'.zip')
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutputRoot 'SHA256SUMS.txt'),($hash+'  '+[IO.Path]::GetFileName($zip)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
Write-Output $zip
Write-Output $hash

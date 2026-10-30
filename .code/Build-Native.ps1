[CmdletBinding()]
param([string]$OutputRoot)
$ErrorActionPreference='Stop'
if(-not $OutputRoot){$OutputRoot=Join-Path $PSScriptRoot '..\outputs\native'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not (Test-Path -LiteralPath $compiler)){throw 'Windows x64 .NET Framework compiler is required'}
New-Item -ItemType Directory -Force -Path $OutputRoot|Out-Null
$executable=Join-Path $OutputRoot 'StartupBridge.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$executable" (Join-Path $PSScriptRoot 'native\StartupBridge.cs')
if($LASTEXITCODE -ne 0){throw 'Native startup bridge compilation failed'}
Write-Output $executable

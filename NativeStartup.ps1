[CmdletBinding()]
param([ValidateSet('Enable','Disable','Repair','Status')][string]$Action='Repair',[Alias('InstallRoot')][string]$PanelInstallRoot,[switch]$SkipMaintenance)
$ErrorActionPreference='Stop'
if(-not $PanelInstallRoot){$PanelInstallRoot=Split-Path -Parent $MyInvocation.MyCommand.Path}

function Write-PanelJson([string]$Path,$Value){
  $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  ConvertTo-Json -InputObject $Value -Depth 8|Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Get-PanelPackage {
  $package=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1
  if(-not $package){throw '未找到 Windows Store 版 Codex，原生入口模式需要此安装类型'}
  if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw '原生入口模式目前仅支持 Windows x64'}
  return $package
}
function Invoke-PanelBridge([string]$Helper,[string]$Operation,[string]$Package){
  $process=Start-Process -FilePath $Helper -ArgumentList @($Operation,$Package) -WindowStyle Hidden -PassThru
  if(-not $process.WaitForExit(10000)){throw '包级启动配置超时'}
  if($process.ExitCode -ne 0){throw "包级启动配置失败，退出码：$($process.ExitCode)"}
}
function Set-PanelMaintenance([string]$Root){
  $taskName='CodexContextPanel-RepairStartup'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $user=$identity.User.Value
  $arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $Root 'NativeStartup.ps1')+'" -Action Repair -InstallRoot "'+$Root+'" -SkipMaintenance'
  $subscription='<QueryList><Query Id="0" Path="Microsoft-Windows-AppXDeploymentServer/Operational"><Select Path="Microsoft-Windows-AppXDeploymentServer/Operational">*[System[(EventID=400 or EventID=613)]]</Select></Query></QueryList>'
  $query=[Security.SecurityElement]::Escape($subscription)
  $command=[Security.SecurityElement]::Escape((Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'))
  $argumentXml=[Security.SecurityElement]::Escape($arguments)
  $directory=[Security.SecurityElement]::Escape($Root)
  $xml=@"
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Repair Codex panel startup registration only; never launch Codex.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId><Delay>PT5S</Delay></LogonTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>$query</Subscription><Delay>PT10S</Delay></EventTrigger>
  </Triggers>
  <Principals><Principal id="Owner"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT30S</ExecutionTimeLimit></Settings>
  <Actions Context="Owner"><Exec><Command>$command</Command><Arguments>$argumentXml</Arguments><WorkingDirectory>$directory</WorkingDirectory></Exec></Actions>
</Task>
"@
  Register-ScheduledTask -TaskName $taskName -Xml $xml -Force|Out-Null
}
function Enable-PanelNativeStartup([string]$Root,[switch]$NoMaintenance){
  $expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\CodexContextPanel'))+[IO.Path]::DirectorySeparatorChar
  if(-not ([IO.Path]::GetFullPath($Root)).StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){throw '原生集成必须安装到当前用户的 Programs\CodexContextPanel 目录；隔离检查请使用 -SkipIntegration'}
  $package=Get-PanelPackage
  $stateRoot=Join-Path $env:LOCALAPPDATA 'CodexContextPanel'
  New-Item -ItemType Directory -Force -Path $stateRoot|Out-Null
  $recordPath=Join-Path $stateRoot 'native-startup.json'
  $previous=$null;if(Test-Path -LiteralPath $recordPath){$previous=Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8|ConvertFrom-Json}
  $helper=Join-Path $Root 'StartupBridge.exe'
  Copy-Item -LiteralPath (Join-Path $Root 'Recover-NativeStartup.ps1') -Destination (Join-Path $stateRoot 'Recover-NativeStartup.ps1') -Force
  $config=Get-Content -LiteralPath (Join-Path $Root 'install-config.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $executable=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  $nativeProfile=Join-Path $env:APPDATA 'Codex'
  if(Test-Path -LiteralPath (Join-Path $package.InstallLocation 'app\resources\owl-app.ini')){$nativeProfile=Join-Path $nativeProfile 'web\Codex'}
  Write-PanelJson (Join-Path $Root 'bridge-config.json') @{executablePath=$executable;nodePath=$config.nodePath;servicePath=(Join-Path $Root 'service.mjs');daemonPath=(Join-Path $Root 'daemon.mjs');stateRoot=$stateRoot;userDataDirectory=$nativeProfile;launchDaemon=$true}
  try{
    Invoke-PanelBridge $helper '--register' $package.PackageFullName
    Write-PanelJson $recordPath @{version=$config.version;installRoot=$Root;helperPath=$helper;packageFullName=$package.PackageFullName;packageFamilyName=$package.PackageFamilyName;executablePath=$executable;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
    if($previous -and $previous.packageFullName -ne $package.PackageFullName -and (Test-Path -LiteralPath $previous.helperPath)){try{Invoke-PanelBridge $previous.helperPath '--unregister' $previous.packageFullName}catch{}}
  }catch{
    try{Invoke-PanelBridge $helper '--unregister' $package.PackageFullName}catch{}
    if($previous -and (Test-Path -LiteralPath $previous.helperPath)){try{Invoke-PanelBridge $previous.helperPath '--register' $previous.packageFullName}catch{}}
    throw
  }
  if(-not $NoMaintenance){
    try{Set-PanelMaintenance $Root}catch{Write-Warning ('原生入口已启用；自动维护任务未建立：'+$_.Exception.Message+'。应用更新后可运行 NativeStartup.ps1 -Action Repair。')}
  }
}
function Disable-PanelNativeStartup([string]$Root){
  $recordPath=Join-Path $env:LOCALAPPDATA 'CodexContextPanel\native-startup.json'
  if(-not (Test-Path -LiteralPath $recordPath)){return}
  $record=Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8|ConvertFrom-Json
  if($record.installRoot -ne $Root){return}
  if(-not (Test-Path -LiteralPath $record.helperPath)){& (Join-Path (Split-Path $recordPath -Parent) 'Recover-NativeStartup.ps1');return}
  $task=Get-ScheduledTask -TaskName 'CodexContextPanel-RepairStartup' -ErrorAction SilentlyContinue
  if($task -and @($task.Actions|Where-Object {$_.Arguments -and $_.Arguments.Contains($Root)}).Count){Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false}
  Invoke-PanelBridge $record.helperPath '--unregister' $record.packageFullName
  Remove-Item -LiteralPath $recordPath -Force
}
if($MyInvocation.InvocationName -ne '.'){
  if($Action -eq 'Status'){$record=Join-Path $env:LOCALAPPDATA 'CodexContextPanel\native-startup.json';if(Test-Path -LiteralPath $record){Get-Content -LiteralPath $record -Raw}else{Write-Output '未启用原生入口'}}
  elseif($Action -eq 'Disable'){Disable-PanelNativeStartup $PanelInstallRoot}
  else{Enable-PanelNativeStartup $PanelInstallRoot -NoMaintenance:$SkipMaintenance}
}

param([ValidateSet('ia32','x64')][string]$Arch = 'x64')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
python scripts/sync-version.py --check
if ($LASTEXITCODE -ne 0) { throw 'Unified version check failed' }
$version = (Get-Content VERSION -Raw).Trim()
$meta = Get-Content "$PSScriptRoot/sdk.json" -Raw | ConvertFrom-Json
$sdkArchive = Join-Path $repo 'build/webview2-sdk.nupkg'
$sdk = Join-Path $repo 'build/webview2-sdk'
New-Item -ItemType Directory -Force build,release | Out-Null
if (!(Test-Path $sdkArchive)) { Invoke-WebRequest $meta.url -OutFile $sdkArchive }
if ((Get-FileHash $sdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meta.sha256) { throw 'WebView2 SDK checksum mismatch' }
if (!(Test-Path "$sdk/build/native/include/WebView2.h")) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($sdkArchive,$sdk)
}
$stage = Join-Path $repo "build/shared-win-$Arch"
$obj = Join-Path $repo "build/shared-obj-$Arch"
New-Item -ItemType Directory -Force $stage,$obj | Out-Null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Install Visual Studio C++ desktop tools and the Windows SDK' }
$platform = if ($Arch -eq 'ia32') { 'x86' } else { 'x64' }
$batch = @"
@echo off
chcp 65001 >nul
call "$vs\VC\Auxiliary\Build\vcvarsall.bat" $platform
if errorlevel 1 exit /b 1
cd /d "$PSScriptRoot"
rc /nologo /fo "$obj\app.res" app.rc
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /W4 /EHsc /MT /utf-8 /I "$sdk\build\native\include" main.cpp "$obj\app.res" "$sdk\build\native\$platform\WebView2LoaderStatic.lib" /Fo"$obj\main.obj" /Fe"$stage\AnoteP.exe" /link /SUBSYSTEM:WINDOWS /MANIFEST:NO ole32.lib oleaut32.lib shell32.lib shlwapi.lib user32.lib advapi32.lib version.lib uuid.lib
if errorlevel 1 exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /MT /utf-8 core-test.cpp /Fo"$obj\core-test.obj" /Fe"$obj\core-test.exe" /link advapi32.lib
if errorlevel 1 exit /b 1
"$obj\core-test.exe"
exit /b %errorlevel%
"@
[IO.File]::WriteAllText("$obj/compile.cmd", $batch, [Text.UTF8Encoding]::new($false))
& cmd.exe /c "$obj/compile.cmd"
if ($LASTEXITCODE -ne 0) { throw 'Shared Windows host build/core tests failed' }
New-Item -ItemType Directory -Force "$stage/assets" | Out-Null
Copy-Item app/src/main/assets/* "$stage/assets" -Recurse -Force
Copy-Item desktop/bridge.js "$stage/bridge.js"
Copy-Item LICENSE "$stage/LICENSE.txt"
Copy-Item "$sdk/LICENSE.txt" "$stage/LICENSE-WebView2.txt"
Copy-Item "$PSScriptRoot/vendor/LICENSE-json.txt" "$stage/LICENSE-json.txt"
Copy-Item "$PSScriptRoot/README.md" "$stage/README.txt"
python "$PSScriptRoot/build-metadata.py" "$stage"
if ($LASTEXITCODE -ne 0) { throw 'Build provenance recording failed' }
$nsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
if (!(Test-Path $nsis)) { $nsis = (Get-Command makensis.exe).Source }
$output = Join-Path $repo "release/AnoteP-$version-win-$Arch.exe"
Push-Location $PSScriptRoot
& $nsis /V2 "/DARCH=$Arch" "/DVERSION=$version" "/DSTAGE=$stage" "/DOUTPUT=$output" installer.nsi
Pop-Location
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
$portable = Join-Path $repo "build/shared-portable-$Arch"
New-Item -ItemType Directory -Force $portable | Out-Null
Copy-Item "$stage/*" $portable -Recurse -Force
Set-Content "$portable/portable.flag" 'Portable AnoteP: private profile is next to this file.'
$archive = Join-Path $repo "release/AnoteP-$version-win-$Arch-portable.zip"
Compress-Archive -Path "$portable/*" -DestinationPath $archive -CompressionLevel Optimal -Force
foreach ($file in @($archive,$output)) {
  if ((Get-Item $file).Length -ge 5MB) { throw "Size budget exceeded (5 MiB): $file" }
}
Get-ChildItem "release/AnoteP-$version-win-$Arch*" | Select-Object Name,Length

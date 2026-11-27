param(
  [ValidateSet('ia32', 'x64')][string]$Arch = 'x64',
  [string]$Source = '',
  [switch]$SourceArchive
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo
if (!$Source) {
  $Source = Join-Path $repo 'build\native-source'
  python native/windows/prepare.py --output "$Source"
  if ($LASTEXITCODE -ne 0) { throw 'Source preparation failed' }
}
$Source = (Resolve-Path $Source).Path
New-Item -ItemType Directory -Force release | Out-Null

# Create corresponding source before compilation, so no obj/pdb/exe files enter it.
if ($SourceArchive) {
  python native/windows/package-source.py "$Source"
  if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
}
$platform = if ($Arch -eq 'ia32') { 'Win32' } else { 'x64' }
msbuild "$Source\PowerEditor\visual.net\notepadPlus.sln" /m /p:Configuration=Release "/p:Platform=$platform" /verbosity:minimal
if ($LASTEXITCODE -ne 0) { throw 'The native C++ build failed' }

$bin = if ($Arch -eq 'ia32') { 'bin' } else { 'bin64' }
$stage = Join-Path $repo "build\native-$Arch"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$Source\PowerEditor\$bin\notepad++.exe" "$stage\AnoteP.exe"
Copy-Item "$Source\PowerEditor\src\langs.model.xml", "$Source\PowerEditor\src\stylers.model.xml" $stage
Copy-Item "$Source\PowerEditor\installer\APIs" "$stage\autoCompletion" -Recurse
Copy-Item "$Source\PowerEditor\installer\functionList", "$Source\PowerEditor\installer\themes", "$Source\PowerEditor\bin\userDefineLangs" $stage -Recurse
Copy-Item "$Source\LICENSE" "$stage\LICENSE.txt"
Copy-Item "$PSScriptRoot\NOTICE.txt" "$stage\NOTICE.txt"
New-Item -ItemType Directory -Force "$stage\licenses" | Out-Null
Copy-Item "$Source\scintilla\License.txt" "$stage\licenses\Scintilla.txt"
Copy-Item "$Source\lexilla\License.txt" "$stage\licenses\Lexilla.txt"
Copy-Item "$Source\scintilla\test\unit\LICENSE_1_0.txt" "$stage\licenses\Boost.txt"
Copy-Item "$Source\PowerEditor\src\pugixml\LICENSE.md" "$stage\licenses\pugixml.txt"
Copy-Item "$PSScriptRoot\json-LICENSE.MIT" "$stage\licenses\json.txt"
Copy-Item "$Source\PowerEditor\src\uchardet\README.TXT" "$stage\licenses\uchardet.txt"
Copy-Item "$Source\PowerEditor\installer\xml4Config\disableNppAutoUpdate.xml" $stage
Set-Content "$stage\noEasterEggs.xml" ''

$nsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if (!$nsis) {
  $nsisPath = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
  if (!(Test-Path $nsisPath)) { throw 'Install NSIS (makensis.exe) to build the installer' }
} else { $nsisPath = $nsis.Source }
$installer = Join-Path $repo "release\AnoteP-1.2.0-win-$Arch.exe"
Push-Location $PSScriptRoot
& $nsisPath /V2 "/DARCH=$Arch" "/DSTAGE=$stage" "/DOUTPUT=$installer" installer.nsi
Pop-Location
if ($LASTEXITCODE -ne 0) { throw 'NSIS failed' }
if ((Get-Item $installer).Length -ge 12MB) { throw 'Installer exceeds the 12 MiB size budget' }

# Portable zip has portable configuration; the installed app uses private AppData.
$portableStage = Join-Path $repo "build\portable-$Arch\AnoteP"
New-Item -ItemType Directory -Force (Split-Path $portableStage) | Out-Null
Copy-Item $stage $portableStage -Recurse
Copy-Item "$Source\PowerEditor\installer\xml4Config\doLocalConf.xml" $portableStage
Compress-Archive -Path "$portableStage\*" -DestinationPath "release\AnoteP-1.2.0-win-$Arch-portable.zip" -CompressionLevel Optimal
Get-ChildItem release/AnoteP-1.2.0-win-$Arch* | Select-Object Name,Length

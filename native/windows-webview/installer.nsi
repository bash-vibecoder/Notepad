Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Name "AnoteP"
OutFile "${OUTPUT}"
!if "${ARCH}" == "x64"
InstallDir "$PROGRAMFILES64\AnoteP"
!else
InstallDir "$PROGRAMFILES32\AnoteP"
!endif
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 16
BrandingText "AnoteP - the shared offline editor"
Icon "../windows/anotep.ico"
UninstallIcon "../windows/anotep.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "AnoteP"
VIAddVersionKey "FileDescription" "AnoteP ${ARCH} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AnoteP contributors; MIT license"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro RegistryView
  !if "${ARCH}" == "x64"
    SetRegView 64
  !else
    SetRegView 32
  !endif
!macroend

Function .onInit
  !if "${ARCH}" == "x64"
    ${IfNot} ${RunningX64}
      MessageBox MB_ICONSTOP "Use the x86 package on 32-bit Windows."
      Abort
    ${EndIf}
  !endif
  !insertmacro RegistryView
  FindWindow $0 "AnoteP"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Close AnoteP before installing this update so the latest scratch text can be saved."
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro RegistryView
FunctionEnd

Section "AnoteP"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  SetShellVarContext current
  Delete "$DESKTOP\AnoteP.lnk"
  Delete "$DESKTOP\AnoteP Native.lnk"
  Delete "$SMPROGRAMS\AnoteP.lnk"
  Delete "$SMPROGRAMS\AnoteP Native\AnoteP.lnk"
  SetShellVarContext all
  CreateShortcut "$DESKTOP\AnoteP.lnk" "$INSTDIR\AnoteP.exe"
  CreateShortcut "$SMPROGRAMS\AnoteP.lnk" "$INSTDIR\AnoteP.exe"
  WriteRegStr HKLM "Software\AnoteP" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "DisplayName" "AnoteP (${ARCH})"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "DisplayIcon" "$INSTDIR\AnoteP.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP" "NoRepair" 1
SectionEnd

Section "Uninstall"
  FindWindow $0 "AnoteP"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Close AnoteP before uninstalling."
    Abort
  ${EndIf}
  Delete "$INSTDIR\AnoteP.exe"
  Delete "$INSTDIR\bridge.js"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\LICENSE-WebView2.txt"
  Delete "$INSTDIR\LICENSE-json.txt"
  Delete "$INSTDIR\source-metadata.json"
  RMDir /r "$INSTDIR\assets"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  SetShellVarContext all
  Delete "$DESKTOP\AnoteP.lnk"
  Delete "$SMPROGRAMS\AnoteP.lnk"
  DeleteRegKey HKLM "Software\AnoteP"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP"
  ; User profiles, previous native recovery and original documents stay intact.
SectionEnd

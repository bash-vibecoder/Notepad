Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef ARCH
!error "Pass /DARCH=ia32 or x64"
!endif
!ifndef STAGE
!error "Pass /DSTAGE=the staged application directory"
!endif
!ifndef OUTPUT
!error "Pass /DOUTPUT=the installer file"
!endif

Name "AnoteP"
OutFile "${OUTPUT}"
!if "${ARCH}" == "x64"
InstallDir "$PROGRAMFILES64\AnoteP Native"
!else
InstallDir "$PROGRAMFILES32\AnoteP Native"
!endif
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "AnoteP - native offline editor"
Icon "anotep.ico"
UninstallIcon "anotep.ico"
VIProductVersion "1.2.1.0"
VIAddVersionKey "ProductName" "AnoteP"
VIAddVersionKey "FileDescription" "AnoteP native ${ARCH} installer"
VIAddVersionKey "FileVersion" "1.2.1"
VIAddVersionKey "LegalCopyright" "GPL-3.0; Notepad++ contributors and AnoteP changes"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  !if "${ARCH}" == "x64"
    ${IfNot} ${RunningX64}
      MessageBox MB_ICONSTOP "This installer needs 64-bit Windows. Use the 32-bit installer on 32-bit Windows."
      Abort
    ${EndIf}
    SetRegView 64
  !else
    SetRegView 32
  !endif
  FindWindow $0 "AnoteP"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Close AnoteP before installing this update."
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  !if "${ARCH}" == "x64"
    SetRegView 64
  !else
    SetRegView 32
  !endif
FunctionEnd

Section "AnoteP"
  ; Replace this user's previous native shortcuts before adding all-user ones.
  ; The old application payload and all per-user recovery data are preserved.
  SetShellVarContext current
  Delete "$DESKTOP\AnoteP Native.lnk"
  Delete "$SMPROGRAMS\AnoteP Native\AnoteP.lnk"
  RMDir "$SMPROGRAMS\AnoteP Native"
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\AnoteP Native"
  CreateShortcut "$SMPROGRAMS\AnoteP Native\AnoteP.lnk" "$INSTDIR\AnoteP.exe"
  CreateShortcut "$DESKTOP\AnoteP Native.lnk" "$INSTDIR\AnoteP.exe"
  WriteRegStr HKLM "Software\AnoteP Native" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "DisplayName" "AnoteP (native ${ARCH})"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "DisplayVersion" "1.2.1"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "DisplayIcon" "$INSTDIR\AnoteP.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  FindWindow $0 "AnoteP"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Close AnoteP before uninstalling."
    Abort
  ${EndIf}
  ; Delete only installed payload. Preserve user profiles and any unrelated files.
  Delete "$INSTDIR\AnoteP.exe"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\NOTICE.txt"
  Delete "$INSTDIR\langs.model.xml"
  Delete "$INSTDIR\stylers.model.xml"
  Delete "$INSTDIR\config.model.xml"
  Delete "$INSTDIR\disableNppAutoUpdate.xml"
  Delete "$INSTDIR\noEasterEggs.xml"
  RMDir /r "$INSTDIR\autoCompletion"
  RMDir /r "$INSTDIR\functionList"
  RMDir /r "$INSTDIR\themes"
  RMDir /r "$INSTDIR\userDefineLangs"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\AnoteP Native.lnk"
  Delete "$SMPROGRAMS\AnoteP Native\AnoteP.lnk"
  RMDir "$SMPROGRAMS\AnoteP Native"
  DeleteRegKey HKLM "Software\AnoteP Native"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AnoteP Native"
SectionEnd

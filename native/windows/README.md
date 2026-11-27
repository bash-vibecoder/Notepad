# Small native Windows edition

AnoteP 1.2.0 for Windows builds the pinned Notepad++ 8.9.9.1 C++ source with
Scintilla, Lexilla and Boost.Regex. It does not ship Electron, Chromium, Node.js,
WebView2, a browser installer, an updater or third-party plugins. The build fails
if an installer reaches 12 MiB. Both x86 and x64 installers and portable ZIPs are
produced. These are independent, unofficial modified builds.

The native interface has Notepad++ menus, tabs, split views, syntax lexers,
find/replace, native encodings, macros, folder panels, themes and recovery. It
does not use the Android-style coding-key panel or the Electron frontend.

## Build

Install Visual Studio with C++ desktop tools (v143 or a toolset supported by the
pinned source), the Windows SDK, Python 3.12+, and NSIS. Run from a PowerShell
environment with `msbuild` on PATH:

```powershell
./native/windows/build.ps1 -Arch x64 -SourceArchive
./native/windows/build.ps1 -Arch ia32 -Source build/native-source
```

`prepare.py` downloads and verifies the exact upstream archive using
`upstream.json`, then applies explicit changes which fail if the source drifts.
It writes an auditable `ANOTEP-CHANGES.patch`. Lexer sources are unchanged.
The source archive is made before compilation and includes all vendored source
dependencies, the patch, upstream license, packaging scripts and original icon.
No release token, key, node_modules or Electron files enter any Windows package.

To rebuild from `AnoteP-1.2.0-windows-source.zip`, extract it and run:

```powershell
cd AnoteP-1.2.0/anotep-build
./native/windows/build.ps1 -Arch x64 -Source ../source
```

Output is in `release/`. `smoke-test.py` uses Win32/Scintilla messages against the
actual executable, not a simulated editor. It requires Pillow for a screenshot.
CI installs and tests the installer, verifies architecture, tests the portable
ZIP, checks the old-workspace recovery and tests uninstallation.

## Previous Electron installation

Close the old application before installing. The native application has the same
AnoteP executable name and icon, but its preferences/session format is different.
Settings live in `%APPDATA%\AnoteP\Native`; the existing Electron
`%APPDATA%\AnoteP\workspace.json` is not deleted or overwritten.

On the first native launch, the old workspace's text is exported to UTF-8 recovery
copies under `Native\Recovered` and opened as a native session. These copies are
separate from the original documents. `READ-ME.txt` maps them to their original
URIs, and a complete copy of `workspace.json` retains the original metadata.
Use **Save As** to write a recovered copy to its original file. Original encoding,
line-ending, cursor, macro and theme preferences are not automatically translated.
If recovery export fails, the original workspace is left intact.

The portable ZIP stores its own settings beside the executable using
`doLocalConf.xml`; it does not require installation. The installed edition's
uninstaller preserves AppData, recovered tabs and user documents.

## License

The native Windows derivative is GPL-3.0; preserve `LICENSE.txt`, third-party
notices and `NOTICE.txt`. Complete corresponding source accompanies each release.
The Android/Linux implementations and original AnoteP artwork keep their existing
MIT licenses. This is not an official Notepad++ release.

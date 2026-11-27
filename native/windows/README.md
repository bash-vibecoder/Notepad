# Small native Windows edition

AnoteP 1.2.1 for Windows builds the pinned Notepad++ 8.9.9.1 C++ source with
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

To rebuild from `AnoteP-1.2.1-windows-source.zip`, extract it and run:

```powershell
cd AnoteP-1.2.1/anotep-build
./native/windows/build.ps1 -Arch x64 -Source ../source
```

Output is in `release/`. `smoke-test.py` uses Win32/Scintilla messages against the
actual executable, not a simulated editor. It requires Pillow for a screenshot.
CI installs and tests the installer, verifies architecture, tests the portable
ZIP, checks the old-workspace recovery and tests uninstallation.

## Scratch tabs and recovery

Normal launches keep unsaved scratch tabs across closing and reopening, without
Save or Save As. Session/snapshot recovery is enabled on startup, including
profiles which previously disabled it. A recovery copy is written every second
and immediately before normal exit. If the final recovery write fails, AnoteP
keeps the editor open with an error so the text can still be saved.

Installed builds use `%APPDATA%\AnoteP\Native\backup` and `session.xml`; portable
builds keep those beside the executable. Backup copies do not overwrite the
original document. Explicit `-nosession` launches still opt out of recovery.
Closing an individual tab and choosing to discard it is intentional deletion;
it is different from closing the application with the tab still open.

CI tests scratch close/restart before the timer fires, periodic recovery after
forced termination, existing disabled preferences, and a blocked backup folder
which must prevent closing. Force termination can lose edits made after the
most recent completed periodic backup.

## Installation and previous versions

The installer requests administrator permission and installs for all users.
The x64 default is `C:\Program Files\AnoteP Native`; the x86 default on 64-bit
Windows is `C:\Program Files (x86)\AnoteP Native`. On 32-bit Windows, x86 uses
`C:\Program Files\AnoteP Native`. Windows may use another system drive.
The directory page still allows a custom folder. Runtime settings and scratch
recovery stay in each user's AppData, outside Program Files. Uninstall preserves
those files and all original documents.

The previous per-user native application files are not silently removed. After
checking the new build and its recovery, the older per-user version can be
uninstalled. New system-wide shortcuts point at the Program Files executable.

## Previous Electron installation

Close the old application before installing. The native application has the same
AnoteP executable name and icon, but installs into `Program Files\AnoteP Native` with
an **AnoteP Native** shortcut to distinguish it from the previous Electron app.
Its preferences/session format is different.
Settings live in `%APPDATA%\AnoteP\Native`; the existing Electron
`%APPDATA%\AnoteP\workspace.json` is not deleted or overwritten.

On the first native launch, the old workspace's text is exported to UTF-8 recovery
copies under `Native\Recovered` and opened as a native session. These copies are
separate from the original documents. `READ-ME.txt` maps them to their original
URIs, and a complete copy of `workspace.json` retains the original metadata.
Use **Save As** to write a recovered copy to its original file. Original encoding,
line-ending, cursor, macro and theme preferences are not automatically translated.
If recovery export fails, the original workspace is left intact.

After confirming recovery, uninstall the old Electron edition to reclaim its
large runtime files. The native edition has a separate install directory and
uninstall entry; it does not silently delete the old application.

The portable ZIP stores its own settings beside the executable using
`doLocalConf.xml`; it does not require installation. The installed edition's
uninstaller preserves AppData, recovered tabs and user documents.
Portable mode does not import the installed Electron workspace into AppData.

## License

The native Windows derivative is GPL-3.0; preserve `LICENSE.txt`, third-party
notices and `NOTICE.txt`. Complete corresponding source accompanies each release.
The Android/Linux implementations and original AnoteP artwork keep their existing
MIT licenses. This is not an official Notepad++ release.

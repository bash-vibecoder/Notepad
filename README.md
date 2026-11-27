# AnoteP

An offline text and source-code editor for **Android, Windows and Linux**.
All current packages use the same AnoteP editor, language detection, menus,
coding keys and editing features. The unified release version is **1.4.0**.

[Download the current release — all platforms](https://github.com/bash-vibecoder/Notepad/releases/latest).
Windows x86/x64 installers and portable ZIPs, a universal Android APK including
ARMv7, and architecture-independent Linux `.deb` / portable `.tar.xz` packages
are provided. Every package is rebuilt at the same release version, including
platforms with no feature changes.

The single root `VERSION` file drives APK versionName/versionCode, executable
resources, installer metadata, Debian metadata, command-line/About versions,
filenames and the GitHub release. `scripts/sync-version.py --check` rejects
version drift. Publication also checks that the actual editor assets in every
package are byte-for-byte identical to the release source.

## Shared AnoteP features

These are the Android AnoteP features, now shared by all three platforms:

- Automatic language detection from filenames, shebangs and code contents,
  including scratch tabs. It updates while typing; a per-tab manual choice
  overrides detection and **Auto detect** enables it again.
- 121 bundled CodeMirror language modes; no language downloads or online APIs.
- Multiple tabs, local scratch recovery, cursor positions, bookmarks,
  preferences and a saved macro. Recovery runs after edits and periodically
  during continuous typing; desktop close waits for the final disk write.
- Two rows of menus/tools and the coding-key panel, Shift/Ctrl/Alt modifiers,
  keyboard-style inverted-T arrows, shortcuts and symbol keys. Android menus
  remain open while the software keyboard hides.
- Undo/redo, folding, bracket matching, automatic bracket/tag closure, word
  completion, comments, line duplication/movement, sorting, case conversion,
  indentation, whitespace display and trailing-space removal.
- Literal/regex find and replace, capture replacements such as `$1`, search
  across tabs and a selected local folder, bookmarks and go-to-line.
- Cloned split views or different documents in the two views; local macro
  recording/playback; light/dark themes, zoom, wrap and indentation settings.
- Native local file dialogs, folder browsing, system clipboard, encoding and
  line-ending controls, and confirmation before overwriting an externally
  changed file.

See [the feature inventory and platform differences](docs/FEATURES.md).

## Offline operation and small packages

There are no accounts, ads, analytics, remote editor assets, online language
services or runtime downloaders. Remote navigation and requests are blocked.
The Android manifest declares **no permissions**. Its cloud backup is disabled.
Native Windows/Linux hosts add request filters and navigation restrictions to
the shared editor's content-security policy.

Package download budgets are enforced: **less than 5 MiB** for each Windows
installer/portable ZIP and **less than 1 MiB** for the APK and each Linux package.
No Electron, Chromium, Edge or WebKit engine is bundled.

**System runtimes are separate from those sizes:** Android uses its system
WebView, Windows requires the Microsoft Edge WebView2 Runtime, and Linux
requires Python/GTK/WebKitGTK. Missing runtimes can require substantial
additional downloads and installed space. Install them separately beforehand
for an offline machine; AnoteP does not fetch or install them itself.
The Linux portable archive has shared-library requirements and is not a
self-contained AppImage.

## Local files, encodings and recovery

Android uses its document picker; choose internal storage or an SD card for
local files. Desktop editions use ordinary local filesystem dialogs.
Opening/saving a file is an explicit action. Recovery snapshots do not silently
save over the original document.

Supported encodings: UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, Windows-1252,
ISO-8859-1 and ASCII. Line endings: CRLF, LF and CR. BOM/UTF encodings are
recognized on open, Windows-1252 is the legacy fallback, and explicit reload
with an encoding is available. Mixed endings produce a notice and are normalized
to the detected predominant style when saved. Unrepresentable characters are
rejected rather than silently replaced.

The shared limits are 8 MB per document, 30 tabs and 32 MB of recovery data.
Folder search is bounded to 500 files / 16 MB / 200 directories / 200 matches,
skipping binary files and files above 1 MB. Macros record text edits, simple
cursor movement and editing commands, rather than file-picker interactions.
Plugins, code execution, FTP, spell checking and complete native Notepad++
feature parity are outside the shared AnoteP baseline.

### Windows

Installers request elevation and default to `C:\Program Files\AnoteP` (x64) or
`C:\Program Files (x86)\AnoteP` (x86 on 64-bit Windows). The app itself runs as
the current user. Recovery is `%APPDATA%\AnoteP\workspace.json`.
The portable ZIP keeps `profile\` beside its executable. Extract the entire
archive to a writable folder. Uninstall preserves profiles and documents.

Version 1.4 replaces the earlier Windows-only Notepad++ fork with a small
original C++/Win32 WebView2 host for the **same AnoteP UI as the APK**. It reads
previous native session/backup text into the shared workspace without changing
those files. Existing shared recovery is retained, with a pre-import copy.
A migration report lists tabs that exceed the shared limits and remain in the
original native profile. Native Notepad++ macros/themes/plugin preferences are
not translated. The earlier `AnoteP Native` installation is left intact so its
recovery can be checked before uninstalling it.

Installers remain unsigned. See [Windows build/runtime/migration details](native/windows-webview/README.md).

### Linux

Debian 12+/Ubuntu 22.04+ with current updates and WebKitGTK 2.40+:

```sh
sudo apt install ./AnoteP-1.4.0-linux.deb
anotep
```

Portable use:

```sh
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
tar -xf AnoteP-1.4.0-linux-portable.tar.xz
./AnoteP-1.4.0/anotep
```

Installed recovery remains `~/.config/AnoteP/workspace.json` (or under
`$XDG_CONFIG_HOME`). Portable recovery is in the adjacent `profile/` directory.
See [Linux details](native/linux/README.md).

## Build and verification

Change **only `VERSION`** for a new release, then synchronize and rebuild every
platform, even if a particular platform has no feature changes:

```sh
python3 scripts/sync-version.py
python3 scripts/sync-version.py --check
node tests/editor-core.test.js
npm test
```

Windows: Visual Studio C++ desktop tools, Windows SDK, Python 3 and NSIS:

```powershell
./native/windows-webview/build.ps1 -Arch x64
./native/windows-webview/build.ps1 -Arch ia32
```

The pinned WebView2 SDK is verified at build time. Only its small static loader
is linked; the browser runtime is not packaged. Windows CI tests real WebView2,
native dialogs, automatic detection/manual override, modifiers, macros,
clipboard, folder search, network blocking, recovery, previous-native import,
installation and uninstallation in both architectures and package types.

Linux: Python 3 and `dpkg-deb` (no npm needed for packaging):

```sh
python3 native/linux/build.py
python3 -m unittest discover -s native/linux -p 'test_*.py' -v
xvfb-run -a dbus-run-session -- python3 native/linux/smoke-test.py
```

Android: JDK 17+, Python 3, Node.js, `aapt`, `zipalign`, `apksigner` and `keytool`.
Provide the installed API/platform and R8/D8 jars:

```sh
export ANOTEP_ANDROID_JAR=/path/to/platforms/android-34/android.jar
export ANOTEP_RESOURCE_JAR="$ANOTEP_ANDROID_JAR"
export ANOTEP_R8_JAR=/path/to/build-tools/35.0.0/lib/d8.jar
bash scripts/build.sh
```

Output is `dist/AnoteP-1.4.0-android.apk`. Keep the existing signing key under
`.tools/` to produce compatible updates; signing keys are never committed or
included in packages. `ANOTEP_DEBUG=1` produces a separate debug APK under
`build/`, which must not be published. Release builds disable WebView debugging.

`node scripts/browser-test.cjs` uses development-only Playwright/Chromium to
check the shared editor, including mobile layout and Android bridge behavior.
`scripts/audit-packages.py` checks sizes, packaged host/source metadata,
identical editor assets and internal versions. The release workflow accepts
only successful Windows/Linux runs and a newly signed matching-version APK,
then publishes one complete release with source and SHA-256 checksums.

## License and historical builds

Current original AnoteP code/artwork: MIT. CodeMirror modes/addons and nlohmann
JSON retain their MIT notices. Windows packages retain the Microsoft WebView2
SDK redistribution license; its separately installed runtime has Microsoft's
own terms. All current hosts are independent of the Notepad++ source.

The historical Windows 1.2.x fork remains under `native/windows` for old-build
reproduction. It is a GPL-3.0 Notepad++ derivative; full corresponding source
and notices remain in those releases. That code is not compiled into the
current shared Windows host. AnoteP is not an official Notepad++ release.

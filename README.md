# AnoteP

An offline text and source-code editor inspired by the classic Notepad++
workflow, with light menus, green accents, document tabs, line numbers, and an
original penguin-and-notepad icon on a black background. Android and desktop
editions keep editing local. Windows 1.2.0 uses native C++/Scintilla based on
Notepad++ 8.9.9.1. Android and Linux use the independent bundled CodeMirror
editor; those editions block remote navigation and network requests.

[Download the current release — all platforms](https://github.com/bash-vibecoder/Notepad/releases/latest).
It includes native Windows x86/x64 installers and portable ZIPs (1.2.0), small
Linux `.deb` and portable `.tar.xz` packages (1.3.0), and the current Android APK
(1.0, including ARMv7), plus the Windows corresponding source and SHA-256
checksums. These are the latest builds for each platform; their actual version
numbers are retained in the filenames.

The Android APK supports Android 8.0 or newer and runs on ARM64, ARMv7, and x86;
it contains no architecture-specific native libraries. Desktop releases provide
Windows x86 and x64 installers, plus architecture-independent Linux `.deb` and
portable `.tar.xz` packages tested on x64 and ARM64. Linux 1.3.0 uses the system
Python/GTK/WebKitGTK runtime, with each app download below 1 MiB. Runtime
dependencies are separate and can require substantial additional space if not
already installed. There are no accounts, ads, or analytics.

<p>
  <img src="docs/screenshots/light.png" width="280" alt="AnoteP light theme with two rows of menus and keyboard controls">
  <img src="docs/screenshots/dark.png" width="280" alt="AnoteP dark theme">
</p>

## Editing

The following describes the Android/Linux editor. The native Windows edition
uses the Notepad++ interface and its native editing features: tabs, syntax
lexers, split views, macros, find/replace, folder panels, encodings and themes.
See [native Windows details](native/windows/README.md).

- Multiple documents with local recovery of unsaved tabs, cursor positions,
  bookmarks, preferences, and a saved macro.
- Automatic language detection from filenames, shebangs, and code content, with
  a per-document manual override.
- 121 bundled CodeMirror language modes, including C/C++, Java, Kotlin, Python,
  JavaScript, TypeScript, JSON, HTML, CSS, SQL, shell, XML, Markdown, and YAML.
- Undo/redo, folding, bracket matching, automatic bracket/tag closure, word
  completion, comments, line duplication and movement, sorting, case conversion,
  indentation, whitespace display, and trailing-space removal.
- Find/replace with match case, whole word, regular expressions, and capture-group
  replacements such as `$1`; search across open tabs or a selected local folder.
- Bookmarks, go to line, cloned split views, different documents in split views,
  a coding key panel with Shift/Ctrl/Alt and keyboard-style arrows, keyboard
  shortcuts, and local macro recording/playback.
- Two visible rows for menus and tool icons. On Android, menus stay open while
  the on-screen keyboard hides.
- Light and dark themes, font zoom, word wrap, configurable indentation.

## Local files

On Android, open and save through the system document picker. Choose **Internal
storage** or an SD card to keep documents local. On desktop, native file dialogs
open and save local paths. “Open folder as workspace” browses a folder you
select. The Android build does not request broad storage access.

Supported output encodings: UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, Windows-1252,
ISO-8859-1, and ASCII. Line endings: CRLF, LF, and CR. UTF-8 and BOM encodings
are detected on open, with Windows-1252 as the legacy fallback. Explicit
“Reload using encoding” is available. Mixed line endings produce a notification
and are normalized to the detected predominant style when saved. Unsupported
characters are rejected rather than silently replaced during encoding.

The app warns before overwriting a file changed by another editor. Unsaved work
is saved in a private recovery snapshot; this does not automatically overwrite
your documents. Android cloud backup is disabled. Local editor assets are
bundled in each package, and remote navigation is blocked. The Android manifest
declares **no permissions**.

## Scope and limits

AnoteP is not an official Notepad++ release. Windows 1.2.0 is an unofficial
modified build of its native C++/Scintilla source, with AnoteP branding and
updates/plugin downloads disabled. The complete patched source is provided
with the Windows release under GPL-3.0.

Android/Linux remain independent CodeMirror 5.65.20 (MIT) implementations;
Notepad++ plugins, code execution, FTP, spell checking, and full native feature
parity are not included in those editions.

Android/Linux limits are 8 MB per document, 30 tabs, and a 32 MB recovery snapshot.
Folder search scans up to 500 files / 16 MB / 200 directories and returns up to
200 matching lines, skipping binary files and files above 1 MB. Macro recording
covers text edits, simple cursor movement, and editing commands; it does not
record file-picker interactions.

## Desktop builds

Windows 1.2.0 replaces Electron with the native Notepad++/Scintilla codebase.
It ships no browser engine or downloaded runtime. Both 32-bit x86 and 64-bit x64
interactive installers and portable ZIPs are built; CI rejects installers at or
above 12 MiB. Installers are unsigned and may show a Windows publisher warning.

Use Visual Studio C++ tools, the Windows SDK, Python 3.12+ and NSIS:

```powershell
./native/windows/build.ps1 -Arch x64 -SourceArchive
./native/windows/build.ps1 -Arch ia32 -Source build/native-source
```

See [native Windows build/recovery/license details](native/windows/README.md).
Old Electron workspace.json is preserved; its tabs are exported once to recovered
copies. The native interface and preference/session format follow Notepad++.

Linux 1.3.0 also removes the bundled Electron runtime. A small Python/GTK host
uses the distribution's WebKitGTK 4.1 library with the same bundled editor UI.
Both `.deb` and portable `.tar.xz` packages support x64 and ARM64. The build
rejects either app download at 1 MiB or larger. These sizes exclude shared
runtime libraries; this is not a self-contained AppImage.

On Debian 12+/Ubuntu 22.04+ with current updates, install the `.deb` with:

```sh
sudo apt install ./AnoteP-1.3.0-linux.deb
anotep
```

For portable use, install the shared runtime once, extract to a writable folder,
and run the launcher. Its `profile/` directory holds preferences and recovery:

```sh
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
tar -xf AnoteP-1.3.0-linux-portable.tar.xz
./AnoteP-1.3.0/anotep
```

Build both Linux packages using `python3 native/linux/build.py` (Python 3 and
`dpkg-deb`; no npm needed), or `npm run dist -- --linux`. See
[small Linux details](native/linux/README.md) for dependencies, portable profiles,
recovery compatibility and tests. Installed builds reuse the previous Electron
workspace location/schema. `npm run dist -- --win ...` routes to the small
native Windows build and refuses Electron Windows cross-builds on Linux.
CI: `.github/workflows/windows-native.yml` (Windows) and
`.github/workflows/desktop-release.yml` (Linux).

## Android build

The source, editor assets, and licenses are included. The Android build does not
download dependencies. Install JDK 17 or newer, Python 3, Node.js, and the Android
build tools `aapt`, `zipalign`, `apksigner`, and `keytool`. Supply an Android API jar,
a resource platform jar for API 34+, and an R8/D8 jar:

```sh
export ANOTEP_ANDROID_JAR=/path/to/platforms/android-34/android.jar
export ANOTEP_RESOURCE_JAR="$ANOTEP_ANDROID_JAR"
export ANOTEP_R8_JAR=/path/to/build-tools/35.0.0/lib/d8.jar
bash scripts/build.sh
```

Output: `dist/AnoteP-v1.0.apk`, signed with a locally generated development key
under `.tools/`. Keep that key to sign compatible future updates. Keys and
generated outputs are excluded from Git. Release signing keys are never included
in the APK or source repository.

For native development, `ANOTEP_DEBUG=1 bash scripts/build.sh` generates
`build/AnoteP-debug.apk` with WebView debugging enabled. The release build disables
debugging. Do not publish the debug APK.

## Verification

`scripts/build.sh` runs 61 Java file-fidelity checks, 19 JavaScript editing
checks, 24 language-detection checks, signature and alignment checks, and an APK
audit for bundled assets, application identity, and absence of permissions.
`npm test` checks desktop text encoding and line-ending fidelity.
`npm run test:desktop` tests the archived Electron host and checks the isolated bridge,
local open/save and Save As, encoding preservation, external-change conflicts,
folder search, system clipboard, split view, network blocking, and recovery of
an edit made immediately before closing. On headless Linux, run it with
`xvfb-run -a npm run test:desktop`.

Windows native CI installs, tests and uninstalls each generated installer,
then tests its portable ZIP with Win32/Scintilla checks. Those tests cover
Unicode/BOM/CRLF, save, undo/redo, lexers, split view, macros, Find, clean close
and previous Electron-workspace recovery. Linux CI tests file fidelity and
the actual WebKitGTK editor on x64 and ARM64, verifies the architecture-independent
packages, runs both extracted payloads, installs/removes the `.deb`, and checks
the size limit and checksums. Local Linux tests:

```sh
python3 -m unittest discover -s native/linux -p 'test_*.py' -v
xvfb-run -a dbus-run-session -- python3 native/linux/smoke-test.py
```

For browser integration tests, install Playwright separately, install Chromium,
then run:

```sh
ANOTEP_PLAYWRIGHT=/path/to/node_modules/playwright node scripts/browser-test.cjs
```

These tests cover tabs, syntax modes, search/replace, undo, line operations,
bookmarks, split views, saving, conflict handling, edits made during saves,
macros, clipboard, recovery, folders, menus, mobile sizing, and external requests.
They simulate the Android bridge and do not replace on-device testing.

The initial release also passed native save/reload, Unicode/BOM/CRLF fidelity,
local recovery, modifier-key, menu/keyboard, and theme checks on an ARM64 phone
running Android 14. The published APK has WebView debugging disabled.

## License

Native Windows 1.2.0 derivative: GPL-3.0, with upstream copyright and third-party
notices retained and complete corresponding source supplied.

Original AnoteP Android/Linux code and artwork: MIT. CodeMirror and modes/addons:
MIT; see `app/src/main/assets/vendor/LICENSE-CodeMirror.txt`. Attribution is also
available inside the app under **? → Open source licenses**.

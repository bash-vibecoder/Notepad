# AnoteP

An offline text and source-code editor inspired by the classic Notepad++
workflow, with light menus, green accents, document tabs, line numbers, and an
original penguin-and-notepad icon on a black background. Android and desktop
builds bundle the editor and language modes locally and block remote navigation
and network requests.

[Download Android APK](https://github.com/bash-vibecoder/Notepad/releases/tag/v1.0)
or [desktop installers](https://github.com/bash-vibecoder/Notepad/releases/latest).

The Android APK supports Android 8.0 or newer and runs on ARM64, ARMv7, and x86;
it contains no architecture-specific native libraries. Desktop releases provide
Windows x86 and x64 installers, plus Linux x64 and ARM64 AppImage and `.deb`
packages. There are no accounts, ads, or analytics.

<p>
  <img src="docs/screenshots/light.png" width="280" alt="AnoteP light theme with two rows of menus and keyboard controls">
  <img src="docs/screenshots/dark.png" width="280" alt="AnoteP dark theme">
</p>

## Editing

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

AnoteP is an independent implementation, not an official Notepad++ release or a
build of its Windows source. The editor uses CodeMirror 5.65.20 (MIT), not
Scintilla. Notepad++ plugins, code execution, FTP, spell checking, and complete
Notepad++ feature parity are not included. Notepad++ source code and the original
logo are not bundled.

The current limits are 8 MB per document, 30 tabs, and a 32 MB recovery snapshot.
Folder search scans up to 500 files / 16 MB / 200 directories and returns up to
200 matching lines, skipping binary files and files above 1 MB. Macro recording
covers text edits, simple cursor movement, and editing commands; it does not
record file-picker interactions.

## Desktop builds

The Windows installer is interactive and lets users choose the install folder.
It creates Start Menu and desktop shortcuts. Separate installers are built for
32-bit x86 and 64-bit x64 Windows. Linux releases include portable x64 and ARM64
AppImages and matching Debian packages. Windows installers are unsigned, so
Windows may show its standard publisher warning when first opening them.

With Node.js 22 or newer, install dependencies and build a Windows x64 installer
with:

```sh
npm ci
npm test
npm run dist -- --win nsis --x64
```

Change `--x64` to `--ia32` for 32-bit Windows, or use
`--linux AppImage deb --x64` / `--arm64` for Linux packages. Linux desktop builds
need GTK 3, NSS, XSS, and XTest system libraries. CI builds release packages on
native Windows and Linux runners; see `.github/workflows/desktop-release.yml`.

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
`npm run test:desktop` runs the real Electron app and checks the isolated bridge,
local open/save and Save As, encoding preservation, external-change conflicts,
folder search, system clipboard, split view, network blocking, and recovery of
an edit made immediately before closing. On headless Linux, run it with
`xvfb-run -a npm run test:desktop`.

Release CI installs each generated Windows installer and runs the desktop tests
against the installed app. Linux jobs verify the AppImage and Debian package
architectures and run the desktop tests against the packaged executable.

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

AnoteP code and original artwork: MIT. CodeMirror and its bundled modes/addons:
MIT; see `app/src/main/assets/vendor/LICENSE-CodeMirror.txt`. Attribution is also
available inside the app under **? → Open source licenses**.

# AnoteP 1.4.0 — one editor, one version

All Android, Windows and Linux variants are rebuilt as 1.4.0. Root VERSION
controls internal versions, package metadata, About dialogs and filenames;
publication rejects stale versions and differing editor assets.

Windows now uses the same AnoteP editor assets as the Android APK and Linux,
instead of the separate Notepad++ UI. This brings the APK's automatic language
detection, manual override, coding keys/modifiers, menus, local macros, split
views, recovery and offline UI behavior to Windows. A small original C++/Win32
host supplies native file dialogs, clipboard, encodings and atomic storage.
Prior native session/backup text is imported without changing the originals.
The shared editor also snapshots during continuous typing, not just after idle.
Rapid Windows relaunches retry a busy system WebView2 runtime for up to ten
seconds, preserving the existing profile and recovery data.

No engine/runtime is bundled or downloaded by the app. Windows requires the
system WebView2 Runtime; Linux requires system WebKitGTK and Python/GTK. Those
runtime sizes are separate. Windows app downloads are capped below 5 MiB;
Android and Linux app downloads below 1 MiB. The Android APK is rebuilt with
its existing signing identity even where Android features are unchanged.

See docs/FEATURES.md for the feature inventory, native adapter differences,
shared limits and legacy native-preference migration limits.

# AnoteP Windows 1.2.1

Fixes scratch tabs disappearing after closing: normal launches enable session
and snapshot recovery, including existing disabled profiles. Native recovery
copies update every second and on normal close; a failed final recovery write
keeps the editor open. First-run configuration is bundled and nested profile
directories are created recursively. Original documents are not overwritten.

Installers now require elevation and default to Program Files (x64) or Program
Files (x86) (x86 on 64-bit Windows), with system-wide shortcuts and registration.
Each user's AppData recovery and preferences survive uninstall. Portable ZIPs
retain local profiles. CI tests actual default installation paths, scratch
close/restart, periodic crash recovery, disabled-profile upgrade and failed
recovery writes in both installed and portable editions on x86/x64.

# AnoteP Linux 1.3.0

Replaces bundled Electron on Linux with a small Python/GTK host using the system
WebKitGTK runtime. Architecture-independent `.deb` and portable `.tar.xz`
packages support x64 and ARM64, with a strict 1 MiB app-download ceiling.
Shared Python/GTK/WebKitGTK runtime dependencies are separate; the portable
archive is not a self-contained AppImage.

Preserves the existing bundled editor/language modes, GTK file dialogs,
clipboard, file-change conflicts, encoding/line-ending fidelity, folder search
and local recovery. Close waits for the final recovery write. Installed builds
reuse Electron's workspace location and schema; portable profiles stay beside
the launcher. Network/navigation blocking is enabled before editor startup.
CI verifies both packaged payloads on x64 and ARM64 before publishing.
Windows 1.2.0 and Android 1.0 are unchanged.

# AnoteP Windows 1.2.0

Replaces the large Electron Windows edition with a native C++/Scintilla build
based on Notepad++ 8.9.9.1. Separate x86/x64 installers and portable ZIPs; no
Chromium, Node.js, WebView2 or runtime downloader. The build enforces a 12 MiB
installer ceiling.

Uses the native Notepad++ interface and editing features with the AnoteP name,
penguin icon and separate native settings. Automatic updates and plugin downloads
are disabled. Existing Electron workspace text is exported as recovery copies;
originals and the old workspace.json are preserved. The Windows derivative is
GPL-3.0 and includes full corresponding source. Android/Linux are unchanged.

# AnoteP Desktop 1.1.0

Adds an offline Windows and Linux desktop app using the same local editor and
bundled language modes as AnoteP for Android.

- Windows interactive installers for 32-bit x86 and 64-bit x64, with optional
  install-folder selection and Start Menu / desktop shortcuts.
- Linux x64 and ARM64 portable AppImages and Debian `.deb` packages.
- Native local open/save dialogs, folder browsing and search, clipboard access,
  local workspace recovery, text encodings, line endings, and external-change
  conflict warnings.
- Remote navigation and network requests blocked; renderer Node.js access
  disabled.

Windows installers are unsigned. Android remains at version 1.0.

# AnoteP 1.0

First Android release. Independent Notepad++ inspired editor with a black
adaptive launcher icon featuring a penguin, classic light and optional dark
themes, and two rows of menus and tool icons.

- Fully local editing, all language modes bundled, no Internet permission,
  no accounts or analytics, and Android cloud backup disabled.
- Tabs, local unsaved-work recovery, syntax highlighting, automatic language
  detection from filenames and contents, and per-document language overrides.
- Literal and regex find/replace, capture groups, search in open tabs and local
  folders, bookmarks, folding, split views, line transforms, and macros.
- Shift/Ctrl/Alt modifier buttons, an inverted T arrow cluster, shortcut keys,
  and symbols. Menus stay open when the Android keyboard dismisses.
- Local Android file/folder pickers, text encoding and line-ending controls,
  and a conflict prompt when a file changes outside AnoteP.

Android 8.0+ and a current Android System WebView. 8 MB per file, 30 tabs,
32 MB recovery workspace. Desktop Notepad++ plugins and full feature parity
are outside this release.

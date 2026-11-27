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

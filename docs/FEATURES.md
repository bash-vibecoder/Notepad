# Android feature baseline, shared by AnoteP 1.4.0

The inventory was taken from the actual Android editor assets, Android native
bridge, editing/language tests and browser integration checks. Windows and Linux
now package the exact same `app/src/main/assets/` files. The package auditor
compares every one of those files byte-for-byte against the release source.

| Android AnoteP feature | Android | Windows | Linux |
| --- | --- | --- | --- |
| Filename, shebang and content language detection while typing | Shared editor | Shared editor | Shared editor |
| Per-tab manual language override and Auto detect toggle | Shared editor | Shared editor | Shared editor |
| 121 bundled modes, no language downloads | Shared editor | Shared editor | Shared editor |
| Tabs, scratch recovery, cursors, bookmarks, preferences | Shared editor + native storage | Shared editor + native storage | Shared editor + native storage |
| Two-row menus/tools and coding-key panel | Shared editor | Shared editor | Shared editor |
| Shift/Ctrl/Alt, inverted-T arrows, symbols and shortcuts | Shared editor | Shared editor | Shared editor |
| Undo/redo, folds, brackets/tags, completion and comments | Shared editor | Shared editor | Shared editor |
| Line transforms, sort, indentation, whitespace and case | Shared editor | Shared editor | Shared editor |
| Find/replace, regex/captures, tabs and folder search | Shared editor + file bridge | Shared editor + file bridge | Shared editor + file bridge |
| Split views and local macros | Shared editor | Shared editor | Shared editor |
| Light/dark, zoom, wrap and preferences | Shared editor | Shared editor | Shared editor |
| Encodings, BOMs, LF/CRLF/CR and file-change conflicts | Java file bridge | C++ file bridge | Python file bridge |
| Native picker, local folders and system clipboard | Android document provider | Windows filesystem dialogs | GTK filesystem dialogs |
| Offline bundled UI, denied remote navigation/requests | No Internet permission + restrictions | Native filter + CSP | Native filter + CSP |

## What changed on Windows

The former Windows build was a separate Notepad++/Scintilla UI. Rebranding that
UI did not give it Android AnoteP's content-based detection, coding keys or
identical behavior. The current Windows build uses a small original Win32/C++
host around the shared AnoteP editor, with native file dialogs, clipboard,
encoding conversion, atomic recovery and protection against external changes.
It does not bundle Electron or a browser engine. The former native session's
text is imported without deleting its session or backup files.

## Deliberate platform differences and limits

- OS pickers and file identifiers differ: Android uses document-provider URIs;
  Windows/Linux use local file URIs. Paths cannot automatically follow a copied
  profile to a different operating system; Save As is available.
- Runtime prerequisites differ: Android system WebView; Windows system
  WebView2; Linux Python/PyGObject/GTK/WebKitGTK. Runtime installation sizes are
  excluded from app downloads and can be large. No runtime downloader ships.
- The Android software-keyboard dismissal fix is relevant on Android; menus,
  coding keys and resize handling otherwise come from the same editor code.
- Shared limits are 8 MB/document, 30 tabs and 32 MB/recovery workspace. Folder
  traversal/result limits remain bounded. Filesystem permissions and native
  regex/file service behavior are subject to each platform's adapter.
- This is the Android AnoteP baseline, not a promise of every native Notepad++
  feature. Native plugins, function lists, advanced native macros and themes
  from the old fork are not translated. Their old files remain untouched.
- Forced termination can lose edits after the last completed recovery write;
  normal desktop close waits for a final durable snapshot and refuses to close
  on a failed write. Individual tab discard is intentional deletion.

## One version and enforced small downloads

`VERSION` is 1.4.0 for every current distribution, internal About/version field,
package metadata, filename and release. Android is rebuilt and re-signed with
its original key even without Android-specific changes. Future releases must
also rebuild all variants under one version.

Windows installers and portable ZIPs must stay below 5 MiB. APK and Linux app
packages must stay below 1 MiB. Build and publication checks enforce the budgets
and reject stale/mismatched editor assets rather than relabel old binaries.

The browser tests exercise the shared APK baseline. Windows CI exercises real
WebView2 and native operations; Linux CI exercises real WebKitGTK and both
packaged payloads on x64/ARM64. Android audits check its signature, manifest,
absence of permissions/debugging, ABI independence and shared packaged assets.

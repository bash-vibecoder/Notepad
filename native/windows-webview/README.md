# AnoteP shared Windows host

This original MIT-licensed Win32/C++ host runs exactly the same bundled AnoteP
editor assets as Android and Linux. It does not use the earlier Notepad++ fork,
Electron or a bundled browser engine. Windows x86/x64 installers and portable
ZIPs must each remain below 5 MiB. VERSION drives every build and About dialog.

The Microsoft Edge WebView2 Runtime must already be installed. If missing, use
Microsoft's matching offline runtime installer separately. AnoteP never fetches
or installs a runtime and does not open remote pages. App sizes exclude that
shared runtime, as Android sizes exclude its system WebView and Linux sizes
exclude system WebKitGTK. File access, file dialogs, clipboard, recovery and
encoding conversion are implemented by this small native host.

All editor features are shared: filename/shebang/content language detection,
manual language override, 121 bundled modes, menus and coding keys, modifiers,
tabs, find/replace, folder search, macros, bookmarks, split views, preferences,
encodings, line endings, file-change conflicts and scratch recovery. Windows
uses ordinary filesystem dialogs; Android uses the system document provider.

Installed builds default to Program Files (x64) or Program Files (x86) (x86 on
64-bit Windows) and request elevation only for installation. Runtime recovery
is under %APPDATA%\AnoteP\workspace.json. Portable builds keep profile\ beside
the executable. One running process owns each profile to prevent simultaneous
instances overwriting scratch recovery; --profile selects another profile.

Close waits for the final recovery snapshot to be flushed to disk. A failed
write keeps the editor open. Periodic recovery protects against termination;
edits after the last completed snapshot can still be lost on forced exit.
An immediate relaunch retries a busy WebView2 runtime for up to ten seconds
while the previous runtime releases the profile. Recovery and cache files are
preserved. Other startup failures report their error code.

On first shared-host launch, the previous native session.xml and its backup
files are read into the shared workspace. Those files and original documents
are never modified/deleted. Existing shared workspace data is retained and a
pre-import copy is saved. A migration report lists tabs that exceed current
limits and remain available in the original native profile. Native Notepad++
macros/themes/plugin settings are not translated; this release uses the
Android AnoteP feature baseline. Previous installed native binaries are left
intact in their separate AnoteP Native folder; uninstall them only after
checking the imported scratch tabs.

Build with Visual Studio C++ desktop tools, the Windows SDK, Python 3 and NSIS:

    powershell -File native/windows-webview/build.ps1 -Arch x64
    powershell -File native/windows-webview/build.ps1 -Arch ia32

Only the pinned, SHA-256-verified WebView2 SDK is fetched at build time. Its
static loader is linked into AnoteP; the browser runtime is not included.
The application, shared UI and JSON library licenses accompany the packages.
The older GPL-licensed native Windows build remains in native/windows solely
for historical builds; it is not part of this host or its application package.

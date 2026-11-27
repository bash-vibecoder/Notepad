# Shared Linux edition — AnoteP 1.4.0

The `.deb` and portable `.tar.xz` contain the editor, all 121 bundled language
modes, artwork and a small Python/GTK host. They no longer bundle Electron,
Chromium or Node.js. The build rejects either download at 1 MiB or larger.
The same architecture-independent files run on x86-64 and ARM64 Linux.

**These packages use the system WebKitGTK runtime.** Their download sizes do
not include Python, GTK, PyGObject or WebKitGTK. If those are missing, installing
them can add tens of MB of downloads and considerably more installed space.
This is the same shared-runtime approach as the Android edition, rather than
a self-contained browser bundle. Windows keeps its separate native Scintilla
edition. The portable archive is not a self-contained AppImage.

## Debian / Ubuntu installation

Debian 12+ or Ubuntu 22.04+ with current updates and WebKitGTK 2.40+:

```sh
sudo apt install ./AnoteP-1.4.0-linux.deb
anotep
```

APT resolves the declared Python, GTK and WebKitGTK dependencies. Install the
system libraries once while online; running AnoteP needs no connection.

## Portable archive

Install the system runtime if it is not already present:

```sh
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
tar -xf AnoteP-1.4.0-linux-portable.tar.xz
./AnoteP-1.4.0/anotep
```

Extract to a writable directory. The executable launcher runs directly with no
app installation and keeps preferences/recovery in `AnoteP-1.4.0/profile/`, next
to the launcher. The package does not download or install anything itself.
To use another profile: `./anotep --profile /path/to/profile`.
Other desktop Linux distributions need equivalent Python 3.10+, PyGObject,
GTK 3 and WebKit2GTK 4.1 packages. This is a desktop app, not an Android APK.

The installed edition reuses `~/.config/AnoteP/workspace.json` (or the same path
under `$XDG_CONFIG_HOME`), preserving the previous Electron recovery schema.
Portable mode uses its own profile by default. Original document files are
written only by an explicit Save action. Removing the `.deb` does not remove
the profile or documents.

## Features and offline operation

The existing CodeMirror UI remains: tabs, syntax highlighting, automatic language
detection, find/replace, folder search, split views, macros, encodings, line
endings and local recovery. File dialogs and clipboard use GTK. Close waits for
the final workspace snapshot to reach disk, including edits before the recovery
timer fires. File changes outside AnoteP trigger an overwrite confirmation.

Remote requests are blocked by both the HTML content policy and a WebKit content
filter compiled before startup. Remote navigation, popups, downloads and web
permission requests are denied. The WebKit session is ephemeral; local workspace
data is stored explicitly by the host. No browser or runtime is downloaded by
the app. Keep the shared runtime patched with your distribution's updates.

## Build and verify

Building needs Python 3 and `dpkg-deb`; it does not need npm or a GUI:

```sh
python3 -m unittest discover -s native/linux -p 'test_*.py' -v
python3 native/linux/build.py
```

Output is under `release/`: `.deb`, portable `.tar.xz` and `SHA256SUMS-linux.txt`.
Builds exclude caches, profiles, keys, dependencies, tests and Windows source.
The tar archive is normalized, and `SOURCE_DATE_EPOCH` controls timestamps.

Test the actual GUI and bridge (runtime packages plus `xvfb`, `xauth` and
`dbus-x11` on headless systems):

```sh
xvfb-run -a dbus-run-session -- python3 native/linux/smoke-test.py
```

CI runs file tests and real GUI tests on x86-64 and ARM64, extracts and checks
both packages, installs/removes the `.deb`, and tests both payloads before a
release is published. Tests cover open/save, BOM/Unicode/CRLF, conflict handling,
folder search, clipboard, split view, syntax, request/navigation blocking and
close/relaunch recovery. No test-only IPC or bypass is shipped.

Original host code/artwork: MIT. CodeMirror and its bundled modes: MIT.

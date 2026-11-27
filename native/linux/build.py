#!/usr/bin/python3
"""Build architecture-independent Debian and portable packages without Electron."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VERSION = '1.3.0'
OUTPUT = ROOT / 'release'
EPOCH = int(os.environ.get('SOURCE_DATE_EPOCH', '1795737600'))  # 2026-11-27 UTC
LIMIT = 1024 * 1024


def write(path, text, executable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    path.chmod(0o755 if executable else 0o644)


def payload(target):
    target.mkdir(parents=True, exist_ok=True)
    for name in ('main.py', 'core.py', 'bridge.js'):
        shutil.copyfile(HERE / name, target / name)
    shutil.copytree(ROOT / 'app/src/main/assets', target / 'assets')
    shutil.copyfile(ROOT / 'LICENSE', target / 'LICENSE')
    shutil.copyfile(HERE / 'README.md', target / 'README.md')
    for path in target.rglob('*'):
        path.chmod(0o755 if path.is_dir() else 0o644)


def main():
    OUTPUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='anotep-linux-build-') as temporary:
        temporary = Path(temporary)
        portable = temporary / f'AnoteP-{VERSION}'
        payload(portable)
        write(portable / 'anotep', '''#!/bin/sh
set -eu
ANOTEP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PYTHONDONTWRITEBYTECODE=1
exec /usr/bin/python3 "$ANOTEP_DIR/main.py" --profile "$ANOTEP_DIR/profile" "$@"
''', True)
        portable_archive = OUTPUT / f'AnoteP-{VERSION}-linux-portable.tar.xz'
        def normalized(info):
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mtime = EPOCH
            return info
        with tarfile.open(portable_archive, 'w:xz', preset=9) as archive:
            archive.add(portable, arcname=portable.name, filter=normalized)

        debroot = temporary / 'deb'
        payload(debroot / 'usr/share/anotep')
        write(debroot / 'usr/bin/anotep', '''#!/bin/sh
export PYTHONDONTWRITEBYTECODE=1
exec /usr/bin/python3 /usr/share/anotep/main.py "$@"
''', True)
        write(debroot / 'usr/share/applications/anotep.desktop', '''[Desktop Entry]
Type=Application
Name=AnoteP
Comment=Offline text and source-code editor
Exec=anotep %F
Icon=anotep
Terminal=false
Categories=Utility;TextEditor;Development;
MimeType=text/plain;text/x-c;text/x-c++;text/x-python;application/json;application/javascript;text/markdown;
StartupWMClass=AnoteP
''')
        icon = debroot / 'usr/share/icons/hicolor/scalable/apps/anotep.svg'
        icon.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'app/src/main/assets/icon.svg', icon)
        write(debroot / 'usr/share/doc/anotep/copyright', (ROOT / 'LICENSE').read_text() +
              '\nCodeMirror: MIT; see /usr/share/anotep/assets/vendor/LICENSE-CodeMirror.txt\n')
        size = sum(p.stat().st_size for p in debroot.rglob('*') if p.is_file())
        write(debroot / 'DEBIAN/control', f'''Package: anotep
Version: {VERSION}
Section: editors
Priority: optional
Architecture: all
Maintainer: AnoteP contributors <bash-vibecoder@users.noreply.github.com>
Installed-Size: {(size + 1023) // 1024}
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1 (>= 2.40)
Homepage: https://github.com/bash-vibecoder/Notepad
Description: Small offline text and source-code editor
 Local editor with bundled CodeMirror language modes, file dialogs,
 encoding controls, clipboard and unsaved-work recovery. Uses the system
 WebKitGTK runtime; no bundled Electron, Chromium or Node.js.
''')
        for path in debroot.rglob('*'):
            os.utime(path, (EPOCH, EPOCH))
        deb = OUTPUT / f'AnoteP-{VERSION}-linux.deb'
        subprocess.run(['dpkg-deb', '--root-owner-group', '-Zxz', '-z9', '--build', str(debroot), str(deb)],
                       check=True, env={**os.environ, 'SOURCE_DATE_EPOCH': str(EPOCH),
                                        'PATH': '/usr/bin:/bin:' + os.environ.get('PATH', '')})
        files = [deb, portable_archive]
        for file in files:
            if file.stat().st_size >= LIMIT:
                raise SystemExit('Small-package size limit (1 MiB) exceeded: ' + str(file))
            print(f'{file.name}: {file.stat().st_size:,} bytes')
        checksums = OUTPUT / 'SHA256SUMS-linux.txt'
        checksums.write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in files))


if __name__ == '__main__':
    main()

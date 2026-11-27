#!/usr/bin/env python3
"""Verify unified versions, identical editor assets and strict package sizes."""
import argparse
import ast
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / 'VERSION').read_text().strip()
ASSETS = ROOT / 'app/src/main/assets'


def asset_hash(data):
    return hashlib.sha256(data).hexdigest()


def shared(read, prefix, desktop=False):
    count = 0
    for file in sorted(ASSETS.rglob('*')):
        if not file.is_file():
            continue
        name = file.relative_to(ASSETS).as_posix()
        assert read(prefix + name) == file.read_bytes(), 'Editor asset differs: ' + name
        count += 1
    assert VERSION in read(prefix + 'version.js').decode(), 'Bundled app version mismatch'
    return count


def windows_source(read):
    metadata = json.loads(read('source-metadata.json'))
    assert metadata['version'] == VERSION
    for name, digest in metadata['files'].items():
        assert asset_hash((ROOT / name).read_bytes()) == digest, 'Windows build input changed: ' + name
    assert asset_hash(read('AnoteP.exe')) == metadata['executableSha256'], 'Windows executable differs from its verified build'


def ar(data):
    assert data[:8] == b'!<arch>\n', 'Invalid Debian ar archive'
    parts = {}
    offset = 8
    while offset < len(data):
        header = data[offset:offset + 60]
        assert header[58:60] == b'`\n'
        size = int(header[48:58].decode().strip())
        name = header[:16].decode().strip().rstrip('/')
        parts[name] = data[offset + 60:offset + 60 + size]
        offset += 60 + size + size % 2
    return parts


def tar_files(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        return {entry.name.removeprefix('./'): archive.extractfile(entry).read()
                for entry in archive.getmembers() if entry.isfile()}


def audit(file):
    assert VERSION in file.name, 'Package filename must contain VERSION: ' + file.name
    maximum = 5 * 1024 * 1024 if '-win-' in file.name else 1024 * 1024
    assert file.stat().st_size < maximum, 'Size budget exceeded: ' + file.name
    if file.suffix == '.exe':
        assert file.read_bytes()[:2] == b'MZ'
        return 'size/PE signature (installed payload is verified by Windows CI)'
    if file.suffix in ('.apk', '.zip'):
        with ZipFile(file) as archive:
            names = archive.namelist()
            assert not any(n.endswith(('.jks', '.keystore', '.pyc')) or 'node_modules' in n for n in names)
            assert not any(n.lower().endswith(('electron.exe', 'msedgewebview2.exe', 'chrome.exe')) for n in names)
            prefix = 'assets/'
            count = shared(archive.read, prefix)
            if file.suffix == '.apk':
                assert not any(n.startswith('lib/') for n in names), 'APK must stay architecture-independent'
                assert 'classes.dex' in names
            else:
                assert archive.read('bridge.js') == (ROOT / 'desktop/bridge.js').read_bytes()
                assert 'portable.flag' in names and 'AnoteP.exe' in names
                windows_source(archive.read)
        return f'{count} identical editor assets'
    if file.suffix == '.deb':
        parts = ar(file.read_bytes())
        control = tar_files(next(value for name, value in parts.items() if name.startswith('control.tar')))['control'].decode()
        assert re.search(r'^Version: ' + re.escape(VERSION) + r'$', control, re.M)
        assert 'Architecture: all' in control
        files = tar_files(next(value for name, value in parts.items() if name.startswith('data.tar')))
        prefix = 'usr/share/anotep/'
    elif file.name.endswith('.tar.xz'):
        files = tar_files(file.read_bytes())
        prefix = 'AnoteP-' + VERSION + '/'
        assert prefix + 'anotep' in files
    else:
        raise AssertionError('Unsupported package: ' + str(file))
    count = shared(files.__getitem__, prefix + 'assets/')
    assert files[prefix + 'bridge.js'] == (ROOT / 'desktop/bridge.js').read_bytes()
    version_source = files[prefix + 'version.py'].decode()
    assignment = next(node for node in ast.parse(version_source).body if isinstance(node, ast.Assign))
    assert ast.literal_eval(assignment.value) == VERSION
    for name in ('main.py', 'core.py', 'version.py'):
        assert files[prefix + name] == (ROOT / 'native/linux' / name).read_bytes(), 'Linux host differs: ' + name
    return f'{count} identical editor assets; internal version {VERSION}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('packages', type=Path, nargs='*')
    parser.add_argument('--installed', type=Path)
    args = parser.parse_args()
    if args.installed:
        count = shared(lambda name: (args.installed / name).read_bytes(), 'assets/')
        assert (args.installed / 'bridge.js').read_bytes() == (ROOT / 'desktop/bridge.js').read_bytes()
        windows_source(lambda name: (args.installed / name).read_bytes())
        print(f'Installed Windows payload: {count} identical editor assets verified.')
    for file in args.packages:
        print(file.name + ': ' + audit(file) + f'; {file.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()

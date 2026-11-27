#!/usr/bin/env python3
"""VERSION is authoritative for every binary, package and shared About dialog."""
import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def synchronize(check=False):
    version = (ROOT / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise SystemExit('VERSION must contain MAJOR.MINOR.PATCH')
    major, minor, patch = map(int, version.split('.'))
    code = major * 10000 + minor * 100 + patch
    outputs = {
        ROOT / 'native/linux/bridge.js': (ROOT / 'desktop/bridge.js').read_text(),
        ROOT / 'app/src/main/assets/version.js':
            '// Generated from VERSION; edit VERSION, then run scripts/sync-version.py.\n'
            'Object.defineProperty(window, "ANOTEP_VERSION", {value: ' + json.dumps(version) + '});\n',
        ROOT / 'native/linux/version.py':
            '# Generated from VERSION.\nVERSION = ' + repr(version) + '\n',
        ROOT / 'native/windows-webview/version.h':
            '// Generated from VERSION.\n#pragma once\n'
            '#define ANOTEP_VERSION "' + version + '"\n'
            '#define ANOTEP_VERSION_W L"' + version + '"\n'
            f'#define ANOTEP_VERSION_NUM {major},{minor},{patch},0\n',
    }
    manifest = ROOT / 'app/src/main/AndroidManifest.xml'
    text = manifest.read_text()
    text = re.sub(r'android:versionCode="\d+"', f'android:versionCode="{code}"', text)
    text = re.sub(r'android:versionName="[^"]+"', f'android:versionName="{version}"', text)
    outputs[manifest] = text
    native_manifest = ROOT / 'native/windows-webview/app.manifest'
    if native_manifest.exists():
        outputs[native_manifest] = re.sub(r'(<assemblyIdentity version=")[^"]+', r'\g<1>' + version + '.0', native_manifest.read_text())
    for name in ('package.json', 'package-lock.json'):
        path = ROOT / name
        data = json.loads(path.read_text())
        data['version'] = version
        if '' in data.get('packages', {}):
            data['packages']['']['version'] = version
        outputs[path] = json.dumps(data, indent=2) + '\n'
    drift = []
    for path, content in outputs.items():
        if path.exists() and path.read_text() == content:
            continue
        drift.append(str(path.relative_to(ROOT)))
        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    if check and drift:
        raise SystemExit('Version drift: ' + ', '.join(drift))
    print('Unified version ' + version + (' verified.' if check else ' synchronized.'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    synchronize(parser.parse_args().check)

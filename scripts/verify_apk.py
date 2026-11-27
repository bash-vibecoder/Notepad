#!/usr/bin/env python3
"""Check the packaged manifest, offline assets, and executable payload."""
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

apk = Path(sys.argv[1])
permissions = subprocess.check_output(['aapt', 'dump', 'permissions', str(apk)], text=True)
assert 'uses-permission' not in permissions, permissions
manifest = subprocess.check_output(['aapt', 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
assert re.search(r'allowBackup[^\n]*0x0', manifest), 'Android backup must be disabled'
assert re.search(r'usesCleartextTraffic[^\n]*0x0', manifest), 'Cleartext traffic must be disabled'
if 'debug' not in apk.name.lower():
    assert not re.search(r'debuggable[^\n]*0xffffffff', manifest), 'Release must not be debuggable'
badging = subprocess.check_output(['aapt', 'dump', 'badging', str(apk)], text=True)
assert "package: name='app.anotep.editor'" in badging
assert "application-label:'AnoteP'" in badging
version = (Path(__file__).resolve().parents[1] / 'VERSION').read_text().strip()
assert "versionName='" + version + "'" in badging, 'APK internal version must match VERSION'
assert "sdkVersion:'26'" in badging
assert "targetSdkVersion:'34'" in badging
with ZipFile(apk) as archive:
    names = set(archive.namelist())
    for name in ['classes.dex', 'assets/index.html', 'assets/app.css', 'assets/app.js',
                 'assets/editor-core.js', 'assets/icon.svg', 'assets/licenses.txt',
                 'assets/version.js',
                 'assets/vendor/codemirror.js', 'assets/vendor/codemirror.css',
                 'assets/vendor/LICENSE-CodeMirror.txt']:
        assert name in names, 'Missing packaged file: '+name
    html = archive.read('assets/index.html').decode()
    for path in re.findall(r'(?:src|href)="([^"#]+)"', html):
        assert not path.startswith(('http:', 'https:', '//')), 'Remote asset: '+path
        assert 'assets/'+path in names, 'Missing referenced asset: '+path
    assert not any(name.endswith(('.jks', '.keystore')) for name in names), 'Signing keys must not be packaged'
    assert 'res/mipmap-anydpi-v26/ic_launcher.xml' in names, 'Adaptive icon must be packaged'
print('APK verified: AnoteP, Android 8+, no permissions, backup disabled, all editor assets bundled.')

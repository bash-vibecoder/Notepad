#!/usr/bin/env python3
"""Publish only rebuilt, audited packages sharing the exact root VERSION."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / 'VERSION').read_text().strip()
TAG = 'v' + VERSION
REPO = os.environ['GITHUB_REPOSITORY']
TOKEN = os.environ['GH_TOKEN']
RELEASE_ID = int(os.environ['RELEASE_ID'])
BASE = 'https://api.github.com/repos/' + REPO
STAGE = ROOT / 'release'


def api(endpoint, method='GET', payload=None, binary=False):
    url = endpoint if endpoint.startswith('https://') else BASE + endpoint
    data = payload if binary else None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, method=method, data=data, headers={
        'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream' if binary else 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=120) as response:
        value = response.read()
        return json.loads(value) if value else None


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate():
    subprocess.run([sys.executable, str(ROOT / 'scripts/sync-version.py'), '--check'], check=True)
    release = api('/releases/' + str(RELEASE_ID))
    assert release['draft'] and release['tag_name'] == TAG, 'Expected the unified-version draft'
    for variable, workflow in [('WINDOWS_RUN', '.github/workflows/windows-native.yml'),
                                ('LINUX_RUN', '.github/workflows/desktop-release.yml')]:
        run = api('/actions/runs/' + str(int(os.environ[variable])))
        assert run['status'] == 'completed' and run['conclusion'] == 'success', variable
        assert run['path'] == workflow and run['head_repository']['full_name'] == REPO, variable
    print('Successful Windows/Linux CI runs and unified ' + TAG + ' draft verified.', flush=True)
    return release


def download_draft_asset(asset, path):
    # Keep credentials on api.github.com; do not forward them to the CDN.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    request = urllib.request.Request(BASE + '/releases/assets/' + str(asset['id']), headers={
        'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/octet-stream'})
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=60)
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        response = urllib.request.urlopen(error.headers['Location'], timeout=90)
    with response, path.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    assert path.stat().st_size == asset['size'] and asset.get('digest') == 'sha256:' + sha(path)


def publish():
    release = validate()
    STAGE.mkdir(exist_ok=True)
    names = [f'AnoteP-{VERSION}-win-{arch}{suffix}'
             for arch in ('ia32', 'x64') for suffix in ('.exe', '-portable.zip')]
    names += [f'AnoteP-{VERSION}-linux.deb', f'AnoteP-{VERSION}-linux-portable.tar.xz']
    apk = f'AnoteP-{VERSION}-android.apk'
    existing = {asset['name']: asset for asset in release['assets']}
    assert apk in existing, 'Upload the newly rebuilt, signed Android APK to this draft first'
    download_draft_asset(existing[apk], STAGE / apk)
    names.append(apk)
    for name in names:
        assert (STAGE / name).is_file(), 'Missing current variant: ' + name
    subprocess.run([sys.executable, str(ROOT / 'scripts/audit-packages.py'), *map(str, [STAGE / name for name in names])], check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify_apk.py'), str(STAGE / apk)], check=True)
    certificate = subprocess.check_output(['apksigner', 'verify', '--print-certs', str(STAGE / apk)], text=True)
    assert (ROOT / 'android-signer.sha256').read_text().strip() in certificate, 'Android signing identity changed'
    source = f'AnoteP-{VERSION}-source.zip'
    subprocess.run(['git', 'archive', '--format=zip', '--prefix=AnoteP-' + VERSION + '/',
                    '-o', str(STAGE / source), 'HEAD'], check=True)
    names.append(source)
    sums = STAGE / 'SHA256SUMS.txt'
    sums.write_text(''.join(sha(STAGE / name) + '  ' + name + '\n' for name in sorted(names)))
    names.append(sums.name)
    expected = {name: {'size': (STAGE / name).stat().st_size, 'digest': 'sha256:' + sha(STAGE / name)} for name in names}
    upload_url = release['upload_url'].split('{')[0]
    existing = {asset['name']: asset for asset in api('/releases/' + str(RELEASE_ID))['assets']}
    assert existing.keys() <= expected.keys(), 'Draft contains stale or unexpected variants'
    for name, details in expected.items():
        if name in existing:
            actual = existing[name]
            assert actual['state'] == 'uploaded' and actual['size'] == details['size'] and actual.get('digest') == details['digest'], name
        else:
            actual = api(upload_url + '?' + urllib.parse.urlencode({'name': name}), 'POST', (STAGE / name).read_bytes(), binary=True)
            assert actual['size'] == details['size'] and actual.get('digest') == details['digest'], name
        print('Uploaded/verified ' + name + ': ' + str(details['size']) + ' bytes', flush=True)
    release = api('/releases/' + str(RELEASE_ID))
    actual = {asset['name']: asset for asset in release['assets']}
    assert actual.keys() == expected.keys()
    for name, details in expected.items():
        assert actual[name]['size'] == details['size'] and actual[name].get('digest') == details['digest'], name
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    published = api('/releases/' + str(RELEASE_ID), 'PATCH', {
        'tag_name': TAG, 'draft': False, 'make_latest': 'true', 'target_commitish': commit})
    assert not published['draft'] and published['tag_name'] == TAG and api('/releases/latest')['id'] == RELEASE_ID
    print('Published ' + TAG + ': every variant is exactly ' + VERSION + ', with identical editor assets.', flush=True)


if __name__ == '__main__':
    {'validate': validate, 'publish': publish}[sys.argv[1]]()

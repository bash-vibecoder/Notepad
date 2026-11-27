#!/usr/bin/env python3
"""Consolidate verified platform releases without rebuilding or relabeling them."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

REPOSITORY = os.environ['GITHUB_REPOSITORY']
RELEASE_ID = int(os.environ['RELEASE_ID'])
TOKEN = os.environ['GH_TOKEN']
BASE = 'https://api.github.com/repos/' + REPOSITORY
STAGE = Path('current-release')
SOURCES = {
    'v1.2.0': ['AnoteP-1.2.0-win-ia32.exe', 'AnoteP-1.2.0-win-x64.exe',
               'AnoteP-1.2.0-win-ia32-portable.zip', 'AnoteP-1.2.0-win-x64-portable.zip',
               'AnoteP-1.2.0-windows-source.zip'],
    'linux-v1.3.0': ['AnoteP-1.3.0-linux.deb', 'AnoteP-1.3.0-linux-portable.tar.xz'],
    'v1.1.0': ['AnoteP-v1.0.apk'],
}


def api(url, method='GET', payload=None, binary=False):
    if not url.startswith('https://'):
        url = BASE + url
    data = payload if binary else None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, method=method, data=data, headers={
        'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream' if binary else 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    target = api('/releases/' + str(RELEASE_ID))
    assert target['draft'] and target['tag_name'] == 'v1.3.0', 'Expected the current consolidated draft'
    STAGE.mkdir(exist_ok=True)
    expected = {}
    for tag, names in SOURCES.items():
        source = api('/releases/tags/' + tag)
        assert not source['draft'] and not source['prerelease']
        assets = {a['name']: a for a in source['assets']}
        for name in names:
            expected[name] = assets[name]

    def download(item):
        name, asset = item
        path = STAGE / name
        # Published packages are downloaded anonymously; credentials never
        # follow redirects to the release-asset CDN.
        with urllib.request.urlopen(asset['browser_download_url'], timeout=120) as response, path.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        assert path.stat().st_size == asset['size'], name
        assert asset.get('digest') == 'sha256:' + digest(path), name
        return name
    with ThreadPoolExecutor(max_workers=4) as pool:
        for name in pool.map(download, expected.items()):
            print('Downloaded and SHA-256 verified:', name, flush=True)

    sums = STAGE / 'SHA256SUMS.txt'
    sums.write_text(''.join(f'{digest(STAGE / name)}  {name}\n' for name in sorted(expected)))
    expected[sums.name] = {'size': sums.stat().st_size, 'digest': 'sha256:' + digest(sums)}
    actual = {a['name']: a for a in target['assets']}
    assert actual.keys() <= expected.keys(), 'Draft contains unexpected/older assets'
    for name, asset in actual.items():
        assert asset['state'] == 'uploaded', 'Incomplete upload requires inspection: ' + name
        assert asset['size'] == expected[name]['size'] and asset.get('digest') == expected[name]['digest'], name
    upload_url = target['upload_url'].split('{')[0]
    for name, asset in expected.items():
        if name in actual:
            print('Retained verified existing asset:', name, flush=True)
            continue
        uploaded = api(upload_url + '?' + urllib.parse.urlencode({'name': name}),
                       'POST', (STAGE / name).read_bytes(), binary=True)
        assert uploaded['size'] == asset['size'] and uploaded.get('digest') == asset['digest'], name
        print('Uploaded and SHA-256 verified:', name, flush=True)

    target = api('/releases/' + str(RELEASE_ID))
    actual = {a['name']: a for a in target['assets']}
    assert actual.keys() == expected.keys(), 'Asset manifest mismatch'
    for name, asset in actual.items():
        assert asset['size'] == expected[name]['size'] and asset.get('digest') == expected[name]['digest'], name
    published = api('/releases/' + str(RELEASE_ID), 'PATCH', {'draft': False, 'make_latest': 'true'})
    assert not published['draft']
    assert api('/releases/latest')['id'] == RELEASE_ID
    print('Published v1.3.0 as latest: all 9 files verified.', flush=True)


if __name__ == '__main__':
    main()

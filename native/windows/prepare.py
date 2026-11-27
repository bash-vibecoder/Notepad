#!/usr/bin/env python3
"""Fetch the pinned source and apply the small, auditable AnoteP changes."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
META = json.loads((HERE / 'upstream.json').read_text())


def prepare(destination):
    archive = ROOT / 'build' / ('notepadpp-' + META['tag'] + '.tar.gz')
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        with urllib.request.urlopen(META['archive'], timeout=120) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != META['sha256']:
        raise RuntimeError('The upstream source checksum does not match the pinned release.')
    if destination.exists():
        raise RuntimeError('Use a new source directory; existing source is never overwritten.')
    destination.mkdir(parents=True)
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            if member.issym() or member.islnk() or '..' in parts:
                raise RuntimeError('Unexpected archive member: ' + member.name)
            member.name = str(Path(*parts))
            source.extract(member, destination, filter='data')

    changes = []
    def edit(relative, replacements):
        file = destination / 'PowerEditor/src' / relative
        original = file.read_bytes().decode('utf-8')
        text = original
        for old, new, expected in replacements:
            if text.count(old) != expected:
                raise RuntimeError(f'Patch drift: {relative}: {old[:90]!r}')
            text = text.replace(old, new)
        file.write_bytes(text.encode('utf-8'))
        changes.extend(difflib.unified_diff(original.splitlines(True), text.splitlines(True),
                        fromfile='a/PowerEditor/src/' + relative,
                        tofile='b/PowerEditor/src/' + relative))

    edit('resource.h', [
        ('L"Notepad++ v8.9.9.1"', 'L"AnoteP v1.2.0 (based on Notepad++ 8.9.9.1)"', 1),
        ('#define VERSION_PRODUCT_VALUE L"8.9.9.1\\0"', '#define VERSION_PRODUCT_VALUE L"1.2.0\\0"', 1),
        ('#define VERSION_DIGITALVALUE 8, 9, 9, 1', '#define VERSION_DIGITALVALUE 1, 2, 0, 0', 1),
    ])
    edit('Notepad_plus_Window.h', [('L"Notepad++"', 'L"AnoteP"', 1)])
    edit('Notepad_plus_Window.cpp', [('\t\tL"Notepad++",', '\t\tL"AnoteP",', 1)])
    edit('Parameters.cpp', [
        ('pathAppend(settingsFolderPath, L"Notepad++");', 'pathAppend(settingsFolderPath, L"AnoteP\\\\Native");', 1),
        ('pathAppend(_userPath, L"Notepad++");', 'pathAppend(_userPath, L"AnoteP\\\\Native");', 1),
    ])
    edit('Parameters.h', [('_doAutoUpdate = autoupdate_on_startup;', '_doAutoUpdate = autoupdate_disabled;', 1)])
    edit('Notepad_plus.cpp', [('bool enablePluginAdmin = _pluginsAdminDlg.initFromJson();',
                             'bool enablePluginAdmin = false; // AnoteP: no plugin downloads.', 1)])
    edit('winmain.cpp', [
        ('#include "resource.h"', '#include "resource.h"\r\n#include "AnotePMigration.h"', 1),
        ('L"nppInstance"', 'L"AnotePInstance"', 1),
        ('\tnppParameters.load();', '\tmigrateAnotePWorkspace();\r\n\tnppParameters.load();', 1),
        ('bool doUpdateNpp = nppGui._autoUpdateOpt._doAutoUpdate != NppGUI::autoupdate_disabled;',
         'bool doUpdateNpp = false; // AnoteP: offline build.', 1),
        ('bool doUpdatePluginList = nppGui._autoUpdateOpt._doAutoUpdate != NppGUI::autoupdate_disabled;',
         'bool doUpdatePluginList = false;', 1),
        ('doUpdateNpp = nppGui._autoUpdateOpt._doAutoUpdate != NppGUI::autoupdate_disabled; // refresh, maybe user activated these opts in Preferences',
         'doUpdateNpp = false; // AnoteP: never launch an updater.', 1),
    ])
    edit('NppCommands.cpp', [('void Notepad_plus::command(int id)\r\n{',
        'void Notepad_plus::command(int id)\r\n{\r\n'
        '\t// AnoteP offline distribution: no updater or plugin-download commands.\r\n'
        '\tif (id == IDM_UPDATE_NPP || id == IDM_CONFUPDATERPROXY || id == IDM_SETTING_PLUGINADM)\r\n'
        '\t\treturn;', 1)])
    edit('Notepad_plus.rc', [
        ('"FileDescription",    "Notepad++\\0"', '"FileDescription",    "AnoteP native text editor\\0"', 1),
        ('"ProductName",        "Notepad++\\0"', '"ProductName",        "AnoteP\\0"', 1),
        ('"notepad++.exe\\0"', '"AnoteP.exe\\0"', 2),
        ('"About Notepad++"', '"About AnoteP (based on Notepad++)"', 1),
    ])
    # Preserve all upstream author/copyright/license notices and lexer sources.
    shutil.copy2(HERE / 'AnotePMigration.h', destination / 'PowerEditor/src/AnotePMigration.h')
    for relative in ['icons/npp.ico', 'icons/standard/about/chameleon.ico', 'icons/dark/about/chameleon.ico']:
        shutil.copy2(HERE / 'anotep.ico', destination / 'PowerEditor/src' / relative)
    (destination / 'ANOTEP-CHANGES.patch').write_text(''.join(changes), encoding='utf-8', newline='')
    (destination / 'ANOTEP-UPSTREAM.json').write_text(json.dumps(META, indent=2) + '\n')
    (destination / 'ANOTEP-NOTICE.txt').write_bytes((HERE / 'NOTICE.txt').read_bytes())
    print('Prepared native AnoteP source:', destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'build/native-source')
    prepare(parser.parse_args().output.resolve())

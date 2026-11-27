"""Record the exact current host/UI inputs so publication can reject stale builds."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
stage = Path(sys.argv[1])
files = [file for file in (ROOT / 'native/windows-webview').rglob('*')
         if file.is_file() and '__pycache__' not in file.parts and file.suffix != '.pyc']
files += [ROOT / name for name in ('VERSION', 'desktop/bridge.js', 'native/windows/anotep.ico',
    'tests/windows-shared.cjs', 'scripts/audit-packages.py', 'scripts/sync-version.py',
    '.github/workflows/windows-native.yml')]
metadata = {
    'version': (ROOT / 'VERSION').read_text().strip(),
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'files': {file.relative_to(ROOT).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
              for file in sorted(files)},
    'executableSha256': hashlib.sha256((stage / 'AnoteP.exe').read_bytes()).hexdigest(),
}
(stage / 'source-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')

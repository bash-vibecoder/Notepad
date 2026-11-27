"""Ship exact patched source and all vendored dependencies with the binaries."""
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

here = Path(__file__).resolve().parent
root = here.parent.parent
source = Path(sys.argv[1])
target = root / 'release/AnoteP-1.2.1-windows-source.zip'
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as output:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            output.write(file, Path('AnoteP-1.2.1/source') / file.relative_to(source))
    for file in sorted(here.rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts:
            output.write(file, Path('AnoteP-1.2.1/anotep-build/native/windows') / file.relative_to(here))
print('Corresponding source:', target, target.stat().st_size, 'bytes')

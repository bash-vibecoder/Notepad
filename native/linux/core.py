"""Local file fidelity and bounded workspace operations; no GUI dependency."""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from urllib.parse import unquote, urlsplit

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_SESSION_BYTES = 32 * 1024 * 1024
ENCODINGS = {
    'UTF-8': 'utf-8', 'UTF-8-BOM': 'utf-8', 'UTF-16LE': 'utf-16-le',
    'UTF-16BE': 'utf-16-be', 'windows-1252': 'cp1252',
    'ISO-8859-1': 'latin-1', 'US-ASCII': 'ascii',
}
BOMS = {'UTF-8-BOM': b'\xef\xbb\xbf', 'UTF-16LE': b'\xff\xfe', 'UTF-16BE': b'\xfe\xff'}


def normalize(text):
    return text.replace('\r\n', '\n').replace('\r', '\n')


def fingerprint(data):
    return hashlib.sha256(data).hexdigest()


def decode(data, requested=''):
    if len(data) > MAX_FILE_BYTES:
        raise ValueError('This file exceeds the 8 MB editing limit.')
    encoding, offset = requested, 0
    if requested and requested not in ENCODINGS:
        raise ValueError('Unsupported text encoding: ' + requested)
    if not requested:
        if data.startswith((b'\xff\xfe\x00\x00', b'\x00\x00\xfe\xff')):
            raise ValueError('UTF-32 is not supported. Convert this file to UTF-8 first.')
        encoding = next((name for name, bom in BOMS.items() if data.startswith(bom)), 'UTF-8')
    bom = b'\xef\xbb\xbf' if encoding == 'UTF-8' else BOMS.get(encoding, b'')
    if bom and data.startswith(bom):
        offset = len(bom)
    try:
        text = data[offset:].decode(ENCODINGS[encoding], errors='strict')
    except UnicodeError:
        if requested or offset or encoding != 'UTF-8':
            raise ValueError('This file is not valid ' + encoding + '.') from None
        encoding = 'windows-1252'
        try:
            text = data.decode('cp1252', errors='strict')
        except UnicodeError:
            raise ValueError('This file contains invalid text bytes.') from None
    if '\0' in text:
        raise ValueError('This appears to be a binary file or UTF-16 without a byte order mark.')
    crlf = text.count('\r\n')
    remaining = text.replace('\r\n', '')
    lf, cr = remaining.count('\n'), remaining.count('\r')
    eol = 'CRLF' if crlf > 0 and crlf >= lf and crlf >= cr else 'CR' if cr > lf else 'LF'
    return dict(text=normalize(text), encoding=encoding, eol=eol,
                mixedEol=sum(n > 0 for n in (crlf, lf, cr)) > 1)


def encode(text, encoding, eol):
    if encoding not in ENCODINGS:
        raise ValueError('Unsupported text encoding: ' + str(encoding))
    if eol not in ('LF', 'CRLF', 'CR'):
        raise ValueError('Unsupported line ending.')
    text = normalize(text).replace('\n', {'LF': '\n', 'CRLF': '\r\n', 'CR': '\r'}[eol])
    try:
        data = BOMS.get(encoding, b'') + text.encode(ENCODINGS[encoding], errors='strict')
    except UnicodeError:
        raise ValueError('Some characters cannot be saved as ' + encoding + '. Choose UTF-8 in the Encoding menu.') from None
    if len(data) > MAX_FILE_BYTES:
        raise ValueError('The encoded document exceeds the 8 MB file limit.')
    return data


def local_path(uri):
    parts = urlsplit(uri)
    if parts.scheme != 'file' or parts.netloc not in ('', 'localhost') or parts.query or parts.fragment:
        raise ValueError('Only local files can be opened.')
    path = Path(unquote(parts.path, errors='strict'))
    if not path.is_absolute() or '\0' in str(path):
        raise ValueError('Only local files can be opened.')
    # Do not resolve symlinks here: the name the user picked should be retained.
    return Path(os.path.abspath(path))


def read_file(path, limit=MAX_FILE_BYTES):
    # O_NONBLOCK prevents a FIFO/device chosen by mistake from hanging the UI.
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('This path is not a regular file.')
        if info.st_size > limit:
            raise ValueError('This file exceeds the editing/search size limit.')
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ValueError('The file changed while it was being read.')
    return data


def opened_document(uri, requested='', line=0):
    path = local_path(uri)
    data = read_file(path)
    return dict(uri=path.as_uri(), name=path.name, **decode(data, requested),
                fingerprint=fingerprint(data), line=int(line or 0), reload=bool(requested))


def parse_workspace(raw):
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_SESSION_BYTES:
        raise ValueError('Recovery storage is limited to 32 MB. Save and close some tabs.')
    state = json.loads(raw)
    if not isinstance(state, dict) or not isinstance(state.get('documents'), list) or len(state['documents']) > 30:
        raise ValueError('A workspace can contain at most 30 tabs.')
    settings = state.get('settings', {})
    if not isinstance(settings, dict) or not isinstance(settings.get('folderUri', ''), str):
        raise ValueError('The recovery settings are invalid.')
    return state


def save_workspace(target, raw):
    state = parse_workspace(raw)
    target = Path(target)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                         prefix='.workspace-', delete=False) as output:
            temporary = output.name
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return state


def checked_directory(root_uri, uri):
    if not root_uri:
        raise ValueError('Choose a local folder first.')
    root, target = local_path(root_uri).resolve(), local_path(uri).resolve()
    if not target.is_relative_to(root) or not target.is_dir():
        raise ValueError('Choose this folder before browsing it.')
    return root, target


def list_folder(root_uri, uri):
    _, target = checked_directory(root_uri, uri)
    entries, truncated = [], False
    with os.scandir(target) as source:
        for entry in source:
            if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
                continue
            if len(entries) >= 1000:
                truncated = True
                break
            entries.append(dict(uri=Path(entry.path).as_uri(), name=entry.name, directory=entry.is_dir()))
    entries.sort(key=lambda item: (not item['directory'], item['name'].casefold()))
    return dict(uri=target.as_uri(), entries=entries, truncated=truncated)


def search_candidates(root_uri):
    """Yield a bounded set; matching itself runs in the editor's JavaScript engine.

    Keeping regex matching there preserves JavaScript regex syntax/captures and
    avoids a second, subtly different regex implementation in the Linux host.
    """
    root, _ = checked_directory(root_uri, root_uri)
    folders, candidates = [root], []
    files = skipped = total = visited = 0
    limited = False
    while folders:
        directory = folders.pop()
        visited += 1
        if visited > 200:
            limited = True
            break
        try:
            with os.scandir(directory) as source:
                # Bound traversal queues too, even for giant directory trees.
                for entry in source:
                    if entry.is_symlink():
                        skipped += 1
                    elif entry.is_dir():
                        if len(folders) < 200:
                            folders.append(Path(entry.path))
                        else:
                            limited = True
                    elif entry.is_file():
                        if files >= 500 or total >= 16 * 1024 * 1024:
                            return dict(candidates=candidates, files=files, skipped=skipped, limited=True)
                        files += 1
                        try:
                            data = read_file(entry.path, 1024 * 1024)
                            if total + len(data) > 16 * 1024 * 1024:
                                return dict(candidates=candidates, files=files, skipped=skipped, limited=True)
                            total += len(data)
                            text = decode(data)['text']
                            candidates.append(dict(uri=Path(entry.path).as_uri(), name=entry.name, text=text))
                        except (OSError, ValueError):
                            skipped += 1
        except OSError:
            skipped += 1
    return dict(candidates=candidates, files=files, skipped=skipped, limited=limited)

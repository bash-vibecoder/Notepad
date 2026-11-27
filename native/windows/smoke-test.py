"""Real Win32/Scintilla tests against the installed or portable native binary."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('executable', type=Path)
parser.add_argument('--label', default='native')
args = parser.parse_args()
assert os.name == 'nt', 'Run these integration checks on Windows.'
user = c.WinDLL('user32', use_last_error=True)
kernel = c.WinDLL('kernel32', use_last_error=True)
callback_type = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
user.SendMessageW.argtypes = [w.HWND, w.UINT, c.c_size_t, c.c_ssize_t]
user.SendMessageW.restype = c.c_ssize_t
user.PostMessageW.argtypes = [w.HWND, w.UINT, c.c_size_t, c.c_ssize_t]
user.PostMessageW.restype = w.BOOL
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.IsWindowVisible.argtypes = [w.HWND]
user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.VirtualAllocEx.argtypes = [w.HANDLE, c.c_void_p, c.c_size_t, w.DWORD, w.DWORD]
kernel.VirtualAllocEx.restype = c.c_void_p
kernel.WriteProcessMemory.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
kernel.ReadProcessMemory.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
kernel.VirtualFreeEx.argtypes = [w.HANDLE, c.c_void_p, c.c_size_t, w.DWORD]
kernel.CloseHandle.argtypes = [w.HANDLE]
checks = []

def check(value, label):
    assert value, label
    checks.append(label)
    print('PASS:', label, flush=True)

def wait_for(condition, description, timeout=30):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        value = condition()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError('Timed out: ' + description)

def classname(hwnd):
    buffer = c.create_unicode_buffer(256)
    user.GetClassNameW(hwnd, buffer, len(buffer))
    return buffer.value

def windows(pid, parent=None):
    result = []
    @callback_type
    def callback(hwnd, _):
        owner = w.DWORD()
        user.GetWindowThreadProcessId(hwnd, c.byref(owner))
        if owner.value == pid:
            result.append(hwnd)
        return True
    if parent:
        user.EnumChildWindows(parent, callback, 0)
    else:
        user.EnumWindows(callback, 0)
    return result

def send(hwnd, message, first=0, second=0):
    return user.SendMessageW(hwnd, message, first, second)

class Remote:
    def __init__(self, pid):
        self.process = kernel.OpenProcess(0x1038, False, pid)
        if not self.process:
            raise c.WinError(c.get_last_error())

    def data(self, hwnd, message, data=None, first=0, size=0):
        length = max(size, len(data) + 1 if data is not None else 1)
        address = kernel.VirtualAllocEx(self.process, None, length, 0x3000, 0x04)
        if not address:
            raise c.WinError(c.get_last_error())
        try:
            if data is not None:
                buffer = c.create_string_buffer(data)
                if not kernel.WriteProcessMemory(self.process, address, buffer, len(buffer), None):
                    raise c.WinError(c.get_last_error())
            result = send(hwnd, message, first, address)
            output = c.create_string_buffer(length)
            if not kernel.ReadProcessMemory(self.process, address, output, length, None):
                raise c.WinError(c.get_last_error())
            return result, output.raw
        finally:
            kernel.VirtualFreeEx(self.process, address, 0, 0x8000)

    def text(self, hwnd):
        length = send(hwnd, 2006)  # SCI_GETLENGTH
        return self.data(hwnd, 2182, first=length + 1, size=length + 1)[1][:-1].decode('utf-8')

    def set_text(self, hwnd, text):
        self.data(hwnd, 2181, text.encode('utf-8'))  # SCI_SETTEXT

    def close(self):
        kernel.CloseHandle(self.process)

def launch(profile, files=(), restore=False, env=None):
    command = [str(args.executable.resolve()), '-multiInst', '-noPlugin']
    if profile is not None:
        profile.mkdir(parents=True, exist_ok=True)
        command.append('-settingsDir=' + str(profile))
    if not restore:
        command.append('-nosession')
    process = subprocess.Popen(command + list(map(str, files)), env=env)
    hwnd = wait_for(lambda: next((h for h in windows(process.pid) if classname(h) == 'AnoteP'), None), 'AnoteP native window')
    wait_for(lambda: user.IsWindowVisible(hwnd), 'visible application window')
    controls = lambda: [h for h in windows(process.pid, hwnd) if classname(h) == 'Scintilla' and user.IsWindowVisible(h)]
    editor = wait_for(lambda: next(iter(controls()), None), 'native Scintilla editor')
    return process, hwnd, editor, controls

with tempfile.TemporaryDirectory(prefix='AnoteP native tests ') as directory:
    root = Path(directory)
    source = root / 'unicode sample.py'
    original = b'\xef\xbb\xbf' + 'print("Hello 🐧")\r\nsecond line\r\n'.encode()
    source.write_bytes(original)
    process = None
    remote = None
    try:
        process, hwnd, editor, controls = launch(root / 'settings', [source])
        remote = Remote(process.pid)
        check('Hello 🐧' in remote.text(editor), 'Native open preserves Unicode and UTF-8 BOM')
        check(send(editor, 2030) == 0, 'CRLF line ending detected')
        check(send(editor, 2137) == 65001, 'Scintilla edits Unicode as UTF-8')
        send(hwnd, 0x111, 46003)  # C++ language
        wait_for(lambda: send(editor, 4002) == 3, 'C++ lexer')
        check(True, 'Bundled native syntax lexer works')
        remote.set_text(editor, 'saved 🐧\r\nsecond line\r\n')
        send(hwnd, 0x111, 41006)  # File > Save
        expected = b'\xef\xbb\xbf' + 'saved 🐧\r\nsecond line\r\n'.encode()
        wait_for(lambda: source.read_bytes() == expected, 'native save')
        check(True, 'Save preserves BOM, Unicode and CRLF bytes')
        remote.data(editor, 2170, b'inserted ')  # SCI_REPLACESEL
        inserted = remote.text(editor)
        send(hwnd, 0x111, 42003)  # Undo
        check(remote.text(editor) != inserted, 'Undo uses native editor history')
        send(hwnd, 0x111, 42004)  # Redo
        check(remote.text(editor) == inserted, 'Redo restores the edit')
        remote.set_text(editor, '')
        send(hwnd, 0x111, 42018)  # Start macro recording
        remote.data(editor, 2170, b'macro')
        send(hwnd, 0x111, 42019)  # Stop recording
        send(hwnd, 0x111, 42021)  # Playback
        check(remote.text(editor) == 'macromacro', 'Native macro recording and playback')
        send(hwnd, 0x111, 43001)  # Find
        find = wait_for(lambda: next((h for h in windows(process.pid) if classname(h) == '#32770' and user.IsWindowVisible(h)), None), 'Find dialog')
        check(True, 'Native Find dialog opens')
        send(find, 0x10)
        send(hwnd, 0x111, 47006)  # Disabled updater command
        check(process.poll() is None, 'Offline build ignores update-download command')
        send(hwnd, 0x111, 41006)
        wait_for(lambda: 'macromacro' in source.read_text(encoding='utf-8-sig'), 'save edited text')
        send(hwnd, 0x111, 10002)  # Clone to other view
        wait_for(lambda: len(controls()) == 2, 'split editor view')
        check(True, 'Clone/split view uses two native Scintilla controls')
        from PIL import ImageGrab
        ImageGrab.grab().save('native-' + args.label + '.png')
        send(hwnd, 0x10)
        process.wait(timeout=20)
        check(process.returncode == 0, 'Native window closes cleanly')
        remote.close()
        remote = None
        process = None

        # Test the user's exact launch path: no -settingsDir, no -nosession,
        # no Save or Save As. This also checks Program Files never holds state.
        portable = (args.executable.parent / 'doLocalConf.xml').exists()
        native_profile = args.executable.parent if portable else Path(os.environ['APPDATA']) / 'AnoteP/Native'
        scratch = 'scratch survives 🐧\r\nnever saved as a file\r\n'
        process, hwnd, editor, controls = launch(None, restore=True)
        remote = Remote(process.pid)
        send(hwnd, 0x111, 41001)  # File > New
        remote.set_text(editor, scratch)
        check(bool(send(editor, 2159)), 'New scratch tab is dirty before exit')  # SCI_GETMODIFY
        send(hwnd, 0x10)  # Close immediately, before the 1-second backup timer.
        process.wait(timeout=20)
        check(process.returncode == 0, 'Unsaved scratch closes without a Save As prompt')
        remote.close()
        remote = None
        process = None
        session_path = native_profile / 'session.xml'
        check(session_path.is_file(), 'Default profile writes a native session manifest')
        tree = ET.parse(session_path)
        backups = [Path(node.get('backupFilePath')) for node in tree.findall('.//File') if node.get('backupFilePath')]
        check(any(path.is_file() and path.read_text(encoding='utf-8-sig') == scratch.replace('\r\n', '\n') for path in backups),
              'Immediate close writes the scratch text to its recovery file')
        if not portable:
            check(not (args.executable.parent / 'backup').exists() and not (args.executable.parent / 'config.xml').exists(),
                  'Installed app stores recovery in per-user AppData, outside Program Files')

        process, hwnd, editor, controls = launch(None, restore=True)
        remote = Remote(process.pid)
        wait_for(lambda: remote.text(editor) == scratch, 'unsaved scratch restored after normal restart')
        check(bool(send(editor, 2159)), 'Restored scratch stays dirty and unsaved')
        periodic = 'periodic recovery after forced termination 🐧\r\n'
        remote.set_text(editor, periodic)
        wait_for(lambda: any(path.is_file() and path.read_text(encoding='utf-8-sig') == periodic.replace('\r\n', '\n') for path in backups),
                 'periodic backup without any Save command', timeout=15)
        check(True, 'Scratch auto-backup runs while the app is open')
        remote.close()
        remote = None
        process.kill()
        process.wait(timeout=15)
        process = None
        process, hwnd, editor, controls = launch(None, restore=True)
        remote = Remote(process.pid)
        wait_for(lambda: remote.text(editor) == periodic, 'scratch restored after forced termination')
        check(True, 'Periodic recovery survives forced process termination')
        final_edit = periodic + 'last edit immediately before close'
        remote.set_text(editor, final_edit)
        send(hwnd, 0x10)
        process.wait(timeout=20)
        remote.close()
        remote = None
        process = None
        process, hwnd, editor, controls = launch(None, restore=True)
        remote = Remote(process.pid)
        wait_for(lambda: remote.text(editor) == final_edit, 'last edit restored without waiting for timer')
        check(True, 'Close preserves the last edit before the next periodic backup')
        send(hwnd, 0x10)
        process.wait(timeout=20)
        remote.close()
        remote = None
        process = None

        # Upgrade existing preferences that had disabled scratch recovery.
        disabled_profile = root / 'disabled-recovery'
        disabled_profile.mkdir()
        (disabled_profile / 'config.xml').write_text(
            '<NotepadPlus><GUIConfigs><GUIConfig name="RememberLastSession">no</GUIConfig>'
            '<GUIConfig name="Backup" isSnapshotMode="no" snapshotBackupTiming="7000"/>'
            '</GUIConfigs></NotepadPlus>', encoding='utf-8')
        process, hwnd, editor, controls = launch(disabled_profile, restore=True)
        remote = Remote(process.pid)
        remote.set_text(editor, 'existing profile scratch 🐧')
        send(hwnd, 0x10)
        process.wait(timeout=20)
        remote.close()
        remote = None
        process = None
        process, hwnd, editor, controls = launch(disabled_profile, restore=True)
        remote = Remote(process.pid)
        wait_for(lambda: remote.text(editor) == 'existing profile scratch 🐧', 'recovery upgraded from disabled preferences')
        check(True, 'Existing profiles gain scratch recovery even if it was disabled')
        send(hwnd, 0x10)
        process.wait(timeout=20)
        remote.close()
        remote = None
        process = None

        # A failed recovery write must keep the text open, never silently quit.
        blocked_profile = root / 'blocked-recovery'
        blocked_profile.mkdir()
        blocked = blocked_profile / 'backup'
        blocked.write_text('Simulated non-writable recovery directory')
        process, hwnd, editor, controls = launch(blocked_profile, restore=True)
        remote = Remote(process.pid)
        remote.set_text(editor, 'do not discard this scratch 🐧')
        # Send asynchronously because the expected error is a modal dialog.
        user.PostMessageW(hwnd, 0x10, 0, 0)
        error_dialog = wait_for(lambda: next((h for h in windows(process.pid)
            if classname(h) == '#32770' and user.IsWindowVisible(h)), None), 'failed recovery warning')
        check(process.poll() is None and remote.text(editor) == 'do not discard this scratch 🐧',
              'A failed recovery write refuses exit and preserves text in the editor')
        send(error_dialog, 0x111, 1)  # IDOK
        blocked.unlink()
        blocked.mkdir()
        send(hwnd, 0x10)
        process.wait(timeout=20)
        check(process.returncode == 0, 'Close succeeds after the recovery directory is repaired')
        remote.close()
        remote = None
        process = None

        if (args.executable.parent / 'doLocalConf.xml').exists():
            check(True, 'Portable edition retains local-configuration marker')
        else:
            # Test old Electron-workspace import without touching any original file.
            appdata = root / 'appdata'
            legacy = appdata / 'AnoteP/workspace.json'
            legacy.parent.mkdir(parents=True)
            workspace = {'version': 1, 'documents': [{'name': 'recovered.py', 'text': 'unsaved 🐧\n', 'dirty': True, 'uri': source.as_uri()}]}
            legacy.write_text(json.dumps(workspace), encoding='utf-8')
            before = hashlib.sha256(legacy.read_bytes()).digest()
            native_profile = appdata / 'AnoteP/Native'
            native_profile.mkdir()
            environment = {**os.environ, 'APPDATA': str(appdata)}
            process, hwnd, editor, controls = launch(native_profile, restore=True, env=environment)
            remote = Remote(process.pid)
            wait_for(lambda: 'unsaved 🐧' in remote.text(editor), 'recovered workspace tab')
            check(True, 'Previous Electron unsaved tab is recovered into native editor')
            check(hashlib.sha256(legacy.read_bytes()).digest() == before, 'Original workspace.json is preserved byte-for-byte')
            check(source.read_text(encoding='utf-8-sig') == 'macromacro', 'Migration never overwrites the original document')
            check((native_profile / 'Recovered/workspace.json').exists(), 'Recovery includes a copy of the complete previous workspace')
            send(hwnd, 0x10)
            process.wait(timeout=20)
            process = None
    finally:
        if remote:
            remote.close()
        if process and process.poll() is None:
            process.kill()
            process.wait()

Path('native-' + args.label + '-checks.json').write_text(json.dumps({'passed': len(checks), 'checks': checks}, indent=2))
print('Native Windows integration:', len(checks), 'checks passed.')

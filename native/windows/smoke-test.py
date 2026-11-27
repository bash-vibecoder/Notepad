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
    command = [str(args.executable.resolve()), '-multiInst', '-noPlugin', '-settingsDir=' + str(profile)]
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
        send(hwnd, 0x111, 48006)  # Disabled updater command
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

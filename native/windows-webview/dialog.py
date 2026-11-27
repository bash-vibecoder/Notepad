"""CI-only automation of the real native file dialogs (never packaged)."""
import ctypes as c
from ctypes import wintypes as w
import sys
import subprocess
from pathlib import Path
import time

user = c.WinDLL('user32', use_last_error=True)
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetDlgCtrlID.argtypes = [w.HWND]
user.IsWindowVisible.argtypes = [w.HWND]
user.IsWindowEnabled.argtypes = [w.HWND]
user.GetParent.argtypes = [w.HWND]
user.GetParent.restype = w.HWND
user.SendMessageW.argtypes = [w.HWND, w.UINT, c.c_size_t, c.c_ssize_t]
user.SendMessageW.restype = c.c_ssize_t
user.PostMessageW.argtypes = [w.HWND, w.UINT, c.c_size_t, c.c_ssize_t]
callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)


def text(hwnd, class_name=False):
    value = c.create_unicode_buffer(2048)
    (user.GetClassNameW if class_name else user.GetWindowTextW)(hwnd, value, len(value))
    return value.value


def windows(parent=None):
    result = []
    @callback
    def collect(hwnd, _):
        result.append(hwnd)
        return True
    if parent:
        user.EnumChildWindows(parent, collect, 0)
    else:
        user.EnumWindows(collect, 0)
    return result


def main():
    if sys.argv[1] == 'inspect':
        for hwnd in windows():
            if user.IsWindowVisible(hwnd) and (text(hwnd, True) == 'AnoteP' or text(hwnd, True) == '#32770'):
                print('WINDOW', text(hwnd, True), text(hwnd))
                for child in windows(hwnd):
                    print('  CONTROL', text(child, True), user.GetDlgCtrlID(child), text(child)[:600])
        return
    title, action = sys.argv[1:3]
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        dialog = next((h for h in windows() if user.IsWindowVisible(h) and text(h, True) == '#32770' and title in text(h)), None)
        if not dialog:
            time.sleep(.1)
            continue
        if action in ('cancel', 'ok'):
            if action == 'ok':
                button = next((h for h in windows(dialog)
                               if text(h, True) == 'Button'
                               and text(h).replace('&', '').strip() == 'OK'), None)
                if not button:
                    time.sleep(.1)
                    continue
                user.PostMessageW(button, 0x00F5, 0, 0)  # BM_CLICK
            else:
                user.PostMessageW(dialog, 0x111, 2, 0)
            until = time.monotonic() + 5
            while user.IsWindowVisible(dialog) and time.monotonic() < until:
                time.sleep(.05)
            if user.IsWindowVisible(dialog):
                raise SystemExit('Native dialog did not close: ' + title)
            print('Native dialog dismissed:', title)
            return
        # Keyboard input exercises the visible shell filename field.
        subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                        '-File', str(Path(__file__).with_name('dialog-value.ps1')),
                        '-WindowHandle', str(dialog), '-FilePath', sys.argv[3]],
                       check=True, timeout=15)
        print('Native dialog accepted:', title)
        return
    raise SystemExit('Could not automate dialog: ' + title)


if __name__ == '__main__':
    main()

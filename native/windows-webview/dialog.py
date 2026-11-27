"""CI-only automation of the real native file dialogs (never packaged)."""
import ctypes as c
from ctypes import wintypes as w
import sys
import time

user = c.WinDLL('user32', use_last_error=True)
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.GetDlgCtrlID.argtypes = [w.HWND]
user.IsWindowVisible.argtypes = [w.HWND]
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
    title, action = sys.argv[1:3]
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        dialog = next((h for h in windows() if user.IsWindowVisible(h) and text(h, True) == '#32770' and title in text(h)), None)
        if not dialog:
            time.sleep(.1)
            continue
        if action in ('cancel', 'ok'):
            user.PostMessageW(dialog, 0x111, 2 if action == 'cancel' else 1, 0)
            print('Native dialog dismissed:', title)
            return
        children = windows(dialog)
        edits = [h for h in children if text(h, True) == 'Edit' and user.GetDlgCtrlID(h) in (1001, 1148)]
        if not edits:
            time.sleep(.1)
            continue
        value = c.create_unicode_buffer(sys.argv[3])
        user.SendMessageW(edits[0], 0x000C, 0, c.addressof(value))
        user.PostMessageW(dialog, 0x111, 1, 0)
        print('Native dialog accepted:', title)
        return
    raise SystemExit('Could not automate dialog: ' + title)


if __name__ == '__main__':
    main()

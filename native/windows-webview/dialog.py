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
                    if text(child):
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
            user.PostMessageW(dialog, 0x111, 2 if action == 'cancel' else 1, 0)
            print('Native dialog dismissed:', title)
            return
        # The shell also exposes search-box Edit controls with ID 1001.
        # Address the filename ComboBox (1148), and let initialization settle.
        time.sleep(.5)
        children = windows(dialog)
        edits = [h for h in children if text(h, True) == 'Edit'
                 and user.IsWindowVisible(h) and user.IsWindowEnabled(h)
                 and (user.GetDlgCtrlID(h) == 1148
                      or user.GetDlgCtrlID(user.GetParent(h)) == 1148)]
        if not edits:
            time.sleep(.1)
            continue
        value = c.create_unicode_buffer(sys.argv[3])
        edit = edits[0]
        user.SendMessageW(dialog, 0x0028, edit, 1)  # WM_NEXTDLGCTL
        user.SendMessageW(edit, 0x000C, 0, c.addressof(value))
        user.SendMessageW(user.GetParent(edit), 0x0111,
                          user.GetDlgCtrlID(edit) | (0x0300 << 16), edit)
        time.sleep(.15)
        actual = c.create_unicode_buffer(32768)
        user.SendMessageW(edit, 0x000D, len(actual), c.addressof(actual))
        if actual.value != sys.argv[3]:
            continue
        print('Native filename field:', actual.value)
        user.PostMessageW(dialog, 0x111, 1, 0)
        print('Native dialog accepted:', title)
        return
    raise SystemExit('Could not automate dialog: ' + title)


if __name__ == '__main__':
    main()

#!/usr/bin/python3
"""Exercise the real WebKit editor, native bridge, files and close/recovery.

Run with: xvfb-run -a dbus-run-session -- python3 native/linux/smoke-test.py
ANOTEP_TEST_HOME can point at the extracted portable directory or /usr/share/anotep.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
HOME = Path(os.environ.get('ANOTEP_TEST_HOME', str(Path(__file__).resolve().parent)))
sys.path.insert(0, str(HOME))
spec = importlib.util.spec_from_file_location('anotep_host', HOME / 'main.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.load_gui()
Gtk, GLib = host.Gtk, host.GLib
checks = 0


def check(actual, expected, label):
    global checks
    assert actual == expected, f'{label}: {actual!r} != {expected!r}'
    checks += 1
    print('PASS ' + label, flush=True)


def spin(predicate, timeout=25):
    deadline = time.monotonic() + timeout
    context = GLib.MainContext.default()
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError('Timed out waiting for WebKit/native result')


def js(editor, expression):
    completed = []
    editor.evaluate('JSON.stringify((' + expression + '))', lambda value, error: completed.append((value, error)))
    spin(lambda: completed)
    value, error = completed[0]
    if error:
        raise AssertionError(str(error))
    return json.loads(value.to_string())


def wait_js(editor, expression):
    spin(lambda: js(editor, expression))


def run(editor, action):
    js(editor, '(App.run(' + json.dumps(action) + '), true)')


def value(editor):
    return js(editor, 'document.querySelector("#editor .CodeMirror").CodeMirror.getValue()')


def set_text(editor, text):
    js(editor, '(document.querySelector("#editor .CodeMirror").CodeMirror.setValue(' + json.dumps(text) + '), true)')


def launch(assets, profile):
    editor = host.Editor(assets, profile)
    spin(lambda: editor.ready)
    wait_js(editor, '!!document.querySelector(".document-tab")')
    return editor


def main():
    assets = HOME / 'assets' if os.environ.get('ANOTEP_TEST_HOME') else ROOT / 'app/src/main/assets'
    for file in (HOME / 'main.py', HOME / 'core.py', HOME / 'bridge.js', assets / 'index.html', assets / 'vendor/codemirror.js'):
        assert file.is_file(), 'Missing packaged payload: ' + str(file)
    with tempfile.TemporaryDirectory(prefix='anotep-webkit-test-') as temporary:
        root = Path(temporary)
        source, saved = root / 'original.txt', root / 'saved-as.txt'
        profile = root / 'profile'
        source.write_bytes(b'\xef\xbb\xbf' + 'Hello 🐧\r\nsecond line\r\n'.encode())
        editor = launch(assets, profile)
        try:
            check(js(editor, '[AnotePNative.platform, AnotePNative.version, typeof require]'),
                  ['desktop', host.VERSION, 'undefined'], 'System WebKit bridge and unified version')
            check(value(editor), '', 'Empty initial document')
            # Control native chooser outcomes while using the actual bridge.
            choices = {'open': [str(source)], 'save': [str(saved)], 'folder': [str(root)]}
            editor.choose = lambda kind, name='': choices[kind]
            run(editor, 'open')
            wait_js(editor, 'document.querySelector(".document-tab.active .tab-name").textContent === "original.txt"')
            check(value(editor), 'Hello 🐧\nsecond line\n', 'Native open preserves Unicode')
            run(editor, 'saveAs')
            wait_js(editor, 'document.querySelector(".document-tab.active .tab-name").textContent === "saved-as.txt"')
            check(saved.read_bytes(), source.read_bytes(), 'Save As preserves UTF-8 BOM and CRLF')
            set_text(editor, 'edited 🐧\nline\n')
            run(editor, 'save')
            wait_js(editor, '!document.querySelector(".document-tab.active .dirty")')
            check(saved.read_bytes(), b'\xef\xbb\xbf' + 'edited 🐧\r\nline\r\n'.encode(), 'Save preserves encoding and line endings')
            saved.write_text('external edit')
            set_text(editor, 'my revision')
            run(editor, 'save')
            wait_js(editor, '!document.getElementById("dialogBackdrop").hidden')
            check(js(editor, 'document.getElementById("dialogTitle").textContent'), 'File changed outside AnoteP', 'External modification warning')
            check(saved.read_text(), 'external edit', 'Conflict preserves external contents')
            js(editor, '([...document.querySelectorAll("#dialogActions button")].find(b => b.textContent === "Overwrite").click(), true)')
            wait_js(editor, '!document.querySelector(".document-tab.active .dirty")')
            check(saved.read_bytes(), b'\xef\xbb\xbfmy revision', 'Explicit overwrite succeeds')
            js(editor, '(AnotePNative.dispatch(JSON.stringify({type:"chooseFolder"})), true)')
            wait_js(editor, '!!document.querySelector(".tree-node")')
            check(js(editor, '!document.getElementById("sidebar").hidden'), True, 'Native folder picker and browser')
            stale = js(editor, 'App.captureWorkspace()')
            stale['settings']['folderUri'] = ''
            editor.remember(json.dumps(stale))
            check(editor.selected_folder, root.as_uri(), 'Queued stale recovery preserves the active folder')
            run(editor, 'findInFiles')
            wait_js(editor, '!document.getElementById("dialogBackdrop").hidden')
            js(editor, '(document.querySelector("#dialogBody input[type=text]").value = "Hello", [...document.querySelectorAll("#dialogActions button")].find(b=>b.textContent==="Find All").click(), true)')
            wait_js(editor, '!!document.querySelector(".result-row")')
            check(js(editor, 'document.querySelectorAll(".result-row").length'), 1, 'Real folder search')
            js(editor, '(document.getElementById("closeResults").click(), true)')
            set_text(editor, 'clipboard test')
            js(editor, '(document.querySelector("#editor .CodeMirror").CodeMirror.execCommand("selectAll"), App.run("copy"), true)')
            wait_js(editor, 'document.getElementById("toast").textContent.includes("Copied")')
            check(Gtk.Clipboard.get(host.Gdk.SELECTION_CLIPBOARD).wait_for_text(), 'clipboard test', 'System clipboard copy')
            Gtk.Clipboard.get(host.Gdk.SELECTION_CLIPBOARD).set_text('pasted 🐧', -1)
            run(editor, 'paste')
            wait_js(editor, 'document.querySelector("#editor .CodeMirror").CodeMirror.getValue() === "pasted 🐧"')
            check(value(editor), 'pasted 🐧', 'System clipboard paste')
            run(editor, 'dark')
            run(editor, 'split')
            check(js(editor, '!document.getElementById("secondaryPane").hidden'), True, 'Split view')
            run(editor, 'closeSplit')
            set_text(editor, 'const answer = 42;\n')
            run(editor, 'language:text/javascript')
            wait_js(editor, '!!document.querySelector(".cm-keyword")')
            check(js(editor, 'document.getElementById("languageStatus").textContent'), 'JavaScript', 'Bundled syntax highlighting')
            # Test fetch and image network paths with real local listeners.
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
            from threading import Thread
            requests = []
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    requests.append(self.path)
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(b'blocked')
                def log_message(self, *_):
                    pass
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}/must-not-connect'
                js(editor, '(window.__networkDone=false, fetch(' + json.dumps(url) + ').then(()=>window.__networkDone="allowed",()=>window.__networkDone="blocked"), true)')
                wait_js(editor, '!!window.__networkDone')
                check(js(editor, 'window.__networkDone'), 'blocked', 'Remote fetch blocked by policy')
                # A separate page with NO CSP exercises the native content
                # blocker independently of the editor's connect-src policy.
                manager = host.WebKit2.UserContentManager.new()
                probe = host.WebKit2.WebView(web_context=editor.context, user_content_manager=manager)
                loads = []
                probe.connect('load-changed', lambda _, event: loads.append(event))
                probe.load_html('<img src="' + url + '">', editor.editor_uri)
                spin(lambda: host.WebKit2.LoadEvent.FINISHED in loads)
                check(requests, ['/must-not-connect'], 'Network test listener works without content blocker')
                requests.clear()
                loads.clear()
                manager.add_filter(editor.content_filter)
                probe.load_html('<img src="' + url + '">', editor.editor_uri)
                spin(lambda: host.WebKit2.LoadEvent.FINISHED in loads)
                probe.destroy()
                check(requests, [], 'No HTTP connection reaches the listener')
            finally:
                server.shutdown()
                server.server_close()
            original = editor.web.get_uri()
            js(editor, '(location.href="https://example.com/", true)')
            js(editor, 'true')
            check(editor.web.get_uri(), original, 'Remote navigation blocked')
            screenshot = ROOT / 'build/screenshots/linux-webkit.png'
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            host.Gdk.pixbuf_get_from_window(editor.window.get_window(), 0, 0,
                editor.window.get_allocated_width(), editor.window.get_allocated_height()).savev(str(screenshot), 'png', [], [])
            # Close in the same JavaScript turn as the last edit, before debounce.
            js(editor, '(document.querySelector("#editor .CodeMirror").CodeMirror.setValue("recover immediately 🐧"), window.close(), true)')
            spin(lambda: editor.closing and not editor.window.get_visible())
            state = json.loads((profile / 'workspace.json').read_text())
            check(any(d['text'] == 'recover immediately 🐧' and d['dirty'] for d in state['documents']), True, 'Close durably captures last unsaved edit')
            check(saved.read_bytes(), b'\xef\xbb\xbfmy revision', 'Recovery preserves original documents')
            editor.filter_directory.cleanup()
            editor = launch(assets, profile)
            check(value(editor), 'recover immediately 🐧', 'Relaunch restores unsaved text')
            check(js(editor, 'document.body.classList.contains("dark")'), True, 'Relaunch restores theme')
            check(js(editor, '!!document.querySelector(".document-tab.active .dirty")'), True, 'Recovered tab stays unsaved')
            # Existing Electron workspace.json has the same schema; no conversion.
            check(editor.workspace, profile / 'workspace.json', 'Existing workspace path retained')
            # Exercise the real entrypoint and GTK event loop as well as the
            # in-process bridge checks. No special test flag enters the app.
            launcher = HOME / 'anotep'
            command = [str(launcher)] if launcher.is_file() else ['/usr/bin/python3', str(HOME / 'main.py'), '--assets', str(assets)]
            process = subprocess.Popen(command + ['--profile', str(root / 'launcher-profile'), str(source)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                workspace = root / 'launcher-profile/workspace.json'
                spin(lambda: workspace.is_file() or process.poll() is not None)
                check(process.poll(), None, 'Real launcher starts the GTK event loop')
                process.terminate()
                check(process.wait(timeout=15), 0, 'Real launcher closes cleanly on SIGTERM')
                state = json.loads(workspace.read_text())
                check(any(d['text'] == 'Hello 🐧\nsecond line\n' for d in state['documents']),
                      True, 'Command-line file open and final recovery write')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            print(f'Linux WebKit integration: {checks} checks passed.', flush=True)
        finally:
            editor.ready = False
            editor.window.destroy()
            editor.filter_directory.cleanup()


if __name__ == '__main__':
    main()

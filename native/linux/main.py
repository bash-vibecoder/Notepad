#!/usr/bin/python3
"""Small GTK/WebKitGTK host for AnoteP's bundled, offline editor."""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import tempfile

import core

from version import VERSION
HERE = Path(__file__).resolve().parent
DEPENDENCIES = 'sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1'


def load_gui():
    global Gdk, Gio, GLib, Gtk, WebKit2
    try:
        import gi
        gi.require_version('Gtk', '3.0')
        gi.require_version('Gdk', '3.0')
        gi.require_version('WebKit2', '4.1')
        from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2
    except (ImportError, ValueError) as error:
        raise SystemExit('AnoteP needs the system GTK/WebKitGTK runtime.\n' + DEPENDENCIES + '\n' + str(error)) from None
    if (WebKit2.get_major_version(), WebKit2.get_minor_version()) < (2, 40):
        raise SystemExit('AnoteP needs WebKitGTK 2.40 or newer. Update your distribution packages.')


class Editor:
    def __init__(self, assets, profile, paths=()):
        self.assets = Path(assets).resolve()
        self.editor_uri = (self.assets / 'index.html').as_uri()
        self.profile = Path(profile).resolve()
        self.workspace = self.profile / 'workspace.json'
        self.paths = list(paths)
        self.selected_folder = ''
        self.ready = self.closing = False
        self.error = None
        self.window = Gtk.Window(title='AnoteP')
        self.window.set_default_size(1200, 820)
        self.window.set_size_request(640, 480)
        self.window.set_wmclass('anotep', 'AnoteP')
        self.window.set_icon_from_file(str(self.assets / 'icon.svg'))
        self.window.connect('delete-event', lambda *_: self.close())
        self.window.connect('destroy', lambda *_: Gtk.main_quit() if Gtk.main_level() else None)
        self.manager = WebKit2.UserContentManager.new()
        self.manager.connect('script-message-received::anotep', self.on_message)
        self.manager.register_script_message_handler('anotep')
        self.manager.add_script(WebKit2.UserScript.new(
            (HERE / 'bridge.js').read_text(), WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START, None, None))
        self.context = WebKit2.WebContext.new_ephemeral()
        self.context.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)
        self.context.connect('download-started', lambda _, download: download.cancel())
        self.web = WebKit2.WebView(web_context=self.context, user_content_manager=self.manager)
        settings = self.web.get_settings()
        settings.set_enable_developer_extras(False)
        settings.set_enable_html5_database(False)
        settings.set_enable_html5_local_storage(False)
        settings.set_enable_page_cache(False)
        settings.set_allow_file_access_from_file_urls(True)
        settings.set_allow_universal_access_from_file_urls(False)
        settings.set_enable_media_stream(False)
        self.web.connect('decide-policy', self.decide_policy)
        self.web.connect('permission-request', lambda _, request: (request.deny(), True)[1])
        self.web.connect('create', lambda *_: None)
        self.web.connect('context-menu', lambda *_: True)
        self.web.connect('close', lambda *_: self.close())
        self.web.connect('web-process-terminated', self.process_terminated)
        self.window.add(self.web)
        # Compile the deny rule before loading any editor content. It also
        # blocks resource loads if a future HTML edit accidentally weakens CSP.
        self.filter_directory = tempfile.TemporaryDirectory(prefix='anotep-filter-')
        self.filter_store = WebKit2.UserContentFilterStore.new(self.filter_directory.name)
        rules = json.dumps([{'trigger': {'url-filter': '^[a-zA-Z][a-zA-Z0-9+.-]*://'},
                             'action': {'type': 'block'}},
                            {'trigger': {'url-filter': '^file://'},
                             'action': {'type': 'ignore-previous-rules'}}])
        self.filter_store.save('offline', GLib.Bytes.new(rules.encode()), None, self.filter_ready, None)

    def filter_ready(self, store, result, _):
        try:
            self.content_filter = store.save_finish(result)
            self.manager.add_filter(self.content_filter)
            self.web.load_uri(self.editor_uri)
            self.window.show_all()
        except GLib.Error as error:
            self.fatal('Could not enable offline request blocking: ' + str(error))

    def decide_policy(self, _, decision, kind):
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            if kind == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION or decision.get_request().get_uri() != self.editor_uri:
                decision.ignore()
                return True
        return False

    def evaluate(self, source, callback=None):
        def finished(web, result, _):
            try:
                value = web.evaluate_javascript_finish(result)
                if callback:
                    callback(value, None)
            except GLib.Error as error:
                if callback:
                    callback(None, error)
                else:
                    print('AnoteP JavaScript: ' + str(error), file=sys.stderr)
        self.web.evaluate_javascript(source, -1, None, None, None, finished, None)

    def emit(self, kind, payload=None, request_id=''):
        event = dict(type=kind, payload={} if payload is None else payload, requestId=request_id)
        self.evaluate('window.__anotepReceive(' + json.dumps(event, ensure_ascii=True) + '); undefined;')

    def remember(self, raw):
        core.save_workspace(self.workspace, raw)
        # An older queued snapshot must not revoke the active picker selection.

    def bootstrap(self):
        state = {}
        try:
            state = core.parse_workspace(core.read_file(self.workspace, core.MAX_SESSION_BYTES).decode('utf-8'))
            self.selected_folder = state.get('settings', {}).get('folderUri', '')
        except FileNotFoundError:
            pass
        except (OSError, ValueError, UnicodeError):
            self.emit('error', {'message': 'The recovery snapshot could not be loaded. Original files have not been changed.'})
        self.ready = True
        self.emit('bootstrap', state)
        for path in self.paths[:30]:
            try:
                self.open_document(Path(path).absolute().as_uri())
            except (OSError, ValueError) as error:
                self.emit('error', {'message': str(error)})
        self.paths.clear()

    def choose(self, kind, name=''):
        action = {'open': Gtk.FileChooserAction.OPEN, 'save': Gtk.FileChooserAction.SAVE,
                  'folder': Gtk.FileChooserAction.SELECT_FOLDER}[kind]
        dialog = Gtk.FileChooserNative.new(
            {'open': 'Open local documents', 'save': 'Save document', 'folder': 'Choose local workspace folder'}[kind],
            self.window, action, '_Save' if kind == 'save' else '_Open', '_Cancel')
        dialog.set_local_only(True)
        if kind == 'open':
            dialog.set_select_multiple(True)
        if kind == 'save':
            dialog.set_do_overwrite_confirmation(True)
            dialog.set_current_name(name)
        try:
            return dialog.get_filenames() if dialog.run() == Gtk.ResponseType.ACCEPT else []
        finally:
            dialog.destroy()

    def open_document(self, uri, encoding='', line=0):
        self.emit('opened', core.opened_document(uri, encoding, line))

    def save_document(self, payload, request_id):
        data = core.encode(payload['text'], payload['encoding'], payload['eol'])
        picked = payload.get('saveAs') or not payload.get('uri')
        if picked:
            name = payload.get('name', 'document.txt')
            if name.startswith('new ') and name[4:].isdigit():
                name = 'document.txt'
            paths = self.choose('save', Path(name).name)
            if not paths:
                self.emit('cancelled', request_id=request_id)
                return
            target = Path(paths[0]).absolute()
        else:
            target = core.local_path(payload['uri'])
        if not picked and not payload.get('force') and payload.get('fingerprint'):
            try:
                actual = core.fingerprint(core.read_file(target))
            except FileNotFoundError:
                actual = None
            if actual != payload['fingerprint']:
                self.emit('conflict', {'name': target.name}, request_id)
                return
        with target.open('wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        self.emit('saved', dict(id=payload['id'], uri=target.as_uri(), name=target.name,
                                fingerprint=core.fingerprint(data)), request_id)

    def on_message(self, _, result):
        if self.web.get_uri() != self.editor_uri:
            return
        request_id = ''
        try:
            raw = result.get_js_value().to_string()
            if len(raw.encode('utf-8')) > core.MAX_SESSION_BYTES:
                raise ValueError('The editor request is too large.')
            command = json.loads(raw)
            kind, payload = command['type'], command.get('payload', {})
            request_id = command.get('requestId', '')
            if kind == 'ready':
                self.bootstrap()
            elif kind == 'persist':
                self.remember(json.dumps(payload, ensure_ascii=False))
            elif kind == 'open':
                for path in self.choose('open')[:30]:
                    try:
                        self.open_document(Path(path).absolute().as_uri())
                    except (OSError, ValueError) as error:
                        self.emit('error', {'message': str(error)})
            elif kind == 'openUri':
                self.open_document(payload['uri'], payload.get('encoding', ''), payload.get('line', 0))
            elif kind == 'save':
                self.save_document(payload, request_id)
            elif kind == 'chooseFolder':
                paths = self.choose('folder')
                if paths:
                    path = Path(paths[0]).absolute()
                    self.selected_folder = path.as_uri()
                    self.emit('folderChosen', dict(uri=self.selected_folder, name=path.name or str(path)))
            elif kind == 'listFolder':
                self.emit('folderListing', core.list_folder(self.selected_folder, payload['uri']), request_id)
            elif kind == 'findInFiles':
                batch = core.search_candidates(self.selected_folder)
                self.evaluate('window.__anotepSearch(' + ','.join(json.dumps(v, ensure_ascii=True) for v in (batch, payload, request_id)) + '); undefined;')
            elif kind == 'copy':
                Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(payload.get('text', ''), -1)
                self.emit('copied', request_id=request_id)
            elif kind == 'paste':
                self.emit('pasted', {'text': Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or ''}, request_id)
            elif kind == 'licenses':
                self.emit('licenses', {'text': (self.assets / 'licenses.txt').read_text()}, request_id)
            elif kind == 'close':
                self.close()
            elif kind not in ('theme', 'hideKeyboard'):
                raise ValueError('Unknown editor request.')
        except (OSError, ValueError, KeyError, TypeError) as error:
            self.emit('error', {'message': str(error)}, request_id)

    def close(self):
        if self.closing:
            return True
        if not self.ready:
            self.window.destroy()
            return True
        self.closing = True

        def captured(value, error):
            try:
                if error:
                    raise ValueError(str(error))
                self.remember(value.to_string())
            except (OSError, ValueError) as failure:
                self.closing = False
                self.show_error('Recovery could not be saved. Save your tabs before closing.\n' + str(failure))
                return
            self.window.destroy()
        self.evaluate('JSON.stringify(window.App.captureWorkspace())', captured)
        return True

    def show_error(self, message):
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.ERROR,
                                   buttons=Gtk.ButtonsType.CLOSE, text='AnoteP')
        dialog.format_secondary_text(message)
        dialog.run()
        dialog.destroy()

    def fatal(self, message):
        self.error = message
        self.show_error(message)
        self.window.destroy()

    def process_terminated(self, *_):
        self.ready = False
        self.show_error('The system WebKit process stopped. Reopen AnoteP to restore the last recovery snapshot.')
        self.window.destroy()


def arguments():
    parser = argparse.ArgumentParser(description='AnoteP offline text editor (system WebKitGTK edition).')
    parser.add_argument('--version', action='version', version='AnoteP ' + VERSION)
    parser.add_argument('--assets', type=Path, default=HERE / 'assets')
    parser.add_argument('--profile', type=Path, default=Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'AnoteP')
    parser.add_argument('files', nargs='*')
    return parser.parse_args()


def main():
    args = arguments()
    load_gui()
    if not (args.assets / 'index.html').is_file():
        raise SystemExit('Bundled editor assets were not found: ' + str(args.assets))
    if not Gtk.init_check()[0]:
        raise SystemExit('AnoteP needs a graphical Linux desktop (DISPLAY or Wayland).')
    editor = Editor(args.assets, args.profile, args.files)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (editor.close(), False)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, lambda: (editor.close(), False)[1])
    Gtk.main()
    editor.filter_directory.cleanup()
    return 1 if editor.error else 0


if __name__ == '__main__':
    sys.exit(main())

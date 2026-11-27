import json
import os
from pathlib import Path
import tempfile
import unittest

import core


class FileTests(unittest.TestCase):
    def test_encodings_and_endings(self):
        for encoding in core.ENCODINGS:
            for eol in ('LF', 'CRLF', 'CR'):
                with self.subTest(encoding=encoding, eol=eol):
                    text = 'hello\nsecond\n' if encoding == 'US-ASCII' else 'café\nsecond\n'
                    if encoding.startswith('UTF'):
                        text += 'penguin 🐧\n'
                    data = core.encode(text, encoding, eol)
                    decoded = core.decode(data, encoding)
                    self.assertEqual(decoded['text'], text)
                    self.assertEqual(decoded['eol'], eol)
                    self.assertEqual(core.encode(decoded['text'], decoded['encoding'], decoded['eol']), data)

    def test_auto_detection(self):
        for encoding in core.BOMS:
            data = core.encode('🐧\nline', encoding, 'CRLF')
            self.assertEqual(core.decode(data)['encoding'], encoding)
        self.assertEqual(core.decode(b'\x93hi\x94')['text'], '“hi”')
        self.assertEqual(core.decode(b'\x80', 'ISO-8859-1')['text'], '\x80')
        self.assertEqual(core.encode('€', 'windows-1252', 'LF'), b'\x80')
        self.assertTrue(core.decode(b'a\r\nb\nc\r')['mixedEol'])
        self.assertEqual(core.decode(b'a\rb\r')['eol'], 'CR')

    def test_reject_invalid_data(self):
        for data, requested in [(b'a\0b', ''), (b'\xff', 'UTF-8'), (b'\x81', ''),
                                (b'\xff\xfea', ''), (b'\xff\xfe\0\0', '')]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                core.decode(data, requested)
        for text, encoding in [('€', 'US-ASCII'), ('🐧', 'windows-1252'), ('\ud800', 'UTF-8')]:
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                core.encode(text, encoding, 'LF')
        with self.assertRaises(ValueError):
            core.encode('abc', 'UTF-32', 'LF')
        with self.assertRaises(ValueError):
            core.encode('abc', 'UTF-8', 'invalid')
        with self.assertRaises(ValueError):
            core.decode(b'x' * (core.MAX_FILE_BYTES + 1))

    def test_local_uri(self):
        for uri in ('https://example.com/a', 'file://remote/a', 'file:relative',
                    'file:///a?query', 'file:///a#fragment', 'file:///a%00b'):
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                core.local_path(uri)
        path = Path('/tmp/🐧 #1.txt')
        self.assertEqual(core.local_path(path.as_uri()), path)

    def test_workspace_integrity_and_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'profile/workspace.json'
            state = dict(documents=[dict(text='unsaved 🐧')], settings=dict(dark=True))
            core.save_workspace(path, json.dumps(state))
            self.assertEqual(json.loads(path.read_text()), state)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            for invalid in ('{}', '{broken', json.dumps(dict(documents=[{}] * 31)),
                            '{"documents": [], "settings": []}'):
                with self.assertRaises(ValueError):
                    core.save_workspace(path, invalid)
                self.assertEqual(json.loads(path.read_text()), state)
            self.assertEqual(list(path.parent.glob('.workspace-*')), [])

    def test_non_regular_files_do_not_block(self):
        with tempfile.TemporaryDirectory() as temporary:
            fifo = Path(temporary) / 'pipe'
            os.mkfifo(fifo)
            with self.assertRaises(ValueError):
                core.read_file(fifo)

    def test_folder_boundaries_and_binary_skip(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = parent / 'chosen'
            root.mkdir()
            (root / 'nested').mkdir()
            (root / 'nested/script.py').write_text('print("hello 🐧")\n')
            (root / 'binary').write_bytes(b'a\0b')
            (root / 'too-big').write_bytes(b'x' * (1024 * 1024 + 1))
            (root / 'link').symlink_to(parent, target_is_directory=True)
            listing = core.list_folder(root.as_uri(), root.as_uri())
            self.assertEqual(listing['entries'][0]['name'], 'nested')
            self.assertNotIn('link', [entry['name'] for entry in listing['entries']])
            with self.assertRaises(ValueError):
                core.list_folder(root.as_uri(), parent.as_uri())
            with self.assertRaises(ValueError):
                core.list_folder(root.as_uri(), (root / 'link').as_uri())
            batch = core.search_candidates(root.as_uri())
            self.assertEqual([file['name'] for file in batch['candidates']], ['script.py'])
            self.assertEqual(batch['skipped'], 3)
            self.assertFalse(batch['limited'])


if __name__ == '__main__':
    unittest.main(verbosity=2)

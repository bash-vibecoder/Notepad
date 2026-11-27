'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../desktop/core.cjs');

test('decodes and preserves BOM encodings and line endings', () => {
  for (const encoding of ['UTF-8-BOM', 'UTF-16LE', 'UTF-16BE']) {
    const bytes = Core.encode('penguin 🐧\nline', encoding, 'CRLF');
    const decoded = Core.decode(bytes);
    assert.equal(decoded.encoding, encoding);
    assert.equal(decoded.text, 'penguin 🐧\nline');
    assert.equal(decoded.eol, 'CRLF');
    assert.equal(Core.fingerprint(Core.encode(decoded.text, decoded.encoding, decoded.eol)), Core.fingerprint(bytes));
  }
});

test('detects mixed and old Macintosh line endings', () => {
  assert.equal(Core.decode(Buffer.from('one\r\ntwo\nthree\r')).mixedEol, true);
  assert.equal(Core.decode(Buffer.from('one\rtwo\r')).eol, 'CR');
});

test('falls back to Windows-1252 but keeps Latin-1 distinct', () => {
  assert.equal(Core.decode(Buffer.from([0x93, 0x68, 0x69, 0x94])).text, '“hi”');
  assert.equal(Core.decode(Buffer.from([0x80]), 'ISO-8859-1').text, '\u0080');
  assert.deepEqual([...Core.encode('€', 'windows-1252', 'LF')], [0x80]);
});

test('rejects binary, invalid requested encodings, and unrepresentable text', () => {
  assert.throws(() => Core.decode(Buffer.from('x\0y')), /binary file/);
  assert.throws(() => Core.decode(Buffer.from([0xff]), 'UTF-8'), /not valid UTF-8/);
  assert.throws(() => Core.decode(Buffer.from([0x81])), /invalid text bytes/);
  assert.throws(() => Core.decode(Buffer.from([0xff, 0xfe, 0x61])), /not valid UTF-16LE/);
  assert.throws(() => Core.encode('€', 'US-ASCII', 'LF'), /cannot be saved/);
  assert.throws(() => Core.encode('\ud800', 'UTF-8', 'LF'), /invalid Unicode/);
});

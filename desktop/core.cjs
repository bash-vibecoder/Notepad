'use strict';

const {createHash} = require('node:crypto');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 32 * 1024 * 1024;
const SUPPORTED_ENCODINGS = new Set(['UTF-8', 'UTF-8-BOM', 'UTF-16LE', 'UTF-16BE', 'windows-1252', 'ISO-8859-1', 'US-ASCII']);
const cp1252 = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020],
  [0x87, 0x2021], [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022],
  [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);
const reverseCp1252 = new Map([...cp1252].map(([byte, codepoint]) => [codepoint, byte]));

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decode(bytes, requestedEncoding = '') {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('This file exceeds the 8 MB editing limit.');
  let encoding = requestedEncoding;
  let offset = 0;
  if (!encoding) {
    if (bytes.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0])) || bytes.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) {
      throw new Error('UTF-32 is not supported. Convert this file to UTF-8 first.');
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) { encoding = 'UTF-8-BOM'; offset = 3; }
    else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) { encoding = 'UTF-16LE'; offset = 2; }
    else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) { encoding = 'UTF-16BE'; offset = 2; }
    else encoding = 'UTF-8';
  } else {
    if (!SUPPORTED_ENCODINGS.has(encoding)) throw new Error('Unsupported text encoding: ' + encoding);
    if ((encoding === 'UTF-8' || encoding === 'UTF-8-BOM') && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) offset = 3;
    if (encoding === 'UTF-16LE' && bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) offset = 2;
    if (encoding === 'UTF-16BE' && bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) offset = 2;
  }

  const legacyText = data => Array.from(data, byte => {
    if (byte >= 0x80 && byte < 0xa0 && !cp1252.has(byte)) throw new Error('Undefined Windows-1252 byte.');
    return String.fromCodePoint(cp1252.get(byte) || byte);
  }).join('');
  let text;
  try {
    const data = bytes.subarray(offset);
    if (encoding === 'ISO-8859-1') text = Array.from(data, byte => String.fromCharCode(byte)).join('');
    else if (encoding === 'windows-1252') text = legacyText(data);
    else if (encoding === 'US-ASCII') {
      if (data.some(byte => byte > 0x7f)) throw new Error('Invalid ASCII bytes.');
      text = data.toString('ascii');
    } else {
      const label = encoding === 'UTF-8-BOM' ? 'utf-8' : encoding;
      text = new TextDecoder(label, {fatal: true}).decode(data);
    }
  } catch (error) {
    if (requestedEncoding || offset || encoding !== 'UTF-8') throw new Error('This file is not valid ' + encoding + '.');
    encoding = 'windows-1252';
    try { text = legacyText(bytes); }
    catch { throw new Error('This file contains invalid text bytes.'); }
  }
  if (text.includes('\0')) throw new Error('This appears to be a binary file or UTF-16 without a byte order mark.');
  const crlf = (text.match(/\r\n/g) || []).length;
  const withoutCrlf = text.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) || []).length;
  const cr = (withoutCrlf.match(/\r/g) || []).length;
  const eol = crlf > 0 && crlf >= lf && crlf >= cr ? 'CRLF' : cr > lf ? 'CR' : 'LF';
  const mixedEol = [crlf, lf, cr].filter(count => count > 0).length > 1;
  return {text: normalize(text), encoding, eol, mixedEol};
}

function encode(text, encoding, eol) {
  if (!SUPPORTED_ENCODINGS.has(encoding)) throw new Error('Unsupported text encoding: ' + encoding);
  if (!['LF', 'CRLF', 'CR'].includes(eol)) throw new Error('Unsupported line ending.');
  text = normalize(text);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('The document contains invalid Unicode text.');
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('The document contains invalid Unicode text.');
  }
  if (eol === 'CRLF') text = text.replace(/\n/g, '\r\n');
  else if (eol === 'CR') text = text.replace(/\n/g, '\r');
  let content;
  if (encoding === 'UTF-8' || encoding === 'UTF-8-BOM') content = Buffer.from(text, 'utf8');
  else if (encoding === 'UTF-16LE' || encoding === 'UTF-16BE') {
    content = Buffer.from(text, 'utf16le');
    if (encoding === 'UTF-16BE') for (let i = 0; i < content.length; i += 2) [content[i], content[i + 1]] = [content[i + 1], content[i]];
  } else {
    const bytes = [];
    for (const char of text) {
      const code = char.codePointAt(0);
      if (encoding === 'US-ASCII' && code <= 0x7f) bytes.push(code);
      else if (encoding === 'ISO-8859-1' && code <= 0xff) bytes.push(code);
      else if (encoding === 'windows-1252' && (code <= 0x7f || code >= 0xa0 && code <= 0xff)) bytes.push(code);
      else if (encoding === 'windows-1252' && reverseCp1252.has(code)) bytes.push(reverseCp1252.get(code));
      else throw new Error('Some characters cannot be saved as ' + encoding + '. Choose UTF-8 in the Encoding menu.');
    }
    content = Buffer.from(bytes);
  }
  const bom = encoding === 'UTF-8-BOM' ? Buffer.from([0xef, 0xbb, 0xbf])
    : encoding === 'UTF-16LE' ? Buffer.from([0xff, 0xfe])
      : encoding === 'UTF-16BE' ? Buffer.from([0xfe, 0xff]) : Buffer.alloc(0);
  if (content.length + bom.length > MAX_FILE_BYTES) throw new Error('The encoded document exceeds the 8 MB file limit.');
  return Buffer.concat([bom, content]);
}

module.exports = {MAX_FILE_BYTES, MAX_SESSION_BYTES, decode, encode, fingerprint, normalize};

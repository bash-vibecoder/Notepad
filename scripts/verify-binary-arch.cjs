'use strict';

const fs = require('node:fs');

const [file, format, requested] = process.argv.slice(2);
const machines = {
  pe: {ia32: 0x014c, x64: 0x8664},
  elf: {ia32: 3, x64: 62, arm64: 183},
};
if (!file || !machines[format] || !machines[format][requested]) throw new Error('Usage: verify-binary-arch.cjs FILE pe|elf ia32|x64|arm64');
const bytes = fs.readFileSync(file);
let machine;
if (format === 'pe') {
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', header, header + 4) !== 'PE\0\0') throw new Error(file + ' is not a PE executable.');
  machine = bytes.readUInt16LE(header + 4);
} else {
  if (bytes.toString('ascii', 0, 4) !== '\x7fELF') throw new Error(file + ' is not an ELF executable.');
  machine = bytes.readUInt16LE(18);
}
if (machine !== machines[format][requested]) {
  throw new Error(file + ' has unexpected machine type 0x' + machine.toString(16) + ', expected ' + requested + '.');
}
console.log(file + ' architecture verified: ' + requested);

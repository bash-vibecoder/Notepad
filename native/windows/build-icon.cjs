'use strict';
// ICO DIB images keep the same penguin artwork and work with RC and NSIS.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const sizes = [16, 32, 48, 256];
  const images = [];
  for (const size of sizes) {
    const rgba = await sharp(path.join(__dirname, 'anotep.svg')).resize(size, size).ensureAlpha().raw().toBuffer();
    const stride = Math.ceil(size / 32) * 4;
    const dib = Buffer.alloc(40 + size * size * 4 + stride * size);
    dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4, dst = 40 + ((size - 1 - y) * size + x) * 4;
      dib[dst] = rgba[src + 2]; dib[dst + 1] = rgba[src + 1]; dib[dst + 2] = rgba[src]; dib[dst + 3] = rgba[src + 3];
      if (!rgba[src + 3]) dib[40 + size * size * 4 + (size - 1 - y) * stride + Math.floor(x / 8)] |= 0x80 >> (x % 8);
    }
    images.push(dib);
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((data, i) => {
    const p = 6 + i * 16;
    header[p] = sizes[i] % 256; header[p + 1] = sizes[i] % 256;
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(data.length, p + 8); header.writeUInt32LE(offset, p + 12);
    offset += data.length;
  });
  fs.writeFileSync(path.join(__dirname, 'anotep.ico'), Buffer.concat([header, ...images]));
})().catch(error => { console.error(error); process.exitCode = 1; });

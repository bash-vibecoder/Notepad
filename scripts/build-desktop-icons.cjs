'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'desktop/icons');
  fs.mkdirSync(directory, {recursive: true});
  const png = await sharp(path.join(root, 'app/src/main/assets/icon.svg')).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(directory, 'anotep.png'), png);
  const ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico[6] = 0;
  ico[7] = 0;
  ico[8] = 0;
  ico[9] = 0;
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14);
  ico.writeUInt32LE(22, 18);
  png.copy(ico, 22);
  fs.writeFileSync(path.join(directory, 'anotep.ico'), ico);
}

main().catch(error => { console.error(error); process.exitCode = 1; });

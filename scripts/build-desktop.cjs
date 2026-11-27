'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let args = process.argv.slice(2);
if (process.platform === 'win32' || args.includes('--win')) {
  if (process.platform !== 'win32') throw new Error('Build the small native Windows edition on Windows with native/windows/build.ps1 or the Windows CI workflow.');
  const arch = args.includes('--ia32') ? 'ia32' : 'x64';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'native/windows/build.ps1'), '-Arch', arch], {cwd: root, stdio: 'inherit'});
  process.exit(result.status ?? 1);
}
if (args.includes('AppImage')) throw new Error('Small Linux packages use system WebKitGTK: build the .deb and portable .tar.xz with npm run dist -- --linux. The large Electron AppImage is retired.');
if (process.platform !== 'linux') throw new Error('Build the Linux .deb and portable archive on Linux with Python 3 and dpkg-deb.');
const result = spawnSync('python3', [path.join(root, 'native/linux/build.py')], {cwd: root, stdio: 'inherit'});
process.exit(result.status ?? 1);

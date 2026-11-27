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
let result = spawnSync(process.execPath, [path.join(root, 'scripts/build-desktop-icons.cjs')], {cwd: root, stdio: 'inherit'});
if (result.status) process.exit(result.status);
result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...args], {cwd: root, stdio: 'inherit'});
process.exit(result.status ?? 1);

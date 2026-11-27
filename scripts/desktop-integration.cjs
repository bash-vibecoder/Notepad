'use strict';

// Exercises the real isolated preload, renderer and local filesystem together.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anotep-desktop-'));
const profile = path.join(temporary, 'profile');
const source = path.join(temporary, 'original.txt');
const savedAs = path.join(temporary, 'saved-as.txt');
const sourceText = 'Hello 🐧\r\nsecond line\r\n';
fs.writeFileSync(source, '\ufeff' + sourceText);
let application, checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };

async function launch() {
  const executablePath = process.env.ANOTEP_TEST_EXECUTABLE || require('electron');
  application = await electron.launch({
    executablePath,
    args: [...(process.env.ANOTEP_TEST_EXECUTABLE ? [] : [root]), '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--user-data-dir=' + profile],
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForSelector('.document-tab');
  return page;
}

(async () => {
  try {
    let page = await launch();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    check(await page.evaluate(() => ({platform: AnotePNative.platform, node: typeof require})), {platform: 'desktop', node: 'undefined'}, 'Isolated bridge bootstraps the editor');
    check(await application.evaluate(({BrowserWindow}) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return [preferences.contextIsolation, preferences.sandbox, preferences.nodeIntegration];
    }), [true, true, false], 'Renderer security settings');
    await application.evaluate(({dialog}, source) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [source]}); }, source);
    await page.evaluate(() => { App.run('open'); });
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-name').textContent === 'original.txt');
    check(await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.getValue()), sourceText.replace(/\r\n/g, '\n'), 'Real native open preserves Unicode');
    await application.evaluate(({dialog}, target) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); }, savedAs);
    await page.evaluate(() => { App.run('saveAs'); });
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-name').textContent === 'saved-as.txt');
    check(fs.readFileSync(savedAs).equals(fs.readFileSync(source)), true, 'Save As to a new file preserves BOM and CRLF');
    await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.setValue('edited 🐧\nline\n'));
    await page.evaluate(() => { App.run('save'); });
    await page.waitForFunction(() => !document.querySelector('.document-tab.active .dirty'));
    check(fs.readFileSync(savedAs, 'utf8'), '\ufeffedited 🐧\r\nline\r\n', 'Native save writes selected encoding and line endings');
    fs.writeFileSync(savedAs, 'external edit');
    await page.evaluate(() => { document.querySelector('#editor .CodeMirror').CodeMirror.setValue('my revision'); App.run('save'); });
    await page.waitForSelector('#dialogBackdrop:not([hidden])');
    check(await page.locator('#dialogTitle').textContent(), 'File changed outside AnoteP', 'External modification is detected');
    check(fs.readFileSync(savedAs, 'utf8'), 'external edit', 'Conflict does not overwrite the file');
    await page.getByRole('button', {name: 'Overwrite', exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('.document-tab.active .dirty'));
    check(fs.readFileSync(savedAs, 'utf8'), '\ufeffmy revision', 'Explicit overwrite succeeds');
    await application.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, temporary);
    await page.evaluate(() => { AnotePNative.dispatch(JSON.stringify({type: 'chooseFolder'})); });
    await page.waitForSelector('.tree-node');
    check(await page.locator('#sidebar').isVisible(), true, 'Native folder picker and directory listing');
    await page.evaluate(() => { App.run('findInFiles'); });
    await page.waitForSelector('#dialogBackdrop:not([hidden])');
    await page.locator('#dialogBody input[type=text]').fill('Hello');
    await page.getByRole('button', {name: 'Find All', exact: true}).click();
    await page.waitForSelector('.result-row');
    check(await page.locator('.result-row').count(), 1, 'Find in local files returns the real source match');
    await page.locator('#closeResults').click();
    await page.evaluate(() => {
      const cm = document.querySelector('#editor .CodeMirror').CodeMirror;
      cm.setValue('clipboard test'); cm.execCommand('selectAll'); App.run('copy');
    });
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Copied'));
    check(await application.evaluate(({clipboard}) => clipboard.readText()), 'clipboard test', 'System clipboard bridge');
    await page.evaluate(() => { App.run('dark'); App.run('split'); });
    check(await page.locator('#secondaryPane').isVisible(), true, 'Desktop split view');
    await page.evaluate(() => { App.run('closeSplit'); });
    check(await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } }), true, 'Remote requests blocked');
    const screenshot = path.join(root, 'build/screenshots/desktop.png');
    fs.mkdirSync(path.dirname(screenshot), {recursive: true});
    await page.screenshot({path: screenshot});
    // Edit and close in the same task, before the 550 ms recovery timer fires.
    await page.evaluate(() => { document.querySelector('#editor .CodeMirror').CodeMirror.setValue('recover immediately 🐧'); window.close(); });
    await application.waitForEvent('close');
    application = null;
    const recovery = JSON.parse(fs.readFileSync(path.join(profile, 'workspace.json'), 'utf8'));
    check(recovery.documents.some(document => document.text === 'recover immediately 🐧' && document.dirty), true, 'Close synchronously saves the last unsaved edit');
    check(fs.readFileSync(savedAs, 'utf8'), '\ufeffmy revision', 'Recovery does not overwrite source files');
    page = await launch();
    check(await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.getValue()), 'recover immediately 🐧', 'Relaunch restores unsaved content');
    check(await page.locator('body').evaluate(body => body.classList.contains('dark')), true, 'Relaunch restores theme');
    check(await page.locator('.document-tab.active .dirty').count(), 1, 'Recovered tab stays dirty');
    check(errors, [], 'No renderer JavaScript errors');
    console.log('Desktop integration: ' + checks + ' checks passed.');
  } finally {
    if (application) await application.close();
    fs.rmSync(temporary, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

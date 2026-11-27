'use strict';

const {app, BrowserWindow, clipboard, dialog, ipcMain, session} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath, pathToFileURL} = require('node:url');
const Core = require('./core.cjs');

const ASSETS = path.resolve(__dirname, '../app/src/main/assets');
const EDITOR_URL = pathToFileURL(path.join(ASSETS, 'index.html')).href;
const WORKSPACE = () => path.join(app.getPath('userData'), 'workspace.json');
let mainWindow;
let selectedFolder = '';

function emit(type, payload = {}, requestId = '') {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('anotep:event', {type, payload, requestId});
}

function errorMessage(error) {
  return error && error.message ? error.message : 'The local file operation failed.';
}

function parseLocalUri(uri) {
  let target;
  try { target = fileURLToPath(uri); }
  catch { throw new Error('Only local files can be opened.'); }
  if (!path.isAbsolute(target)) throw new Error('Only local files can be opened.');
  return path.resolve(target);
}

function toUri(target) {
  return pathToFileURL(path.resolve(target)).href;
}

async function readFile(target, limit = Core.MAX_FILE_BYTES) {
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new Error('This path is not a file.');
  if (stat.size > limit) throw new Error(limit === Core.MAX_FILE_BYTES ? 'This file exceeds the 8 MB editing limit.' : 'This file exceeds the folder search limit.');
  const bytes = await fs.promises.readFile(target);
  if (bytes.length > limit) throw new Error('The file changed while it was being read.');
  return bytes;
}

async function openDocument(uri, requestedEncoding = '', line = 0) {
  const target = parseLocalUri(uri);
  const bytes = await readFile(target);
  const decoded = Core.decode(bytes, requestedEncoding);
  emit('opened', {
    uri: toUri(target), name: path.basename(target), text: decoded.text, encoding: decoded.encoding,
    eol: decoded.eol, mixedEol: decoded.mixedEol, fingerprint: Core.fingerprint(bytes),
    line: Number(line) || 0, reload: !!requestedEncoding,
  });
}

function saveWorkspace(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > Core.MAX_SESSION_BYTES) {
    throw new Error('Recovery storage is limited to 32 MB. Save and close some tabs.');
  }
  const state = JSON.parse(raw);
  if (!Array.isArray(state.documents) || state.documents.length > 30) throw new Error('A workspace can contain at most 30 tabs.');
  selectedFolder = state.settings && typeof state.settings.folderUri === 'string' ? state.settings.folderUri : '';
  const target = WORKSPACE();
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, raw, {mode: 0o600});
  try { fs.renameSync(temporary, target); }
  catch (error) {
    if (process.platform !== 'win32' || !fs.existsSync(target)) throw error;
    const backup = target + '.bak';
    try { fs.rmSync(backup, {force: true}); } catch {}
    fs.renameSync(target, backup);
    try { fs.renameSync(temporary, target); fs.rmSync(backup, {force: true}); }
    catch (replaceError) { fs.renameSync(backup, target); throw replaceError; }
  }
}

function bootstrap() {
  try {
    const bytes = fs.readFileSync(WORKSPACE());
    if (bytes.length > Core.MAX_SESSION_BYTES) throw new Error('The recovery snapshot is larger than 32 MB.');
    const state = JSON.parse(bytes.toString('utf8'));
    selectedFolder = state.settings && typeof state.settings.folderUri === 'string' ? state.settings.folderUri : '';
    emit('bootstrap', state);
  } catch (error) {
    if (error.code === 'ENOENT') emit('bootstrap', {});
    else {
      emit('error', {message: 'The recovery snapshot could not be loaded. Original files have not been changed.'});
      emit('bootstrap', {});
    }
  }
}

async function openPicker() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open local documents', properties: ['openFile', 'multiSelections'],
    filters: [{name: 'Text and source files', extensions: ['txt', 'text', 'md', 'c', 'h', 'cpp', 'hpp', 'java', 'kt', 'py', 'js', 'ts', 'json', 'xml', 'html', 'css', 'sql', 'sh', 'yaml', 'yml']}, {name: 'All files', extensions: ['*']}],
  });
  if (result.canceled) return;
  for (const target of result.filePaths.slice(0, 30)) {
    try { await openDocument(toUri(target)); }
    catch (error) { emit('error', {message: errorMessage(error)}); }
  }
}

async function saveDocument(payload, requestId) {
  const bytes = Core.encode(payload.text, payload.encoding, payload.eol);
  let target;
  const pickedTarget = payload.saveAs || !payload.uri;
  if (pickedTarget) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save document', defaultPath: /^new \d+$/.test(payload.name || '') ? 'document.txt' : payload.name || 'document.txt',
      filters: [{name: 'All files', extensions: ['*']}],
    });
    if (result.canceled || !result.filePath) { emit('cancelled', {}, requestId); return; }
    target = path.resolve(result.filePath);
  } else target = parseLocalUri(payload.uri);

  const expected = payload.fingerprint || '';
  if (!pickedTarget && !payload.force && expected) {
    let actual;
    try { actual = Core.fingerprint(await readFile(target)); }
    catch (error) {
      if (error.code === 'ENOENT') { emit('conflict', {name: path.basename(target)}, requestId); return; }
      throw error;
    }
    if (actual !== expected) { emit('conflict', {name: path.basename(target)}, requestId); return; }
  }
  await fs.promises.writeFile(target, bytes);
  emit('saved', {id: payload.id, uri: toUri(target), name: path.basename(target), fingerprint: Core.fingerprint(bytes)}, requestId);
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {title: 'Choose local workspace folder', properties: ['openDirectory']});
  if (result.canceled || !result.filePaths.length) return;
  selectedFolder = toUri(result.filePaths[0]);
  emit('folderChosen', {uri: selectedFolder, name: path.basename(result.filePaths[0]) || result.filePaths[0]});
}

async function checkedDirectory(uri) {
  if (!selectedFolder) throw new Error('Choose a local folder first.');
  const root = await fs.promises.realpath(parseLocalUri(selectedFolder));
  const target = await fs.promises.realpath(parseLocalUri(uri));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Choose this folder before browsing it.');
  }
  const stat = await fs.promises.stat(target);
  if (!stat.isDirectory()) throw new Error('This folder could not be read.');
  return {root, target};
}

async function listFolder(uri) {
  const {target} = await checkedDirectory(uri);
  const items = [];
  let truncated = false;
  for (const entry of await fs.promises.readdir(target, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    if (items.length >= 1000) { truncated = true; break; }
    items.push({uri: toUri(path.join(target, entry.name)), name: entry.name, directory: entry.isDirectory()});
  }
  items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
  return {uri: toUri(target), entries: items, truncated};
}

async function findInFiles(payload) {
  const query = payload.query;
  if (typeof query !== 'string' || !query || query.length > 1000) throw new Error('Enter a search up to 1,000 characters.');
  if (!selectedFolder) throw new Error('Choose a local folder from File first.');
  let expression = payload.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (payload.wholeWord) expression = '\\b(?:' + expression + ')\\b';
  let pattern;
  try { pattern = new RegExp(expression, payload.caseSensitive ? 'u' : 'iu'); }
  catch { throw new Error('Invalid regular expression.'); }

  const {root} = await checkedDirectory(selectedFolder);
  const folders = [root], matches = [];
  let files = 0, skipped = 0, bytesRead = 0, visitedFolders = 0, limited = false;
  scan: while (folders.length) {
    if (++visitedFolders > 200) { limited = true; break; }
    const directory = folders.pop();
    let entries;
    try { entries = await fs.promises.readdir(directory, {withFileTypes: true}); }
    catch { skipped++; continue; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped++; continue; }
      if (entry.isDirectory()) { folders.push(target); continue; }
      if (!entry.isFile()) continue;
      if (files >= 500 || bytesRead >= 16 * 1024 * 1024) { limited = true; break scan; }
      files++;
      try {
        const stat = await fs.promises.stat(target);
        if (stat.size > 1024 * 1024) { skipped++; continue; }
        const bytes = await fs.promises.readFile(target);
        if (bytesRead + bytes.length > 16 * 1024 * 1024) { limited = true; break scan; }
        bytesRead += bytes.length;
        const text = Core.decode(bytes).text;
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index++) {
          pattern.lastIndex = 0;
          const match = pattern.exec(lines[index]);
          if (!match) continue;
          const start = Math.max(0, match.index - 50);
          matches.push({uri: toUri(target), name: entry.name, line: index + 1, snippet: lines[index].slice(start, start + 180)});
          if (matches.length >= 200) { limited = true; break scan; }
        }
      } catch { skipped++; }
    }
  }
  return {matches, files, skipped, limited};
}

async function dispatch(raw) {
  let command;
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > Core.MAX_SESSION_BYTES) throw new Error('The editor request is too large.');
    command = JSON.parse(raw);
    const {type, payload = {}, requestId = ''} = command;
    switch (type) {
      case 'ready': bootstrap(); break;
      case 'persist': saveWorkspace(JSON.stringify(payload)); break;
      case 'open': await openPicker(); break;
      case 'openUri': await openDocument(payload.uri, payload.encoding || '', payload.line || 0); break;
      case 'save': await saveDocument(payload, requestId); break;
      case 'chooseFolder': await chooseFolder(); break;
      case 'listFolder': emit('folderListing', await listFolder(payload.uri), requestId); break;
      case 'findInFiles': emit('findResults', await findInFiles(payload), requestId); break;
      case 'copy': clipboard.writeText(payload.text || ''); emit('copied', {}, requestId); break;
      case 'paste': emit('pasted', {text: clipboard.readText()}, requestId); break;
      case 'licenses': emit('licenses', {text: await fs.promises.readFile(path.join(ASSETS, 'licenses.txt'), 'utf8')}, requestId); break;
      case 'theme': case 'hideKeyboard': break;
      default: throw new Error('Unknown editor request.');
    }
  } catch (error) {
    emit('error', {message: errorMessage(error)}, command && command.requestId || '');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 820, minWidth: 640, minHeight: 480,
    title: 'AnoteP', backgroundColor: '#edf0e8', show: false,
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'anotep.ico' : 'anotep.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== EDITOR_URL) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    if (input.type === 'keyDown' && (input.key === 'F12' || input.control && input.shift && key === 'i')) event.preventDefault();
  });
  mainWindow.webContents.on('devtools-opened', () => mainWindow.webContents.closeDevTools());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(ASSETS, 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_details, callback) => callback({cancel: true}));
  const trustedSender = event => mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === EDITOR_URL;
  ipcMain.on('anotep:dispatch', (event, raw) => { if (trustedSender(event)) dispatch(raw); });
  ipcMain.on('anotep:flush', (event, raw) => {
    if (!trustedSender(event)) { event.returnValue = false; return; }
    try { saveWorkspace(raw); event.returnValue = true; }
    catch { event.returnValue = false; }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

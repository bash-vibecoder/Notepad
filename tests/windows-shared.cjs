/* Real WebView2/Win32 integration; developer automation is not packaged. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {spawn, execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const executable = path.resolve(process.argv[2]);
const label = process.argv[3] || 'windows';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'AnoteP shared '));
const profile = path.join(temporary, 'profile');
const workspace = path.join(temporary, 'files');
fs.mkdirSync(workspace);
const source = path.join(workspace, 'original.txt');
const saved = path.join(workspace, 'saved-as.txt');
fs.writeFileSync(source, '\ufeffHello 🐧\r\nsecond line\r\n');
let child, browser, page, port, checks = 0;
const check = (actual, expected, name) => { assert.deepEqual(actual, expected, name); checks++; console.log('PASS ' + name); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, name, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await delay(100); }
  throw new Error('Timed out: ' + name);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function launch() {
  const diagnostic = [];
  child = spawn(executable, ['--profile', profile], {env: {...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port + ' --remote-allow-origins=*'}, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.on('data', b => diagnostic.push(b.toString()));
  child.stderr.on('data', b => diagnostic.push(b.toString()));
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error('AnoteP exited ' + child.exitCode + ': ' + diagnostic.join(''));
    try { return (await fetch('http://127.0.0.1:' + port + '/json/version')).ok; } catch { return false; }
  }, 'WebView2 developer connection', 60000).catch(error => { throw new Error(error.message + '\n' + diagnostic.join('')); });
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  await waitFor(() => browser.contexts()[0]?.pages().length, 'AnoteP page');
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => console.error('Editor error:', error.message));
  await page.waitForSelector('.document-tab');
  await page.evaluate(() => {
    window.__nativeTestEvents = [];
    chrome.webview.addEventListener('message', event => window.__nativeTestEvents.push(event.data));
  });
  return page;
}
const run = action => page.evaluate(action => { App.run(action); }, action);
const value = () => page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.getValue());
const setText = text => page.evaluate(text => document.querySelector('#editor .CodeMirror').CodeMirror.setValue(text), text);
const send = (type, payload = {}) => page.evaluate(({type, payload}) => AnotePNative.dispatch(JSON.stringify({type, payload})), {type, payload});
function dialog(title, action, file = '') {
  execFileSync('python', [path.join(root, 'native/windows-webview/dialog.py'), title, action, file], {stdio: 'inherit', timeout: 30000, env: {...process.env, PYTHONUTF8: '1'}});
}
async function close(force = false) {
  const exit = new Promise(resolve => child.once('exit', resolve));
  if (force) child.kill();
  else await page.evaluate(() => window.close());
  const result = await Promise.race([exit, delay(25000).then(() => { throw new Error('Host did not close'); })]);
  if (!force) check(result, 0, 'Host closes after durable recovery');
  child = null;
  try { await browser.close(); } catch {}
  browser = null;
}

(async () => {
  try {
    check(execFileSync(executable, ['--version'], {encoding: 'utf8'}).trim(), 'AnoteP ' + version, 'Executable version is unified');
    port = await freePort();
    await launch();
    check(await page.evaluate(() => [ANOTEP_VERSION, AnotePNative.version, AnotePNative.platform, typeof require]),
      [version, version, 'desktop', 'undefined'], 'Shared app version and isolated native bridge');
    await run('about');
    await page.waitForSelector('.about-name');
    check(await page.locator('.about-name').textContent(), 'AnoteP ' + version, 'About dialog uses the common version');
    await page.locator('#dialogClose').click();
    await run('open'); dialog('Open local documents', 'accept', source);
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-name').textContent === 'original.txt');
    check(await value(), 'Hello 🐧\nsecond line\n', 'Native open dialog reads local Unicode');
    await run('saveAs'); dialog('Save document', 'accept', saved);
    await page.waitForFunction(() => document.querySelector('.document-tab.active .tab-name').textContent === 'saved-as.txt');
    check(fs.readFileSync(saved).equals(fs.readFileSync(source)), true, 'Native Save As preserves BOM and CRLF');
    await setText('my revision 🐧'); await run('save');
    await page.waitForFunction(() => !document.querySelector('.document-tab.active .dirty'));
    check(fs.readFileSync(saved, 'utf8'), '\ufeffmy revision 🐧', 'Explicit save preserves encoding');
    fs.writeFileSync(saved, 'external edit');
    await setText('conflicting revision'); await run('save');
    await page.waitForSelector('#dialogBackdrop:not([hidden])');
    check(await page.locator('#dialogTitle').textContent(), 'File changed outside AnoteP', 'External changes trigger a conflict');
    check(fs.readFileSync(saved, 'utf8'), 'external edit', 'Conflict preserves external file');
    await page.getByRole('button', {name: 'Overwrite', exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('.document-tab.active .dirty'));
    await send('chooseFolder'); dialog('Choose local workspace folder', 'accept', workspace);
    await page.waitForSelector('.tree-node');
    check(await page.locator('#sidebar').isVisible(), true, 'Native folder picker and folder tree');
    await run('findInFiles');
    await page.waitForSelector('#dialogBackdrop:not([hidden])');
    await page.locator('#dialogBody input[type=text]').fill('Hello');
    await page.getByRole('button', {name: 'Find All', exact: true}).click();
    await page.waitForSelector('.result-row');
    check(await page.locator('.result-row').count(), 1, 'Native folder search uses shared regex semantics');
    await page.locator('#closeResults').click();
    await run('new');
    for (const [text, language] of [
      ['def greet(name):\n    print(name)\n', 'Python'],
      ['#!/bin/bash\necho hello\n', 'Shell'],
      ['const greet = name => { console.log(name); };\n', 'JavaScript'],
      ['{"name":"AnoteP","offline":true}', 'JSON']]) {
      await setText(text);
      await page.waitForFunction(language => document.getElementById('languageStatus').textContent.includes(language), language);
      check((await page.locator('#languageStatus').textContent()).includes(language), true, 'Automatic scratch language detection: ' + language);
    }
    await run('language:text/plain'); await setText('def manual_override():\n    print("keep plain")\n');
    await delay(850);
    check(await page.locator('#languageStatus').textContent(), 'Normal text', 'Manual language override survives typing');
    await run('autoLanguage');
    await page.waitForFunction(() => document.getElementById('languageStatus').textContent.includes('Python'));
    check(true, true, 'Auto detection can be enabled again');
    await setText('abc');
    await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.setCursor({line:0,ch:0}));
    await page.locator('[data-modifier=shift]').click();
    await page.locator('[data-key=right]').click(); await page.locator('[data-key=right]').click();
    check(await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.getSelection()), 'ab', 'Shared Shift and arrow keys select text');
    await page.locator('[data-modifier=shift]').click();
    await page.locator('[data-modifier=ctrl]').click(); await page.locator('[data-key=A]').click();
    check(await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.getSelection()), 'abc', 'Shared Ctrl+A coding keys');
    await run('copy');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Copied'));
    await setText(''); await run('paste');
    await page.waitForFunction(() => document.querySelector('#editor .CodeMirror').CodeMirror.getValue() === 'abc');
    check(await value(), 'abc', 'Native Windows clipboard copy and paste');
    await setText(''); await run('recordMacro');
    await page.evaluate(() => document.querySelector('#editor .CodeMirror').CodeMirror.replaceSelection('xyz','end','+input'));
    await run('stopMacro'); await run('playMacro');
    check(await value(), 'xyzxyz', 'Shared local macro record and playback');
    await run('saveMacro'); await run('bookmark');
    check(await page.locator('.bookmark-marker').count() > 0, true, 'Shared bookmarks');
    await run('split'); check(await page.locator('#secondaryPane').isVisible(), true, 'Shared cloned split view');
    await run('closeSplit'); await run('dark');
    check(await page.locator('body').evaluate(b => b.classList.contains('dark')), true, 'Shared dark preference');
    const requests = [];
    const server = http.createServer((request,response) => { requests.push(request.url); response.setHeader('Access-Control-Allow-Origin','*'); response.end('control'); });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    try {
      const url = 'http://127.0.0.1:' + server.address().port + '/must-not-connect';
      await fetch(url); check(requests.length, 1, 'Network test listener positive control'); requests.length = 0;
      check(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } },url), true, 'Shared CSP blocks remote fetch');
      const cdp = await browser.contexts()[0].newCDPSession(page);
      await cdp.send('Page.setBypassCSP',{enabled:true});
      await page.evaluate(async url => { try { await fetch(url); } catch {} },url);
      check(requests, [], 'Native request filter also blocks network with CSP bypassed in the test');
      await cdp.send('Page.setBypassCSP',{enabled:false});
      await page.evaluate(() => { location.href='https://example.com/'; });
      await delay(300);
      check(page.url(), 'https://anotep.local/index.html', 'Remote navigation stays blocked');
    } finally { await new Promise(resolve => server.close(resolve)); }
    fs.mkdirSync(path.join(root,'build/screenshots'),{recursive:true});
    await page.screenshot({path:path.join(root,'build/screenshots/shared-'+label+'.png')});
    const scratch = 'def scratch_saved():\n    print("survives 🐧")\n';
    await run('language:text/plain');
    await page.evaluate(text => { document.querySelector('#editor .CodeMirror').CodeMirror.setValue(text); window.close(); },scratch);
    await waitFor(() => child.exitCode !== null,'immediate host close'); child=null;
    try { await browser.close(); } catch {} browser=null;
    check(JSON.parse(fs.readFileSync(path.join(profile,'workspace.json'),'utf8')).documents.some(d=>d.text===scratch&&d.dirty),true,'Immediate close durably captures the last scratch edit');
    await launch();
    check(await value(),scratch,'Relaunch restores unsaved scratch text');
    check(await page.locator('#languageStatus').textContent(),'Normal text','Manual language override persists across restart');
    await run('autoLanguage');
    await page.waitForFunction(()=>document.getElementById('languageStatus').textContent.includes('Python'));
    check(await page.locator('body').evaluate(b=>b.classList.contains('dark')),true,'Relaunch restores theme');
    await setText('periodic crash recovery 🐧');
    await waitFor(()=>JSON.parse(fs.readFileSync(path.join(profile,'workspace.json'),'utf8')).documents.some(d=>d.text==='periodic crash recovery 🐧'),'periodic recovery checkpoint');
    await close(true); await launch();
    check(await value(),'periodic crash recovery 🐧','Recovery survives forced host termination');
    await close();
    const native=fs.existsSync(path.join(path.dirname(executable),'portable.flag'))
      ? path.dirname(executable) : path.join(profile,'Native');
    fs.mkdirSync(path.join(native,'backup'),{recursive:true});
    const backup=path.join(native,'backup','new 7@test');fs.writeFileSync(backup,'\ufeffprevious native scratch 🐧\r\n');
    const session=path.join(native,'session.xml');
    const escaped=backup.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const xml='<NotepadPlus><Session><mainView><File filename="new 7" backupFilePath="'+escaped+'"/></mainView><subView/></Session></NotepadPlus>';
    fs.writeFileSync(session,xml);
    await launch();
    check(await value(),'previous native scratch 🐧\n','Previous native scratch is imported into the shared editor');
    check(fs.readFileSync(session,'utf8'),xml,'Native session.xml is preserved');
    check(fs.readFileSync(backup,'utf8'),'\ufeffprevious native scratch 🐧\r\n','Native recovery bytes are preserved');
    check(fs.existsSync(path.join(profile,'workspace-before-native-import.json')),true,'Existing shared workspace is backed up before merging');
    const snapshot=path.join(profile,'workspace.json'), retained=snapshot+'.retained';
    fs.renameSync(snapshot,retained); fs.mkdirSync(snapshot);
    await page.evaluate(()=>window.close());
    dialog('AnoteP','ok');
    check(child.exitCode,null,'Failed recovery write keeps the host running');
    check(await value(),'previous native scratch 🐧\n','Failed recovery write preserves the active text');
    fs.rmdirSync(snapshot); fs.renameSync(retained,snapshot);
    await close();
    console.log('Shared Windows integration: '+checks+' checks passed.');
    fs.writeFileSync(path.join(root,'build/screenshots/shared-'+label+'-checks.json'),JSON.stringify({version,checks},null,2));
  } catch (error) {
    if (page) {
      try { console.error('Editor failure state:', JSON.stringify(await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('.document-tab')].map(tab => tab.textContent),
        toast: document.getElementById('toast')?.textContent,
        events: window.__nativeTestEvents
      })))); } catch {}
      try {
        fs.mkdirSync(path.join(root,'build/screenshots'),{recursive:true});
        await page.screenshot({path:path.join(root,'build/screenshots/shared-'+label+'-failure.png'),timeout:5000});
      } catch {}
    }
    console.error('Local test files:', fs.readdirSync(workspace));
    throw error;
  } finally {
    if (child) {
      try { console.error(execFileSync('python',[path.join(root,'native/windows-webview/dialog.py'),'inspect'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}})); } catch {}
      try { console.error(execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq '+child.pid+'} | Select-Object ProcessId,CommandLine | Format-List'],{encoding:'utf8'})); } catch {}
    }
    if(child) { child.kill(); }
    if(browser) { try { await browser.close(); } catch {} }
    try { fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200}); }
    catch { console.warn('Temporary WebView2 cache is still held by its exiting system process.'); }
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });

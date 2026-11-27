(function () {
  'use strict';
  const $ = id => document.getElementById(id), Core = window.EditorCore;
  const defaults = {dark:false, fontSize:14, tabSize:4, indentWithTabs:true, wrap:false, lineNumbers:true,
    whitespace:false, activeLine:true, autoClose:true, autocomplete:false, codingKeys:true, folderUri:'', folderName:'', recent:[], macro:[]};
  let settings = {...defaults}, documents = [], activeId = '', nextId = 0, editor, secondEditor, splitId = '', focusedEditor;
  const modifiers = {shift:false,ctrl:false,alt:false};
  let menuName = '', dialogResolve = null, persistTimer, toastTimer, searchTimer, requestCounter = 0;
  let searchMarks = [], matches = [], queryError = '', lastSearchKey = '', loading = true, restored = false;
  let activeMenuButton = null, recording = false, replaying = false, commandDepth = 0, macroSteps = [];
  const pending = new Map(), saves = new Map(), detectTimers = new Map();
  const current = () => documents.find(d => d.id === activeId);
  const activeCM = () => focusedEditor === secondEditor && secondEditor ? secondEditor : editor;
  const focusedDocument = () => activeCM() === secondEditor ? documents.find(d => d.id === splitId) || current() : current();
  const dirty = d => !d.cm.isClean(d.cleanGeneration) || d.encoding !== d.cleanEncoding || d.eol !== d.cleanEol || !!d.initialDirty;
  const textNode = (tag, text, cls) => { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; };

  function native(type, payload = {}, requestId = '') {
    if (window.AnotePNative) window.AnotePNative.dispatch(JSON.stringify({type, payload, requestId}));
    else if (type === 'ready') setTimeout(() => bootstrap({}), 0);
    else if (!['persist','theme','hideKeyboard'].includes(type)) toast('This action uses the Android system in the installed AnoteP APK.');
  }
  function nativeRequest(type, payload) {
    return new Promise(resolve => { const id = 'r' + (++requestCounter); pending.set(id, resolve); native(type, payload, id); });
  }
  function toast(text, duration = 3200) {
    $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').hidden = true, duration);
  }
  function captureWorkspace() {
    return {version:1, activeId, settings, documents:documents.map(d => ({id:d.id, name:d.name, uri:d.uri, text:d.cm.getValue(),
      encoding:d.encoding, eol:d.eol, mode:d.mode, autoLanguage:d.autoLanguage, dirty:dirty(d), fingerprint:d.fingerprint,
      cursor:d.cm.getCursor(), scroll:d.cm.getEditor() ? d.cm.getEditor().getScrollInfo() : {top:d.cm.scrollTop,left:d.cm.scrollLeft}, bookmarks:bookmarkLines(d)}))};
  }
  function flushSession() {
    clearTimeout(persistTimer); if (restored) native('persist', captureWorkspace());
  }
  function schedulePersist() { clearTimeout(persistTimer); persistTimer = setTimeout(flushSession, 550); }
  function bootstrap(state) {
    if (restored) return;
    settings = {...defaults, ...(state.settings || {})};
    settings.recent = Array.isArray(settings.recent) ? settings.recent.slice(0, 15) : [];
    settings.macro = Array.isArray(settings.macro) ? settings.macro.slice(0, 2000) : [];
    settings.fontSize = Math.max(10, Math.min(28, Number(settings.fontSize) || 14));
    settings.tabSize = [2,4,8].includes(settings.tabSize) ? settings.tabSize : 4;
    const recovered = Array.isArray(state.documents) ? state.documents.slice(0, 30) : [];
    for (const data of recovered) if (typeof data.text === 'string') addDocument(data, false);
    if (!documents.length) addDocument({name:'new 1',text:'',eol:'CRLF'}, false);
    switchDocument(documents.some(d => d.id === state.activeId) ? state.activeId : documents[0].id);
    restored = true; loading = false; applySettings(); renderTabs(); updateStatus();
    if (settings.folderUri) renderFolderRoot();
    schedulePersist();
  }
  function guessMode(name,text='') {
    const info = CodeMirror.findModeByFileName(name);
    const mime=info ? info.mime || info.mimes[0] : 'text/plain';
    return mime==='text/plain'?Core.detectLanguage(text):mime;
  }
  function modeName(mime) {
    if (!mime || mime === 'text/plain') return 'Normal text';
    const info = CodeMirror.findModeByMIME(mime);
    return info ? info.name : mime;
  }
  function addDocument(data = {}, activate = true) {
    if (documents.length >= 30) { toast('The workspace is limited to 30 tabs. Save and close a tab first.'); return null; }
    const id = data.id && !documents.some(d => d.id === data.id) ? data.id : 'doc-' + Date.now() + '-' + (++nextId);
    const name = data.name || nextName();
    const autoLanguage=data.autoLanguage!==false,mode=autoLanguage?guessMode(name,data.text||''):data.mode||'text/plain';
    const cm = new CodeMirror.Doc(Core.normalize(data.text || ''), mode);
    const d = {id, name, uri:data.uri || '', encoding:data.encoding || 'UTF-8', eol:data.eol || 'CRLF', mode, autoLanguage,
      cm, initialDirty:!!data.dirty, fingerprint:data.fingerprint || '', cleanGeneration:cm.changeGeneration(true),
      cleanEncoding:data.encoding || 'UTF-8', cleanEol:data.eol || 'CRLF', bookmarkHandles:[]};
    if (data.cursor) cm.setCursor(data.cursor);
    if (data.scroll) { cm.scrollTop = data.scroll.top || 0; cm.scrollLeft = data.scroll.left || 0; }
    documents.push(d);
    cm.on('change', () => { if (!loading) { renderTabs(); updateStatus(); scheduleSearch(); schedulePersist();scheduleDetection(d); } });
    if (Array.isArray(data.bookmarks)) for (const line of data.bookmarks) if (line >= 0 && line < cm.lineCount()) setBookmark(d,line,true);
    if (activate) { switchDocument(id); schedulePersist(); }
    return d;
  }
  function nextName() {
    let n = 1; while (documents.some(d => d.name === 'new ' + n)) n++;
    return 'new ' + n;
  }
  function switchDocument(id) {
    const d = documents.find(x => x.id === id); if (!d) return;
    clearSearchMarks();
    if (secondEditor && splitId === id) closeSplit();
    activeId = id;
    focusedEditor = editor;
    editor.swapDoc(d.cm);
    editor.setOption('mode', d.mode);
    renderTabs(); updateStatus(); scheduleSearch(); schedulePersist();
    setTimeout(() => { editor.refresh(); const tab = $('tabs').querySelector('[data-id="' + id + '"]'); if (tab) tab.scrollIntoView({block:'nearest',inline:'nearest'}); },0);
  }
  function renderTabs() {
    $('tabs').replaceChildren();
    for (const d of documents) {
      const tab = textNode('div','','document-tab' + (d.id === activeId ? ' active' : ''));
      tab.dataset.id = d.id; tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(d.id === activeId));
      tab.tabIndex = d.id === activeId ? 0 : -1;
      tab.append(textNode('span',dirty(d) ? '' : '▤',dirty(d) ? 'dirty' : 'file-dot'),textNode('span',d.name,'tab-name'));
      const close = textNode('button','×'); close.title = 'Close ' + d.name; close.setAttribute('aria-label','Close ' + d.name);
      close.addEventListener('click',e => {e.stopPropagation();closeDocument(d.id);}); tab.append(close);
      tab.title = d.name + (dirty(d) ? ' • modified' : ''); tab.addEventListener('click',() => switchDocument(d.id));
      tab.addEventListener('keydown',e => { if (e.key === 'Enter') switchDocument(d.id); });
      $('tabs').append(tab);
    }
    const d = current(); if (d) { $('windowTitle').textContent = d.name + (dirty(d) ? ' *' : ''); document.title = d.name + ' – AnoteP'; }
    if (splitId) { const s = documents.find(d => d.id === splitId); if (s) $('splitTitle').textContent = s.name + ' · second view'; }
  }
  function updateStatus() {
    const d = focusedDocument(); if (!d || !editor) return;
    const cm = activeCM(), cursor = cm.getCursor(), selection = cm.getSelection();
    $('positionStatus').textContent = 'Ln ' + (cursor.line+1) + ' : Col ' + (cursor.ch+1) + (selection ? ' | Sel ' + selection.length : '');
    $('lengthStatus').textContent = 'length: ' + cm.getValue().length.toLocaleString() + ' | lines: ' + cm.lineCount().toLocaleString();
    $('eolStatus').textContent = d.eol === 'CRLF' ? 'Windows (CR LF)' : d.eol === 'LF' ? 'Unix (LF)' : 'Mac (CR)';
    $('encodingStatus').textContent = d.encoding === 'UTF-8-BOM' ? 'UTF-8 BOM' : d.encoding;
    $('languageStatus').textContent = modeName(d.mode)+(d.autoLanguage?' · Auto':'');
    $('languageStatus').title=d.autoLanguage?'Automatically detected from filename and content':'Manually selected language';
    $('insertStatus').textContent = cm.state.overwrite ? 'OVR' : 'INS';
    const undo = $('toolbar').querySelector('[data-action="undo"]'), redo = $('toolbar').querySelector('[data-action="redo"]');
    if (undo) undo.disabled = cm.historySize().undo === 0;
    if (redo) redo.disabled = cm.historySize().redo === 0;
  }
  async function closeDocument(id) {
    const d = documents.find(d => d.id === id); if (!d) return;
    if (dirty(d)) {
      const answer = await message('Save changes?', 'Save changes to “' + d.name + '” before closing?', [
        {label:'Cancel',value:'cancel'},{label:'Discard',value:'discard',className:'danger'},{label:'Save',value:'save',className:'primary'}]);
      if (!answer || answer === 'cancel') return;
      if (answer === 'save' && !(await saveDocument(d))) return;
      if (answer === 'save' && dirty(d)) { toast('The document changed while saving. Save again before closing.'); return; }
    }
    if (splitId === id) closeSplit();
    const index = documents.indexOf(d); documents.splice(index,1);
    if (!documents.length) addDocument({name:'new 1',text:''});
    else if (activeId === id) switchDocument(documents[Math.min(index,documents.length-1)].id);
    renderTabs(); schedulePersist();
  }
  async function saveDocument(d = focusedDocument(), saveAs = false, force = false) {
    if (!d) return false;
    if ([...saves.values()].some(s => s.doc.id === d.id)) { toast('This document is already being saved.'); return false; }
    let name = d.name;
    if ((saveAs || !d.uri) && window.AnotePNative?.platform !== 'desktop') {
      name = await promptText('Save As','File name',/^new \d+$/.test(d.name) ? 'document.txt' : d.name);
      if (!name) return false;
      if (/[\/\\\x00-\x1f]/.test(name)) { toast('Use a file name without slashes or control characters.'); return false; }
    }
    const requestId = 'save' + (++requestCounter);
    const payload = {id:d.id,name,uri:d.uri,text:d.cm.getValue(),encoding:d.encoding,eol:d.eol,fingerprint:d.fingerprint,saveAs,force};
    const snapshot = {doc:d, payload, generation:d.cm.changeGeneration(), encoding:d.encoding, eol:d.eol};
    saves.set(requestId,snapshot);
    return new Promise(resolve => { snapshot.resolve = resolve; native('save',payload,requestId); });
  }
  function remember(d) {
    if (!d.uri) return;
    settings.recent = [{name:d.name,uri:d.uri},...settings.recent.filter(r => r.uri !== d.uri)].slice(0,15);
  }
  async function receiveOpened(p) {
    const existing = documents.find(d => d.uri === p.uri);
    if (existing && !p.reload) { switchDocument(existing.id); if (p.line) gotoLine(p.line); return; }
    if (existing && p.reload) {
      if (dirty(existing)) { toast('Save or discard edits before reloading with another encoding.'); return; }
      existing.cm.setValue(p.text); existing.cm.clearHistory(); existing.initialDirty = false;
      existing.encoding = p.encoding; existing.eol = p.eol; existing.fingerprint = p.fingerprint;
      existing.cleanGeneration = existing.cm.changeGeneration(true); existing.cleanEncoding = p.encoding; existing.cleanEol = p.eol;
      switchDocument(existing.id); toast('Reloaded as ' + p.encoding); return;
    }
    const empty = current();
    if (documents.length === 1 && empty && !empty.uri && !empty.cm.getValue() && !dirty(empty)) documents = [];
    const d = addDocument(p); if (!d) return; remember(d);
    if (p.line) gotoLine(p.line);
    if (p.mixedEol) toast('Mixed line endings detected. Saving will normalize them to ' + p.eol + '.',6500);
    else if (p.encoding === 'windows-1252') toast('Opened using Windows-1252. Use Encoding to change it if needed.',5000);
  }
  function nativeEvent(event) {
    const p = event.payload || {}, requestId = event.requestId;
    if (['saved','error','cancelled','conflict'].includes(event.type) && saves.has(requestId)) {
      const snapshot = saves.get(requestId); saves.delete(requestId); const d = snapshot.doc;
      if (event.type === 'saved') {
        d.uri = p.uri; d.name = p.name; d.fingerprint = p.fingerprint; d.initialDirty = false;
        d.cleanGeneration = snapshot.generation; d.cleanEncoding = snapshot.encoding; d.cleanEol = snapshot.eol;
        if (d.autoLanguage) setDocMode(d,guessMode(d.name,d.cm.getValue()));
        remember(d); renderTabs(); updateStatus(); schedulePersist(); toast('Saved ' + d.name); snapshot.resolve(true);
      } else if (event.type === 'conflict') {
        message('File changed outside AnoteP','“' + d.name + '” has changed on disk. Save a copy or overwrite those changes?',[
          {label:'Cancel',value:'cancel'},{label:'Save As',value:'copy'},{label:'Overwrite',value:'overwrite',className:'danger'}]).then(async answer => {
            if (answer === 'copy') snapshot.resolve(await saveDocument(d,true));
            else if (answer === 'overwrite') snapshot.resolve(await saveDocument(d,false,true));
            else snapshot.resolve(false);
          });
      } else { if (event.type === 'error') toast(p.message,6500); snapshot.resolve(false); }
      return;
    }
    if (pending.has(requestId)) { const resolve = pending.get(requestId); pending.delete(requestId); resolve(event); }
    switch (event.type) {
      case 'bootstrap': bootstrap(p); break;
      case 'opened': receiveOpened(p); break;
      case 'sharedText': addDocument({text:p.text,name:nextName(),dirty:true}); break;
      case 'error': toast(p.message,6500); break;
      case 'folderChosen': settings.folderUri = p.uri; settings.folderName = p.name; renderFolderRoot(); $('sidebar').hidden = false; editor.refresh(); schedulePersist(); break;
      case 'licenses': showLicenses(p.text); break;
    }
  }

  function buildEditors() {
    const options = {value:'', mode:'text/plain', lineNumbers:true, indentUnit:4, tabSize:4, indentWithTabs:true,
      lineWrapping:false, matchBrackets:true, autoCloseBrackets:true, autoCloseTags:true, styleActiveLine:true,
      foldGutter:true, gutters:['bookmark-gutter','CodeMirror-linenumbers','CodeMirror-foldgutter'],
      inputStyle:'textarea', spellcheck:false, autocorrect:false, autocapitalize:false, viewportMargin:10,
      highlightSelectionMatches:{showToken:/\w/,annotateScrollbar:false}, extraKeys:{
        'Tab':cm => { if (cm.somethingSelected()) cm.indentSelection('add'); else cm.replaceSelection(settings.indentWithTabs ? '\t' : ' '.repeat(settings.tabSize),'end','+input'); },
        'Shift-Tab':cm => cm.indentSelection('subtract'),
        'Ctrl-Space':cm => cm.showHint({hint:CodeMirror.hint.anyword,completeSingle:false}),
        'Ctrl-/':cm => cm.toggleComment(),
        'Ctrl-D':cm => CodeMirror.commands.duplicateLine ? cm.execCommand('duplicateLine') : duplicateLines(cm)
      }};
    editor = CodeMirror($('editor'),options);
    connectEditor(editor);
  }
  function connectEditor(cm) {
    cm.on('cursorActivity',updateStatus);
    cm.on('focus',()=>{focusedEditor=cm;updateStatus();});
    cm.on('gutterClick',(instance,line,gutter) => { if (gutter === 'bookmark-gutter' || gutter === 'CodeMirror-linenumbers') toggleBookmark(instance,line); });
    cm.on('inputRead',(instance,change) => {
      if (settings.autocomplete && change.origin === '+input' && /[\w.]$/.test(change.text.join('')) && !instance.state.completionActive)
        instance.showHint({hint:CodeMirror.hint.anyword,completeSingle:false});
    });
    cm.on('beforeChange',(instance,change) => {
      if (!loading && !replaying && change.origin === '+input' && change.text.length === 1 && change.text[0].length === 1 && (modifiers.ctrl || modifiers.alt || modifiers.shift)) {
        const character=change.text[0];
        if (modifiers.ctrl || modifiers.alt) {
          const key=character.toLowerCase(),action=shortcutAction(key,modifiers);
          change.cancel();clearModifiers();setTimeout(()=>{if(action)run(action);else if(key==='a')instance.execCommand('selectAll');},0);return;
        }
        if(modifiers.shift){change.update(change.from,change.to,[character.toUpperCase()]);clearModifiers();}
      }
      if (!recording || replaying || commandDepth || loading || change.origin === 'setValue') return;
      const doc = instance.getDoc(), head = doc.indexFromPos(doc.getCursor());
      macroSteps.push({type:'edit',from:doc.indexFromPos(change.from)-head,to:doc.indexFromPos(change.to)-head,text:change.text.join('\n')});
      if (macroSteps.length >= 2000) stopRecording();
    });
    cm.on('keydown',(instance,e) => {
      if (recording && !replaying && !e.ctrlKey && !e.metaKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
        const names = {ArrowLeft:'goCharLeft',ArrowRight:'goCharRight',ArrowUp:'goLineUp',ArrowDown:'goLineDown',Home:'goLineStart',End:'goLineEnd'};
        macroSteps.push({type:'cm',name:names[e.key]});
      }
    });
  }
  function applySettings() {
    document.body.classList.toggle('dark',settings.dark); document.documentElement.style.setProperty('--font-size',settings.fontSize+'px');
    $('keybar').hidden = !settings.codingKeys;
    for (const cm of [editor,secondEditor].filter(Boolean)) {
      cm.setOption('lineNumbers',settings.lineNumbers); cm.setOption('lineWrapping',settings.wrap);
      cm.setOption('tabSize',settings.tabSize); cm.setOption('indentUnit',settings.tabSize); cm.setOption('indentWithTabs',settings.indentWithTabs);
      cm.setOption('showTrailingSpace',settings.whitespace); cm.setOption('specialChars',settings.whitespace ? /[\u0000-\u0020\u007f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff]/ : /[\u0000-\u001f\u007f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff]/);
      cm.setOption('specialCharPlaceholder',ch => { const n = document.createElement('span'); n.style.color = '#a8aaa5'; n.textContent = ch === ' ' ? '·' : '•'; return n; });
      cm.setOption('styleActiveLine',settings.activeLine); cm.setOption('autoCloseBrackets',settings.autoClose); cm.setOption('autoCloseTags',settings.autoClose);
      cm.refresh();
    }
    native('theme',{dark:settings.dark}); schedulePersist();
    for (const action of ['wrap','whitespace']) { const btn = $('toolbar').querySelector('[data-action="'+action+'"]'); if (btn) btn.classList.toggle('enabled',settings[action]); }
  }

  // Menus use the same hierarchy and familiar command names as desktop Notepad++.
  function item(label,action,shortcut,checked) { return {label,action,shortcut,checked}; }
  const separator = () => ({separator:true});
  function menuItems(name) {
    const d = focusedDocument();
    switch (name) {
      case 'File': return [item('New','new','Ctrl+N'),item('Open…','open','Ctrl+O'),item('Open folder as workspace…','folder'),separator(),item('Save','save','Ctrl+S'),item('Save As…','saveAs','Ctrl+Shift+S'),item('Save All','saveAll','Ctrl+Alt+S'),separator(),item('Rename tab…','rename'),item('Recent files…','recent'),separator(),item('Close','close','Ctrl+W'),item('Close all…','closeAll')];
      case 'Edit': return [item('Undo','undo','Ctrl+Z'),item('Redo','redo','Ctrl+Y'),separator(),item('Cut','cut','Ctrl+X'),item('Copy','copy','Ctrl+C'),item('Paste','paste','Ctrl+V'),item('Select All','selectAll','Ctrl+A'),separator(),item('Duplicate current line','duplicate','Ctrl+D'),item('Delete current line','deleteLine','Ctrl+Shift+L'),item('Move line up','lineUp','Alt+↑'),item('Move line down','lineDown','Alt+↓'),item('Join lines','joinLines','Ctrl+J'),separator(),item('Increase indent','indent','Tab'),item('Decrease indent','outdent','Shift+Tab'),item('Toggle line comment','comment','Ctrl+/'),separator(),item('UPPERCASE','uppercase','Ctrl+Shift+U'),item('lowercase','lowercase','Ctrl+U'),item('Trim trailing spaces','trim'),item('Tabs to spaces','tabsToSpaces'),item('Sort lines ascending','sortAsc'),item('Sort lines descending','sortDesc'),item('Remove duplicate lines','unique')];
      case 'Search': return [item('Find…','find','Ctrl+F'),item('Replace…','replace','Ctrl+H'),item('Find Next','findNext','F3'),item('Find Previous','findPrev','Shift+F3'),item('Find in local files…','findInFiles','Ctrl+Shift+F'),item('Find in all open documents','findInTabs'),separator(),item('Go to line…','goto','Ctrl+G'),separator(),item('Toggle bookmark','bookmark','Ctrl+F2'),item('Next bookmark','nextBookmark','F2'),item('Previous bookmark','prevBookmark','Shift+F2'),item('Clear all bookmarks','clearBookmarks')];
      case 'View': return [item('Word wrap','wrap','',settings.wrap),item('Show line numbers','lineNumbers','',settings.lineNumbers),item('Show spaces / trailing whitespace','whitespace','',settings.whitespace),item('Highlight current line','activeLine','',settings.activeLine),separator(),item('Zoom In','zoomIn','Ctrl++'),item('Zoom Out','zoomOut','Ctrl+−'),item('Restore default zoom','zoomReset','Ctrl+0'),separator(),item('Clone to other view','split','',!!secondEditor),item('Open a different tab in other view…','splitOther'),item('Close other view','closeSplit'),separator(),item('Fold all','foldAll'),item('Unfold all','unfoldAll'),item('Toggle current fold','fold','Alt+0'),separator(),item('Folder as workspace','toggleFolder','',!$('sidebar').hidden),item('Coding key row','codingKeys','',settings.codingKeys)];
      case 'Encoding': return [item('Encode in UTF-8','encoding:UTF-8','',d?.encoding==='UTF-8'),item('Encode in UTF-8 with BOM','encoding:UTF-8-BOM','',d?.encoding==='UTF-8-BOM'),item('Encode in UTF-16 LE BOM','encoding:UTF-16LE','',d?.encoding==='UTF-16LE'),item('Encode in UTF-16 BE BOM','encoding:UTF-16BE','',d?.encoding==='UTF-16BE'),item('Encode in Windows-1252','encoding:windows-1252','',d?.encoding==='windows-1252'),item('Encode in ISO-8859-1','encoding:ISO-8859-1','',d?.encoding==='ISO-8859-1'),item('Encode in ASCII','encoding:US-ASCII','',d?.encoding==='US-ASCII'),separator(),item('Reload using encoding…','reloadEncoding'),separator(),item('Windows (CR LF)','eol:CRLF','',d?.eol==='CRLF'),item('Unix (LF)','eol:LF','',d?.eol==='LF'),item('Macintosh (CR)','eol:CR','',d?.eol==='CR')];
      case 'Language': return [item('Automatic (filename + content)','autoLanguage','',d?.autoLanguage),item('Choose language…','language'),separator(),...['text/plain','text/x-c++src','text/x-csrc','text/x-java','text/x-kotlin','text/x-python','text/javascript','application/json','text/html','text/css','text/x-sql','text/x-sh','application/xml','text/x-markdown','text/x-yaml'].map(m => item(modeName(m),'language:'+m,'',!d?.autoLanguage&&d?.mode===m))];
      case 'Settings': return [item('Style: default light','light','',!settings.dark),item('Style: dark','dark','',settings.dark),separator(),item('Preferences…','preferences'),item('Use tab characters','indentTabs','',settings.indentWithTabs),item('Use spaces','indentSpaces','',!settings.indentWithTabs),item('Tab width: 2','tabSize:2','',settings.tabSize===2),item('Tab width: 4','tabSize:4','',settings.tabSize===4),item('Tab width: 8','tabSize:8','',settings.tabSize===8),separator(),item('Auto-close brackets and tags','autoClose','',settings.autoClose),item('Suggest words while typing','autocomplete','',settings.autocomplete),item('Word completion','complete','Ctrl+Space')];
      case 'Macro': return [item(recording?'Stop Recording':'Start Recording',recording?'stopMacro':'recordMacro','',recording),item('Playback last macro','playMacro','Ctrl+Shift+P'),item('Run macro multiple times…','repeatMacro'),separator(),item('Save recorded macro locally','saveMacro'),item('Load saved macro','loadMacro'),item('Clear macro','clearMacro')];
      default: return [item('About AnoteP','about'),item('Keyboard shortcuts','shortcuts'),item('Offline and local files','privacy'),item('Supported features','features'),item('Open source licenses','licenses')];
    }
  }
  function openMenu(name,anchor) {
    if (menuName === name) { closeMenu(); return; }
    closeMenu(); menuName = name; activeMenuButton = anchor; anchor?.classList.add('open');
    const panel = $('menuPopover'); panel.replaceChildren();
    for (const entry of menuItems(name)) {
      if (entry.separator) { panel.append(textNode('div','','menu-separator')); continue; }
      const button = textNode('button','','menu-item'); button.setAttribute('role','menuitem'); button.dataset.action = entry.action;
      button.append(textNode('span',entry.checked ? '✓' : '','check'),textNode('span',entry.label,'label'));
      if (entry.shortcut) button.append(textNode('kbd',entry.shortcut));
      button.addEventListener('click',() => {closeMenu();run(entry.action);}); panel.append(button);
    }
    panel.hidden = false;
    positionMenu();
    native('hideKeyboard');
  }
  function positionMenu() {
    if (!menuName || $('menuPopover').hidden) return;
    const panel=$('menuPopover'),rect=activeMenuButton?.getBoundingClientRect()||{left:5,bottom:80};
    const height=window.visualViewport?.height||innerHeight;
    panel.style.maxHeight=Math.max(70,height-rect.bottom-8)+'px';
    panel.style.left=Math.max(5,Math.min(rect.left,innerWidth-panel.offsetWidth-5))+'px';
    panel.style.top=Math.max(5,Math.min(rect.bottom,height-panel.offsetHeight-8))+'px';
  }
  function closeMenu() { $('menuPopover').hidden = true; activeMenuButton?.classList.remove('open'); activeMenuButton = null; menuName = ''; }

  function dialog(title, content, buttons = [{label:'OK',value:'ok',className:'primary'}]) {
    if (dialogResolve) finishDialog(null);
    closeMenu(); $('dialogTitle').textContent = title; $('dialogBody').replaceChildren(content); $('dialogActions').replaceChildren();
    for (const spec of buttons) {
      const button = textNode('button',spec.label,spec.className || '');
      button.addEventListener('click',() => finishDialog(typeof spec.value === 'function' ? spec.value() : spec.value));
      $('dialogActions').append(button);
    }
    $('dialogBackdrop').hidden = false;
    native('hideKeyboard');
    setTimeout(() => { const focus = $('dialogBody').querySelector('input:not([type=checkbox]),select') || $('dialogActions').lastElementChild; focus?.focus(); if (focus?.tagName==='INPUT') focus.select(); },70);
    return new Promise(resolve => dialogResolve = resolve);
  }
  function finishDialog(value) { $('dialogBackdrop').hidden = true; const resolve = dialogResolve; dialogResolve = null; if (resolve) resolve(value); }
  function message(title,body,buttons) { return dialog(title,textNode('p',body),buttons); }
  function promptText(title,label,value,type='text') {
    const body = document.createElement('div'), input = document.createElement('input');
    input.type = type; input.value = value; input.setAttribute('aria-label',label);
    body.append(textNode('label',label,'field-label'),input);
    input.addEventListener('keydown',e => {if(e.key==='Enter') finishDialog(input.value.trim());});
    return dialog(title,body,[{label:'Cancel',value:null},{label:'OK',value:() => input.value.trim(),className:'primary'}]);
  }
  async function chooseLanguage() {
    const body = document.createElement('div'), search = document.createElement('input'), list = textNode('div','','choice-list');
    search.placeholder = 'Filter languages…'; search.setAttribute('aria-label','Filter languages');
    const languages = [{name:'Normal text',mime:'text/plain'},...CodeMirror.modeInfo.map(info => ({name:info.name,mime:info.mime || info.mimes[0]}))].sort((a,b)=>a.name.localeCompare(b.name));
    const render = () => {
      list.replaceChildren();
      if(!search.value){const automatic=textNode('button','Automatic — filename + content',focusedDocument()?.autoLanguage?'selected':'');automatic.addEventListener('click',()=>{enableDetection();finishDialog('ok');});list.append(automatic);}
      for (const info of languages.filter(i => i.name.toLowerCase().includes(search.value.toLowerCase()))) {
        const button = textNode('button',info.name,current()?.mode===info.mime?'selected':'');
        button.addEventListener('click',() => {setLanguage(info.mime);finishDialog('ok');});list.append(button);
      }
    };
    search.addEventListener('input',render); body.append(search,list);render(); await dialog('Language',body,[{label:'Close',value:null}]);
  }
  function setDocMode(d,mime) { d.mode=mime;d.cm.modeOption=mime;const attached=d.cm.getEditor();if(attached)attached.setOption('mode',mime);if(secondEditor&&splitId===d.id)secondEditor.setOption('mode',mime); }
  function setLanguage(mime) { const d = focusedDocument(); if (!d) return;d.autoLanguage=false;setDocMode(d,mime);updateStatus();schedulePersist(); }
  function enableDetection(){const d=focusedDocument();if(!d)return;d.autoLanguage=true;detectLanguage(d);updateStatus();schedulePersist();toast('Automatic language detection enabled.');}
  function detectLanguage(d){if(!d.autoLanguage||!documents.includes(d))return;const mode=guessMode(d.name,d.cm.getValue());if(mode!==d.mode){setDocMode(d,mode);updateStatus();schedulePersist();}}
  function scheduleDetection(d){clearTimeout(detectTimers.get(d.id));if(d.autoLanguage)detectTimers.set(d.id,setTimeout(()=>{detectTimers.delete(d.id);detectLanguage(d);},450));}

  // Search is performed over the document, including multiline regex matches.
  function searchOptions() { return {regex:$('useRegex').checked,wholeWord:$('wholeWord').checked,caseSensitive:$('matchCase').checked}; }
  function getSearchRegex() {
    try { queryError='';return Core.searchSpec($('findInput').value,searchOptions()); }
    catch(e){queryError='Invalid regular expression';return null;}
  }
  function clearSearchMarks() { for(const mark of searchMarks)mark.clear();searchMarks=[];matches=[];lastSearchKey=''; }
  function updateSearch() {
    if (!editor || $('searchPanel').hidden) return;
    clearSearchMarks(); const regex=getSearchRegex(), text=editor.getValue();
    matches=Core.findMatches(text,regex);lastSearchKey=$('findInput').value+JSON.stringify(searchOptions());
    for(const match of matches.slice(0,1500)) if(match.from!==match.to) searchMarks.push(editor.markText(editor.posFromIndex(match.from),editor.posFromIndex(match.to),{className:'cm-search-hit'}));
    $('matchCount').textContent=queryError || (!$('findInput').value ? '' : matches.length+' match'+(matches.length===1?'':'es')+(matches.length===20000?'+':''));
    return matches;
  }
  function scheduleSearch(){clearTimeout(searchTimer);if(!$('searchPanel').hidden)searchTimer=setTimeout(updateSearch,160);}
  function showSearch(replace=false) {
    const selection=editor.getSelection();$('searchPanel').hidden=false;$('replaceRow').hidden=!replace;
    if(selection&&!selection.includes('\n'))$('findInput').value=selection;
    updateSearch();editor.refresh();setTimeout(()=>{$('findInput').focus();$('findInput').select();},30);
  }
  function closeSearch(){$('searchPanel').hidden=true;clearSearchMarks();editor.refresh();}
  function selectMatch(match){editor.setSelection(editor.posFromIndex(match.from),editor.posFromIndex(match.to));editor.scrollIntoView({from:editor.posFromIndex(match.from),to:editor.posFromIndex(match.to)},50);updateStatus();}
  function findNext(back=false) {
    if(!$('findInput').value){showSearch();return;}
    if($('searchPanel').hidden)$('searchPanel').hidden=false;
    updateSearch();if(!matches.length){toast(queryError||'No matches found.');return;}
    const pos=editor.indexFromPos(editor.getCursor(back?'from':'to'));
    const selected=editor.somethingSelected();
    let match;
    if(back)match=[...matches].reverse().find(m=>m.from<pos)||matches[matches.length-1];
    else match=matches.find(m=>m.from>=pos&&(!selected||m.from!==editor.indexFromPos(editor.getCursor('from'))))||matches[0];
    selectMatch(match);
  }
  function replaceOne(){
    updateSearch();const from=editor.indexFromPos(editor.getCursor('from')),to=editor.indexFromPos(editor.getCursor('to'));
    const match=matches.find(m=>m.from===from&&m.to===to);
    if(!match){findNext();return;}
    editor.replaceSelection(Core.replacement(match,$('replaceInput').value,$('useRegex').checked),'end','+input');findNext();
  }
  async function replaceAll(){
    const regex=getSearchRegex();if(queryError){toast(queryError);return;}if(!regex)return;
    const result=Core.replaceAll(editor.getValue(),regex,$('replaceInput').value,$('useRegex').checked);
    if(!result.count){toast('No matches found.');return;}
    if(result.count>1000){const answer=await message('Replace All','Replace '+result.count+' matches in this document?',[{label:'Cancel',value:false},{label:'Replace All',value:true,className:'primary'}]);if(!answer)return;}
    editor.operation(()=>editor.replaceRange(result.text,{line:0,ch:0},editor.posFromIndex(editor.getValue().length),'+input'));
    updateSearch();toast('Replaced '+result.count+' match'+(result.count===1?'':'es')+'.');
  }
  function gotoLine(number){const line=Math.min(Math.max(1,Number(number)||1),editor.lineCount())-1;editor.setCursor({line,ch:0});editor.scrollIntoView({line,ch:0},70);}

  // Text commands act on the selection or complete current lines.
  function lineRange(cm=activeCM()) {
    let from=cm.getCursor('from'),to=cm.getCursor('to');
    let last=to.line;if(to.ch===0&&last>from.line)last--;
    return {from:{line:from.line,ch:0},to:{line:last,ch:cm.getLine(last).length},first:from.line,last};
  }
  function transformLines(transform,cm=activeCM()){
    const range=lineRange(cm);cm.replaceRange(transform(cm.getRange(range.from,range.to)),range.from,range.to,'+input');
  }
  function transformSelection(transform){const cm=activeCM();if(cm.somethingSelected())cm.replaceSelection(transform(cm.getSelection()),'around','+input');else transformLines(transform,cm);}
  function duplicateLines(cm=activeCM()){
    if(cm.somethingSelected()){const s=cm.getSelection();cm.replaceSelection(s+s,'around','+input');}
    else {const p=cm.getCursor();cm.replaceRange(cm.getLine(p.line)+'\n',{line:p.line,ch:0},null,'+input');cm.setCursor({line:p.line+1,ch:p.ch});}
  }
  function moveLines(direction){
    const cm=activeCM(),range=lineRange(cm);
    if(direction<0&&range.first===0||direction>0&&range.last===cm.lastLine())return;
    const selected=cm.getRange(range.from,range.to),adjacent=direction<0?cm.getLine(range.first-1):cm.getLine(range.last+1);
    const from={line:direction<0?range.first-1:range.first,ch:0},to={line:direction<0?range.last:range.last+1,ch:direction<0?cm.getLine(range.last).length:adjacent.length};
    const cursors=cm.listSelections();
    cm.operation(()=>{cm.replaceRange(direction<0?selected+'\n'+adjacent:adjacent+'\n'+selected,from,to,'+input');cm.setSelections(cursors.map(s=>({anchor:{line:s.anchor.line+direction,ch:s.anchor.ch},head:{line:s.head.line+direction,ch:s.head.ch}})));});
  }
  function bookmarkLines(d){return d.bookmarkHandles.map(h=>d.cm.getLineNumber(h)).filter(n=>n!=null);}
  function setBookmark(d,line,on){
    const handle=d.cm.getLineHandle(line);if(!handle)return;
    d.bookmarkHandles=d.bookmarkHandles.filter(h=>d.cm.getLineNumber(h)!=null&&h!==handle);
    if(on){const marker=textNode('span','','bookmark-marker');d.cm.setGutterMarker(line,'bookmark-gutter',marker);d.bookmarkHandles.push(handle);}
    else d.cm.setGutterMarker(line,'bookmark-gutter',null);
  }
  function toggleBookmark(cm=activeCM(),line=cm.getCursor().line){const d=documents.find(d=>d.cm===cm.getDoc())||current();setBookmark(d,line,!bookmarkLines(d).includes(line));schedulePersist();}
  function jumpBookmark(back){const d=current(),lines=bookmarkLines(d).sort((a,b)=>a-b),line=editor.getCursor().line;if(!lines.length){toast('No bookmarks. Tap the line-number gutter to add one.');return;}gotoLine((back?[...lines].reverse().find(n=>n<line)??lines[lines.length-1]:lines.find(n=>n>line)??lines[0])+1);}

  function showSplit(id=activeId){
    const d=documents.find(d=>d.id===id);if(!d)return;
    closeSplit();splitId=id;$('secondaryPane').hidden=false;$('editorPanes').classList.add('split');
    secondEditor=CodeMirror($('secondEditor'),{...editor.options,value:'',extraKeys:editor.getOption('extraKeys')});
    secondEditor.swapDoc(d.cm.linkedDoc({sharedHist:true}));connectEditor(secondEditor);$('splitTitle').textContent=d.name+' · second view';
    applySettings();setTimeout(()=>{editor.refresh();secondEditor?.refresh();},0);
  }
  function closeSplit(){if(secondEditor){const d=documents.find(d=>d.id===splitId);if(d)d.cm.unlinkDoc(secondEditor.getDoc());$('secondEditor').replaceChildren();secondEditor=null;}focusedEditor=editor;splitId='';$('secondaryPane').hidden=true;$('editorPanes').classList.remove('split');editor?.refresh();}
  async function chooseSplitTab(){
    const body=textNode('div','','choice-list');
    for(const d of documents){const b=textNode('button',d.name);b.addEventListener('click',()=>{showSplit(d.id);finishDialog(true);});body.append(b);}
    await dialog('Open in other view',body,[{label:'Cancel',value:null}]);
  }

  function renderFolderRoot(){
    $('folderTree').replaceChildren();
    if(!settings.folderUri){$('folderTree').append(textNode('p','Choose a local folder to browse files here.','folder-empty'));return;}
    const heading=textNode('div',settings.folderName||'Local folder','folder-root'),children=document.createElement('div');
    $('folderTree').append(heading,children);loadFolder(settings.folderUri,children);
  }
  async function loadFolder(uri,container){
    container.replaceChildren(textNode('p','Loading…','folder-empty'));
    const event=await nativeRequest('listFolder',{uri});container.replaceChildren();if(event.type==='error'){container.append(textNode('p',event.payload.message,'folder-empty'));return;}
    const entries=event.payload.entries||[];
    if(!entries.length)container.append(textNode('p','This folder is empty.','folder-empty'));
    for(const entry of entries){
      const row=textNode('div','','tree-node'),button=textNode('button',(entry.directory?'▸ 📁 ':'▤ ')+entry.name);
      button.title=entry.name;row.append(button);
      if(entry.directory){const nested=textNode('div','','children');nested.hidden=true;row.append(nested);let loaded=false;button.addEventListener('click',()=>{nested.hidden=!nested.hidden;button.textContent=(nested.hidden?'▸ 📁 ':'▾ 📁 ')+entry.name;if(!nested.hidden&&!loaded){loadFolder(entry.uri,nested);loaded=true;}});}
      else button.addEventListener('click',()=>{native('openUri',{uri:entry.uri});if(innerWidth<600){$('sidebar').hidden=true;editor.refresh();}});
      container.append(row);
    }
    if(event.payload.truncated)container.append(textNode('p','Showing the first 1,000 entries.','folder-empty'));
  }
  async function findInFiles(){
    if(!settings.folderUri){await message('Choose a local folder','Use File → Open folder as workspace, then search files in that folder.');return;}
    const body=document.createElement('div'),query=document.createElement('input');query.type='text';query.value=$('findInput').value;query.placeholder='Find in local files';query.setAttribute('aria-label','Find in local files');
    body.append(textNode('p','Search '+(settings.folderName||'the selected local folder')+' and its subfolders.'),query);
    const flags={};for(const [key,label]of[['caseSensitive','Match case'],['wholeWord','Whole word'],['regex','Regular expression']]){const row=textNode('label','','check-row'),input=document.createElement('input');input.type='checkbox';flags[key]=input;row.append(input,document.createTextNode(label));body.append(row);}
    body.append(textNode('p','Search scans up to 500 files / 16 MB and returns up to 200 matching lines. Binary files and files over 1 MB are skipped.'));
    const value=await dialog('Find in Files',body,[{label:'Cancel',value:null},{label:'Find All',className:'primary',value:()=>query.value}]);
    if(!value)return;
    try{Core.searchSpec(value,{regex:flags.regex.checked,wholeWord:flags.wholeWord.checked,caseSensitive:flags.caseSensitive.checked});}catch(e){toast('Invalid regular expression.');return;}
    toast('Searching local files…',30000);
    const event=await nativeRequest('findInFiles',{query:value,regex:flags.regex.checked,wholeWord:flags.wholeWord.checked,caseSensitive:flags.caseSensitive.checked});
    if(event.type==='error')return;
    const p=event.payload;showResults(p.matches,'Find in Files: '+p.matches.length+' matching lines in '+p.files+' scanned files'+(p.skipped?' · '+p.skipped+' skipped':'')+(p.limited?' · search limit reached':''));toast(p.matches.length+' matching lines');
  }
  function showResults(results,title){
    $('resultsPanel').hidden=false;$('resultsTitle').textContent=title;$('resultsList').replaceChildren();
    if(!results.length)$('resultsList').append(textNode('p','No matches found.','folder-empty'));
    for(const result of results){const row=textNode('button','','result-row');row.append(textNode('strong',result.name+':'+result.line),textNode('span',result.snippet));
      row.addEventListener('click',()=>{if(result.id){switchDocument(result.id);gotoLine(result.line);}else native('openUri',{uri:result.uri,line:result.line});});$('resultsList').append(row);}
    editor.refresh();
  }
  function findInTabs(){
    if(!$('findInput').value){showSearch();toast('Enter the text to find, then use Search → Find in all open documents.');return;}
    const regex=getSearchRegex();if(!regex){toast(queryError);return;}const results=[];
    for(const d of documents){const text=d.cm.getValue();for(const m of Core.findMatches(text,regex,200)){const pos=d.cm.posFromIndex(m.from);results.push({id:d.id,name:d.name,line:pos.line+1,snippet:d.cm.getLine(pos.line).slice(0,180)});if(results.length>=500)break;}if(results.length>=500)break;}
    showResults(results,'All open documents: '+results.length+' matches'+(results.length===500?' (limit)':''));
  }

  function stopRecording(){recording=false;$('toolbar').querySelector('[data-action="recordMacro"]')?.classList.remove('enabled');toast('Recorded '+macroSteps.length+' macro steps.');}
  async function playMacro(times=1){
    if(recording)stopRecording();if(!macroSteps.length){toast('Record a macro first.');return;}if(macroSteps.length*times>20000){toast('A macro run is limited to 20,000 steps.');return;}
    replaying=true;
    try{for(let n=0;n<times;n++){for(const step of macroSteps){const cm=activeCM();if(step.type==='edit'){
      const head=cm.indexFromPos(cm.getCursor()),length=cm.getValue().length;const start=Math.max(0,Math.min(length,head+step.from)),end=Math.max(start,Math.min(length,head+step.to));
      cm.replaceRange(step.text,cm.posFromIndex(start),cm.posFromIndex(end),'+input');cm.setCursor(cm.posFromIndex(start+step.text.length));
    }else if(step.type==='cm')cm.execCommand(step.name);else if(step.type==='command')await run(step.action);}
      if(n%10===0)await new Promise(resolve=>setTimeout(resolve,0));}}
    finally{replaying=false;updateStatus();schedulePersist();}
  }

  async function run(action){
    if(!current())return;
    const macroActions=['undo','redo','duplicate','deleteLine','lineUp','lineDown','joinLines','indent','outdent','comment','uppercase','lowercase','trim','tabsToSpaces','sortAsc','sortDesc','unique','selectAll','left','right','up','down','home','end'];
    if(recording&&!replaying&&macroActions.includes(action))macroSteps.push({type:'command',action});
    commandDepth++;
    try{
      const cm=activeCM(),d=focusedDocument();
      if(action.startsWith('encoding:')){d.encoding=action.slice(9);renderTabs();updateStatus();schedulePersist();return;}
      if(action.startsWith('eol:')){d.eol=action.slice(4);renderTabs();updateStatus();schedulePersist();return;}
      if(action.startsWith('language:')){setLanguage(action.slice(9));return;}
      if(action.startsWith('tabSize:')){settings.tabSize=Number(action.slice(8));applySettings();return;}
      switch(action){
        case 'new':addDocument({text:'',name:nextName()});break;
        case 'open':native('open');break;
        case 'folder':native('chooseFolder');break;
        case 'save':await saveDocument();break;
        case 'saveAs':await saveDocument(focusedDocument(),true);break;
        case 'saveAll':for(const document of [...documents])if(dirty(document)||!document.uri){if(!await saveDocument(document))break;}break;
        case 'close':await closeDocument(activeId);break;
        case 'closeAll':for(const document of [...documents]){await closeDocument(document.id);if(documents.includes(document))break;}break;
        case 'rename':{const name=await promptText('Rename tab','Tab name (use Save As to rename the file)',d.name);if(name){d.name=name;detectLanguage(d);renderTabs();schedulePersist();}break;}
        case 'recent':await showRecent();break;
        case 'undo':cm.undo();break;
        case 'redo':cm.redo();break;
        case 'copy':if(cm.somethingSelected()){native('copy',{text:cm.getSelection()});toast('Copied selection');}else toast('Select text to copy.');break;
        case 'cut':if(cm.somethingSelected()){const selection=cm.getSelection();const event=await nativeRequest('copy',{text:selection});if(event.type==='copied'&&cm.getSelection()===selection)cm.replaceSelection('','end','+delete');}else toast('Select text to cut.');break;
        case 'paste':{const event=await nativeRequest('paste',{});if(event.type==='pasted'){cm.replaceSelection(event.payload.text,'end','paste');cm.focus();}break;}
        case 'selectAll':cm.execCommand('selectAll');break;
        case 'duplicate':duplicateLines(cm);break;
        case 'deleteLine':cm.execCommand('deleteLine');break;
        case 'lineUp':moveLines(-1);break;
        case 'lineDown':moveLines(1);break;
        case 'joinLines':{const range=lineRange(cm);if(range.first===range.last&&range.last<cm.lastLine())range.to={line:range.last+1,ch:cm.getLine(range.last+1).length};cm.replaceRange(cm.getRange(range.from,range.to).replace(/\n\s*/g,' '),range.from,range.to,'+input');break;}
        case 'indent':cm.indentSelection('add');break;
        case 'outdent':cm.indentSelection('subtract');break;
        case 'comment':cm.toggleComment();break;
        case 'uppercase':transformSelection(t=>t.toUpperCase());break;
        case 'lowercase':transformSelection(t=>t.toLowerCase());break;
        case 'trim':cm.operation(()=>{for(let n=cm.lastLine();n>=cm.firstLine();n--){const line=cm.getLine(n),trimmed=line.replace(/[\t ]+$/,'');if(trimmed!==line)cm.replaceRange('',{line:n,ch:trimmed.length},{line:n,ch:line.length},'+input');}});break;
        case 'tabsToSpaces':transformLines(text=>text.split('\n').map(line=>{let col=0,out='';for(const ch of line){if(ch==='\t'){const count=settings.tabSize-col%settings.tabSize;out+=' '.repeat(count);col+=count;}else{out+=ch;col++;}}return out;}).join('\n'));break;
        case 'sortAsc':case 'sortDesc':transformLines(t=>Core.sortLines(t,action==='sortDesc',false,false));break;
        case 'unique':transformLines(t=>[...new Set(t.split('\n'))].join('\n'));break;
        case 'find':showSearch(false);break;
        case 'replace':showSearch(true);break;
        case 'findNext':findNext();break;
        case 'findPrev':findNext(true);break;
        case 'findInFiles':await findInFiles();break;
        case 'findInTabs':findInTabs();break;
        case 'goto':{const line=await promptText('Go to line','Line number (1–'+editor.lineCount()+')',String(editor.getCursor().line+1),'number');if(line){gotoLine(line);editor.focus();}break;}
        case 'bookmark':toggleBookmark();break;
        case 'nextBookmark':jumpBookmark(false);break;
        case 'prevBookmark':jumpBookmark(true);break;
        case 'clearBookmarks':for(const line of bookmarkLines(d))setBookmark(d,line,false);schedulePersist();break;
        case 'wrap':case 'lineNumbers':case 'whitespace':case 'activeLine':case 'codingKeys':case 'autoClose':case 'autocomplete':settings[action]=!settings[action];applySettings();break;
        case 'zoomIn':settings.fontSize=Math.min(28,settings.fontSize+1);applySettings();break;
        case 'zoomOut':settings.fontSize=Math.max(10,settings.fontSize-1);applySettings();break;
        case 'zoomReset':settings.fontSize=14;applySettings();break;
        case 'light':settings.dark=false;applySettings();break;
        case 'dark':settings.dark=true;applySettings();break;
        case 'indentTabs':settings.indentWithTabs=true;applySettings();break;
        case 'indentSpaces':settings.indentWithTabs=false;applySettings();break;
        case 'split':showSplit();break;
        case 'splitOther':await chooseSplitTab();break;
        case 'closeSplit':closeSplit();break;
        case 'foldAll':cm.operation(()=>{for(let line=cm.lastLine();line>=cm.firstLine();line--)cm.foldCode({line,ch:0},null,'fold');});break;
        case 'unfoldAll':cm.operation(()=>{for(let line=cm.firstLine();line<=cm.lastLine();line++)cm.foldCode({line,ch:0},null,'unfold');});break;
        case 'fold':cm.foldCode(cm.getCursor());break;
        case 'toggleFolder':$('sidebar').hidden=!$('sidebar').hidden;if(!$('sidebar').hidden)renderFolderRoot();editor.refresh();break;
        case 'language':await chooseLanguage();break;
        case 'autoLanguage':enableDetection();break;
        case 'complete':cm.showHint({hint:CodeMirror.hint.anyword,completeSingle:false});break;
        case 'reloadEncoding':await reloadEncoding();break;
        case 'preferences':await preferences();break;
        case 'recordMacro':if(recording)stopRecording();else{macroSteps=[];recording=true;$('toolbar').querySelector('[data-action="recordMacro"]')?.classList.add('enabled');toast('Recording edits and text commands. Use Macro → Stop Recording when done.');}break;
        case 'stopMacro':stopRecording();break;
        case 'playMacro':await playMacro();break;
        case 'repeatMacro':{const times=await promptText('Run macro','Number of repetitions (1–500)','2','number');if(times)await playMacro(Math.max(1,Math.min(500,Number(times)||1)));break;}
        case 'saveMacro':if(recording)stopRecording();settings.macro=macroSteps;schedulePersist();toast('Macro saved on this device.');break;
        case 'loadMacro':macroSteps=[...settings.macro];toast('Loaded '+macroSteps.length+' macro steps.');break;
        case 'clearMacro':macroSteps=[];settings.macro=[];schedulePersist();toast('Macro cleared.');break;
        case 'about':await about();break;
        case 'privacy':await message('Offline and local',window.AnotePNative?.platform==='desktop'?'AnoteP bundles its editor and language modes. Network requests and remote navigation are blocked. Documents and unsaved-work recovery stay on this computer. Saving to a file is always an explicit action.':'AnoteP has no Internet permission, accounts, analytics, or ads. Its editor and language modes are bundled inside the APK. Files are opened through Android’s file picker. Choose “Internal storage” or an SD card for local files. Unsaved tabs and preferences are recovered from private on-device storage; Android cloud backup is disabled. Saving to a provider is always an explicit action.');break;
        case 'features':await featureList();break;
        case 'shortcuts':await shortcuts();break;
        case 'licenses':native('licenses');break;
        case 'left':cm.execCommand('goCharLeft');break;
        case 'right':cm.execCommand('goCharRight');break;
        case 'up':cm.execCommand('goLineUp');break;
        case 'down':cm.execCommand('goLineDown');break;
        case 'home':cm.execCommand('goLineStart');break;
        case 'end':cm.execCommand('goLineEnd');break;
      }
    }catch(e){toast(e.message||'The editor command failed.',5000);}
    finally{commandDepth--;updateStatus();}
  }

  async function showRecent(){
    const body=textNode('div','','choice-list');
    if(!settings.recent.length)body.append(textNode('p','Files you open or save will appear here.'));
    for(const entry of settings.recent){const button=textNode('button',entry.name);button.addEventListener('click',()=>{finishDialog(true);native('openUri',{uri:entry.uri});});body.append(button);}
    await dialog('Recent files',body,[{label:'Clear list',value:()=>{settings.recent=[];schedulePersist();return true;}},{label:'Close',value:null}]);
  }
  async function reloadEncoding(){
    const d=current();if(!d.uri){toast('Save the document before reloading it.');return;}if(dirty(d)){toast('Save your changes before reloading the file.');return;}
    const body=textNode('div','','choice-list');for(const encoding of ['UTF-8','UTF-8-BOM','UTF-16LE','UTF-16BE','windows-1252','ISO-8859-1','US-ASCII']){const button=textNode('button',encoding);button.addEventListener('click',()=>{finishDialog(true);native('openUri',{uri:d.uri,encoding});});body.append(button);}await dialog('Reload using encoding',body,[{label:'Cancel',value:null}]);
  }
  async function preferences(){
    const body=document.createElement('div'),font=document.createElement('input');font.type='number';font.min=10;font.max=28;font.value=settings.fontSize;
    body.append(textNode('label','Editor font size (10–28 px)','field-label'),font);
    const toggles={};for(const [key,label]of[['wrap','Word wrap'],['lineNumbers','Line numbers'],['codingKeys','Coding key row'],['autoClose','Auto-close brackets and tags'],['autocomplete','Suggest words while typing'],['dark','Dark theme']]){const row=textNode('label','','check-row'),input=document.createElement('input');input.type='checkbox';input.checked=settings[key];toggles[key]=input;row.append(input,document.createTextNode(label));body.append(row);}
    body.append(textNode('p','Changes and unsaved documents are recovered locally. Save writes a file only when you request it.'));
    const result=await dialog('Preferences',body,[{label:'Cancel',value:false},{label:'Apply',value:true,className:'primary'}]);
    if(result){settings.fontSize=Math.max(10,Math.min(28,Number(font.value)||14));for(const key in toggles)settings[key]=toggles[key].checked;applySettings();}
  }
  async function about(){
    const desktop=window.AnotePNative?.platform==='desktop';
    const body=document.createElement('div'),image=document.createElement('img');image.src='icon.svg';image.className='about-logo';image.alt='AnoteP penguin and notepad';
    body.append(image,textNode('div',desktop?'AnoteP Desktop 1.1.0':'AnoteP 1.0','about-name'),textNode('p',desktop?'A local desktop text and source-code editor inspired by the classic Notepad++ workflow.':'A local Android text and source-code editor inspired by the classic Notepad++ workflow.'),
      textNode('p',desktop?'Built for offline editing. Files stay on this computer. No account, ads, or network access.':'Built for offline editing. No account. No Internet permission. No ads.'),
      textNode('p','AnoteP is an independent app, not an official Notepad++ port. Notepad++ plugins, Scintilla, and full Notepad++ feature parity are not included. The editing engine is CodeMirror 5 (MIT license).'));
    await dialog('About AnoteP',body);
  }
  async function featureList(){
    const body=document.createElement('div');for(const paragraph of [
      'Editing: multiple tabs, undo/redo, syntax highlighting, folding, bookmarks, bracket/tag completion, word completion, split views, comments, line transforms, case conversion, sorting, and local macros.',
      'Search: literal and regular expression search, replace and replace all, capture-group replacements ($1…), search across open tabs, and search in a selected local folder.',
      (window.AnotePNative?.platform==='desktop'?'Files: local open/save dialogs and folder browser, UTF-8 / BOM / UTF-16 / Windows-1252 / ISO-8859-1 / ASCII, CRLF / LF / CR, recovery of unsaved tabs, and a warning before overwriting externally changed files.':'Files: Android file picker and folder browser, UTF-8 / BOM / UTF-16 / Windows-1252 / ISO-8859-1 / ASCII, CRLF / LF / CR, recovery of unsaved tabs, and a warning before overwriting externally changed files.'),
      (window.AnotePNative?.platform==='desktop'?'Limits: 8 MB per file, 30 tabs, and 32 MB recovery workspace. Notepad++ plugins, spell checking, code execution, FTP, and full Scintilla compatibility are not included.':'Limits: Android 8+, 8 MB per file, 30 tabs, and 32 MB recovery workspace. Notepad++ plugins, spell checking, code execution, FTP, and full Scintilla compatibility are not included.')
    ])body.append(textNode('p',paragraph));await dialog('Supported features',body);
  }
  async function shortcuts(){const pre=textNode('pre','Ctrl+N        New document\nCtrl+O        Open file\nCtrl+S        Save\nCtrl+Shift+S  Save As\nCtrl+W        Close tab\nCtrl+Tab      Next tab\nCtrl+F        Find\nCtrl+H        Replace\nCtrl+G        Go to line\nF3 / Shift+F3 Next / previous match\nCtrl+Shift+F  Find in local files\nCtrl+D        Duplicate line\nCtrl+J        Join lines\nCtrl+/        Toggle line comment\nAlt+↑ / Alt+↓ Move line up / down\nCtrl+F2       Toggle bookmark\nF2 / Shift+F2 Next / previous bookmark\nCtrl+Space    Word completion\nCtrl++ / −    Zoom\nCtrl+0        Reset zoom\nCtrl+Shift+P  Play macro\nEsc           Close dialog or search');await dialog('Keyboard shortcuts',pre);}
  function showLicenses(text){dialog('Open source licenses',textNode('pre',text));}

  const icons={
    new:'<path d="M5 3h9l5 5v13H5z" fill="#fff" stroke="#668474"/><path d="M14 3v5h5" fill="#d9e9da" stroke="#668474"/><path d="M12 11v7m-3-3.5h6" stroke="#4d912d" stroke-width="2"/>',
    open:'<path d="M3 6h7l2 3h9v11H3z" fill="#f6d78b" stroke="#ad873e"/><path d="M3 11h18l-3 9H2z" fill="#ffe8a1" stroke="#ad873e"/>',
    save:'<path d="M4 3h14l3 3v15H3V3z" fill="#79a9d3" stroke="#4d6f99"/><path d="M7 3h10v7H7zM6 14h12v7H6z" fill="#f8f8f8" stroke="#4d6f99"/><path d="M14 4v4" stroke="#4d6f99" stroke-width="2"/>',
    saveAll:'<path d="M7 3h13v15H7z" fill="#b7cce4" stroke="#4d6f99"/><path d="M3 7h13l3 3v12H3z" fill="#79a9d3" stroke="#4d6f99"/><path d="M6 7h8v6H6zM6 17h10v5H6z" fill="#fff" stroke="#4d6f99"/>',
    undo:'<path d="M9 5 3 11l6 5v-4h6q6 0 5 7 5-10-5-10H9z" fill="#75ac5c" stroke="#4e803b"/>',
    redo:'<g transform="translate(24 0) scale(-1 1)"><path d="M9 5 3 11l6 5v-4h6q6 0 5 7 5-10-5-10H9z" fill="#75ac5c" stroke="#4e803b"/></g>',
    cut:'<circle cx="6" cy="17" r="3" fill="#fff" stroke="#5d80aa" stroke-width="2"/><circle cx="17" cy="17" r="3" fill="#fff" stroke="#5d80aa" stroke-width="2"/><path d="m7 14 11-12M15 14 4 2" stroke="#64737a" stroke-width="2"/>',
    copy:'<path d="M8 3h12v15H8z" fill="#fdfdfd" stroke="#5f85ad"/><path d="M3 7h12v15H3z" fill="#fdfdfd" stroke="#5f85ad"/><path d="M6 11h6m-6 4h6m-6 4h6" stroke="#86a1bf"/>',
    paste:'<path d="M5 5h14v17H5z" fill="#e4be77" stroke="#a8813e"/><path d="M8 3h8v4H8z" fill="#ddd" stroke="#7b8285"/><path d="M8 10h13v12H8z" fill="#fff" stroke="#6e8da7"/><path d="M11 14h7m-7 4h7" stroke="#8ba5b9"/>',
    find:'<circle cx="10" cy="10" r="6" fill="#d9edf5" stroke="#547a9b" stroke-width="2"/><path d="m15 15 6 6" stroke="#547a9b" stroke-width="3"/>',
    replace:'<path d="M3 7h15m-4-4 4 4-4 4M21 17H6m4-4-4 4 4 4" fill="none" stroke="#648fb2" stroke-width="2"/><path d="M4 3v6m-2-3h4M20 14v6m-2-3h4" stroke="#64a044"/>',
    wrap:'<path d="M3 5h18M3 10h14q5 0 5 4t-5 4h-5m3-3-3 3 3 3M3 15h5M3 20h5" fill="none" stroke="#5987ab" stroke-width="1.7"/>',
    whitespace:'<path d="M14 4H8q-6 0-6 5t6 5h2M10 4v17m5-17v17m-7 0h9" fill="none" stroke="#526e8b" stroke-width="2"/>',
    bookmark:'<path d="M6 3h12v19l-6-5-6 5z" fill="#7aa9d2" stroke="#466d9e"/>',
    recordMacro:'<circle cx="12" cy="12" r="7" fill="#d16155" stroke="#a84439"/>',
    playMacro:'<path d="m6 3 15 9-15 9z" fill="#7cb057" stroke="#4a7d2f"/>',
    split:'<path d="M3 4h18v16H3z" fill="#fff" stroke="#658aa8"/><path d="M12 4v16" stroke="#658aa8" stroke-width="2"/><path d="M5 7h5m-5 4h5m-5 4h5m4-8h5m-5 4h5m-5 4h5" stroke="#9cb2bd"/>'
  };
  function shortcutAction(key,mods) {
    if(mods.ctrl){
      const actions={s:mods.shift?'saveAs':'save',a:'selectAll',c:'copy',v:'paste',x:'cut',z:mods.shift?'redo':'undo',y:'redo',f:mods.shift?'findInFiles':'find',h:'replace',n:'new',o:'open',w:'close',d:'duplicate',g:'goto',j:'joinLines','/':'comment',' ':'complete'};
      return actions[key]||'';
    }
    if(mods.alt&&key==='ArrowUp')return 'lineUp';if(mods.alt&&key==='ArrowDown')return 'lineDown';return '';
  }
  function renderModifiers(){for(const key of ['shift','ctrl','alt']){const button=$('keybar').querySelector('[data-modifier="'+key+'"]');if(button){button.classList.toggle('latched',modifiers[key]);button.setAttribute('aria-pressed',String(modifiers[key]));}}}
  function clearModifiers(){modifiers.shift=false;modifiers.ctrl=false;modifiers.alt=false;renderModifiers();}
  function keyboardKey(key){
    const cm=activeCM();
    if(['left','right','up','down','home','end'].includes(key)){
      if(modifiers.alt&&(key==='up'||key==='down')){run(key==='up'?'lineUp':'lineDown');clearModifiers();return;}
      const moves={left:modifiers.ctrl?'goGroupLeft':'goCharLeft',right:modifiers.ctrl?'goGroupRight':'goCharRight',up:'goLineUp',down:'goLineDown',home:modifiers.ctrl?'goDocStart':'goLineStart',end:modifiers.ctrl?'goDocEnd':'goLineEnd'};
      cm.setExtending(modifiers.shift);cm.execCommand(moves[key]);cm.setExtending(false);updateStatus();cm.focus();return;
    }
    if(key==='tab'){
      if(modifiers.shift)cm.indentSelection('subtract');else if(cm.somethingSelected())cm.indentSelection('add');else cm.replaceSelection(settings.indentWithTabs?'\t':' '.repeat(settings.tabSize),'end','+input');
      cm.focus();return;
    }
    if(modifiers.ctrl||modifiers.alt){const action=shortcutAction(key.toLowerCase(),modifiers);clearModifiers();if(action)run(action);else toast('No shortcut assigned to that key.');return;}
    const value=modifiers.shift?key.toUpperCase():key;clearModifiers();cm.replaceSelection(value,'end','+input');cm.focus();
  }
  function buildToolbar(){
    const tools=[['new','New'],['open','Open'],['save','Save'],['saveAll','Save All'],null,['cut','Cut'],['copy','Copy'],['paste','Paste'],null,['undo','Undo'],['redo','Redo'],null,['find','Find'],['replace','Replace'],null,['wrap','Word wrap'],['whitespace','Show whitespace'],['bookmark','Toggle bookmark'],null,['split','Clone to other view'],['recordMacro','Record macro'],['playMacro','Play macro']];
    for(const tool of tools){if(!tool){$('toolbar').append(textNode('span','','tool-divider'));continue;}const button=document.createElement('button');button.title=tool[1];button.setAttribute('aria-label',tool[1]);button.dataset.action=tool[0];button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[tool[0]]+'</svg>';button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>run(tool[0]));$('toolbar').append(button);}
    const modifiersGroup=textNode('div','','modifier-keys');
    for(const [key,label]of[['shift','Shift'],['ctrl','Ctrl'],['alt','Alt']]){const button=textNode('button',label);button.dataset.modifier=key;button.title=label+' modifier (tap to toggle)';button.setAttribute('aria-pressed','false');button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>{modifiers[key]=!modifiers[key];renderModifiers();});modifiersGroup.append(button);}
    const addKey=(parent,label,key)=>{const button=textNode('button',label);button.dataset.key=key;button.title=label;button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>keyboardKey(key));parent.append(button);return button;};
    addKey(modifiersGroup,'Home','home');addKey(modifiersGroup,'End','end');addKey(modifiersGroup,'Tab','tab');$('keybar').append(modifiersGroup);
    const arrows=textNode('div','','arrow-keys');arrows.setAttribute('role','group');arrows.setAttribute('aria-label','Arrow keys');
    for(const [key,rotation]of[['up',0],['left',-90],['down',180],['right',90]]){const button=addKey(arrows,key,key);button.setAttribute('aria-label','Arrow '+key);button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate('+rotation+'deg)"><path d="M12 20V4M5 11l7-7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';}
    $('keybar').append(arrows);
    const shortcuts=textNode('div','','shortcut-keys');for(const key of ['S','A','C','V','X','Z','Y','F'])addKey(shortcuts,key,key);$('keybar').append(shortcuts);
    const symbols=textNode('div','','symbol-keys');for(const key of ['{','}','(',')','[',']','<','>',';','"',"'",'/','=',':','_','\\'])addKey(symbols,key,key);$('keybar').append(symbols);
  }

  function bindEvents(){
    $('menubar').addEventListener('mousedown',e=>e.preventDefault());
    $('menubar').addEventListener('click',e=>{const button=e.target.closest('[data-menu]');if(button)openMenu(button.dataset.menu,button);});
    document.addEventListener('pointerdown',e=>{if(!$('menuPopover').contains(e.target)&&!$('menubar').contains(e.target))closeMenu();});
    $('newTab').addEventListener('click',()=>run('new'));$('offlineBadge').addEventListener('click',()=>run('privacy'));
    $('eolStatus').addEventListener('click',()=>openMenu('Encoding',$('eolStatus')));$('encodingStatus').addEventListener('click',()=>openMenu('Encoding',$('encodingStatus')));$('languageStatus').addEventListener('click',chooseLanguage);
    $('dialogClose').addEventListener('click',()=>finishDialog(null));$('dialogBackdrop').addEventListener('click',e=>{if(e.target===$('dialogBackdrop'))finishDialog(null);});
    $('findInput').addEventListener('input',scheduleSearch);$('findInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findNext(e.shiftKey);}});
    for(const id of ['matchCase','wholeWord','useRegex'])$(id).addEventListener('change',updateSearch);
    $('findNext').addEventListener('click',()=>findNext());$('findPrev').addEventListener('click',()=>findNext(true));$('replaceOne').addEventListener('click',replaceOne);$('replaceAll').addEventListener('click',replaceAll);$('closeSearch').addEventListener('click',closeSearch);
    $('replaceInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();replaceOne();}});
    $('closeSplit').addEventListener('click',closeSplit);$('chooseFolder').addEventListener('click',()=>native('chooseFolder'));
    $('closeFolder').addEventListener('click',()=>{$('sidebar').hidden=true;editor.refresh();});$('closeResults').addEventListener('click',()=>{$('resultsPanel').hidden=true;editor.refresh();});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){if(handleBack()){e.preventDefault();e.stopPropagation();}return;}
      if(!$('dialogBackdrop').hidden)return;
      const control=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();let action='';
      if(control&&e.key==='Tab'){const index=documents.findIndex(d=>d.id===activeId);switchDocument(documents[(index+(e.shiftKey?-1:1)+documents.length)%documents.length].id);e.preventDefault();return;}
      if(control){
        const shortcuts={n:'new',o:'open',s:e.shiftKey?'saveAs':e.altKey?'saveAll':'save',w:'close',f:e.shiftKey?'findInFiles':'find',h:'replace',g:'goto',d:'duplicate',j:'joinLines',u:e.shiftKey?'uppercase':'lowercase',p:e.shiftKey?'playMacro':'',l:e.shiftKey?'deleteLine':'', '+':'zoomIn','=':'zoomIn','-':'zoomOut','0':'zoomReset'};
        action=shortcuts[k]||'';if(e.key==='F2')action='bookmark';
      }else if(e.key==='F3')action=e.shiftKey?'findPrev':'findNext';else if(e.key==='F2')action=e.shiftKey?'prevBookmark':'nextBookmark';else if(e.altKey&&e.key==='ArrowUp')action='lineUp';else if(e.altKey&&e.key==='ArrowDown')action='lineDown';else if(e.altKey&&k==='0')action='fold';
      if(action){e.preventDefault();e.stopPropagation();run(action);}
    },true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)flushSession();});window.addEventListener('pagehide',flushSession);
    const resize=()=>{editor.refresh();secondEditor?.refresh();requestAnimationFrame(positionMenu);};
    window.addEventListener('resize',resize);
    window.visualViewport?.addEventListener('resize',()=>requestAnimationFrame(positionMenu));
  }
  function handleBack(){
    if(!$('dialogBackdrop').hidden){finishDialog(null);return true;}
    if(menuName){closeMenu();return true;}
    if(!$('searchPanel').hidden){closeSearch();return true;}
    if(!$('resultsPanel').hidden){$('resultsPanel').hidden=true;editor.refresh();return true;}
    if(!$('sidebar').hidden){$('sidebar').hidden=true;editor.refresh();return true;}
    return false;
  }

  buildToolbar();buildEditors();bindEvents();
  window.App={nativeEvent,flushSession,handleBack,run,captureWorkspace};
  if (window.AnotePNative?.platform === 'desktop') {
    window.AnotePNative.onEvent(nativeEvent);
    window.addEventListener('beforeunload', event => {
      if (restored && !window.AnotePNative.flushWorkspace(JSON.stringify(captureWorkspace()))) {
        event.preventDefault(); event.returnValue = false;
        toast('Recovery could not be saved. Save your tabs before closing.', 10000);
      }
    });
  }
  native('ready');
})();

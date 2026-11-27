/* Injected only into AnoteP's local, top-level editor by the GTK host. */
(() => {
  'use strict';
  const listeners = [];
  const post = raw => window.webkit.messageHandlers.anotep.postMessage(raw);
  Object.defineProperty(window, 'AnotePNative', {value: Object.freeze({
    platform: 'desktop', version: '1.3.0',
    dispatch: post,
    // GTK's delete-event separately waits for captureWorkspace() and a durable
    // disk write before destroying the window. This handles pagehide as well.
    flushWorkspace: raw => { post(JSON.stringify({type: 'persist', payload: JSON.parse(raw)})); return true; },
    onEvent: callback => {
      if (typeof callback !== 'function') throw new TypeError('An event callback is required.');
      listeners.push(callback);
      return () => { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); };
    },
  })});
  Object.defineProperty(window, '__anotepReceive', {value: event => {
    for (const callback of listeners.slice()) callback(event);
  }});
  Object.defineProperty(window, '__anotepSearch', {value: (batch, payload, requestId) => {
    try {
      if (typeof payload.query !== 'string' || !payload.query || payload.query.length > 1000)
        throw new Error('Enter a search up to 1,000 characters.');
      let expression = payload.regex ? payload.query : payload.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (payload.wholeWord) expression = '\\b(?:' + expression + ')\\b';
      const pattern = new RegExp(expression, payload.caseSensitive ? 'u' : 'iu');
      const matches = [];
      scan: for (const file of batch.candidates) {
        const lines = file.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = pattern.exec(lines[i]);
          if (!match) continue;
          const start = Math.max(0, match.index - 50);
          matches.push({uri: file.uri, name: file.name, line: i + 1, snippet: lines[i].slice(start, start + 180)});
          if (matches.length >= 200) { batch.limited = true; break scan; }
        }
      }
      window.__anotepReceive({type: 'findResults', requestId,
        payload: {matches, files: batch.files, skipped: batch.skipped, limited: batch.limited}});
    } catch (error) {
      window.__anotepReceive({type: 'error', requestId, payload: {message: error.message}});
    }
  }});
  window.close = () => post(JSON.stringify({type: 'close'}));
})();

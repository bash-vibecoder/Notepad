'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('AnotePNative', Object.freeze({
  platform: 'desktop',
  dispatch: raw => ipcRenderer.send('anotep:dispatch', raw),
  flushWorkspace: raw => ipcRenderer.sendSync('anotep:flush', raw),
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('An event callback is required.');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('anotep:event', listener);
    return () => ipcRenderer.removeListener('anotep:event', listener);
  },
}));

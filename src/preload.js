'use strict';
// Sandboxed preload cannot require local files, so this list is checked against src/api.js by test/api.test.js.
const { contextBridge, ipcRenderer } = require('electron');

const METHODS = [
  'getSettings', 'setSettings', 'getDrives', 'addRoot', 'removeRoot', 'getRoots', 'scan', 'startQueue',
  'getEntries', 'applyFix', 'getCandidates', 'pickCandidate', 'posterPath',
];

const api = Object.fromEntries(METHODS.map((m) => [m, (...args) => ipcRenderer.invoke(`api:${m}`, ...args)]));
api.pickFolder = () => ipcRenderer.invoke('dialog:folder');
api.onProgress = (cb) => {
  ipcRenderer.removeAllListeners('api:progress');
  ipcRenderer.on('api:progress', (_e, p) => cb(p));
};

contextBridge.exposeInMainWorld('api', api);

'use strict';
// Sandboxed preload cannot require local files, so this list is checked against src/api.js by test/api.test.js.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const METHODS = [
  'getSettings', 'setSettings', 'getDrives', 'addRoot', 'removeRoot', 'getRoots', 'scan', 'startQueue',
  'getEntries', 'applyFix', 'getCandidates', 'pickCandidate', 'posterPath',
  'getEpisodes', 'translate', 'openLocation', 'openImdb', 'openCollection', 'checkUpdate', 'downloadUpdate', 'installUpdate', 'getEntry', 'getSimilar', 'getRecommendations', 'openMal', 'addTag', 'removeTag', 'addAlias', 'removeAlias', 'getTags', 'addTags', 'removeTags', 'addDropped', 'startPretranslate', 'stopPretranslate', 'planTransfer', 'startTransfer', 'cancelTransfer', 'getCopyLists', 'saveCopyLists', 'getCopies', 'verifyCopy', 'repairCopy', 'removeCopy', 'getVersion', 'calendarList', 'calendarAdd', 'calendarUpdate', 'calendarTick', 'calendarSkip', 'calendarRemove', 'getAiring',
];

const api = Object.fromEntries(METHODS.map((m) => [m, (...args) => ipcRenderer.invoke(`api:${m}`, ...args)]));
api.pickFolder = () => ipcRenderer.invoke('dialog:folder');
// the path of a file or folder dropped on the window
api.pathOf = (file) => webUtils.getPathForFile(file);
api.onProgress = (cb) => {
  ipcRenderer.removeAllListeners('api:progress');
  ipcRenderer.on('api:progress', (_e, p) => cb(p));
};

contextBridge.exposeInMainWorld('api', api);

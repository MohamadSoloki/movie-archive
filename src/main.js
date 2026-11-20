'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { openDb } = require('./core/db.js');
const { createApi } = require('./api.js');
const { checkForUpdates, createUpdater } = require('./updater.js');

protocol.registerSchemesAsPrivileged([
  { scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const api = createApi({
    db: openDb(path.join(userData, 'archive.db')), userDataDir: userData,
    openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u),
    updater: createUpdater({ isPackaged: app.isPackaged }),
  });

  // poster://x/<file>: serves only files inside <userData>/posters (api.posterPath keeps the base name)
  protocol.handle('poster', (req) => {
    const file = api.posterPath(decodeURIComponent(new URL(req.url).pathname));
    return fs.existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('', { status: 404 });
  });

  for (const name of Object.keys(api)) {
    if (name === 'startQueue') {
      ipcMain.handle('api:startQueue', (e) => api.startQueue((p) => e.sender.send('api:progress', p)));
    } else {
      ipcMain.handle(`api:${name}`, (_e, ...args) => api[name](...args));
    }
  }
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  const win = new BrowserWindow({
    width: 1280, height: 800,
    // spellcheck off: it would load a dictionary into memory for a window with one search box
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  checkForUpdates({ isPackaged: app.isPackaged });
});

app.on('window-all-closed', () => app.quit());

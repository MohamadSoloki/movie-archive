'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { openDb } = require('./core/db.js');
const { createApi } = require('./api.js');

protocol.registerSchemesAsPrivileged([
  { scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const api = createApi({ db: openDb(path.join(userData, 'archive.db')), userDataDir: userData });

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});

app.on('window-all-closed', () => app.quit());

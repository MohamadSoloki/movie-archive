'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { openDb } = require('./core/db.js');
const { createApi } = require('./api.js');
const { createUpdater } = require('./updater.js');

protocol.registerSchemesAsPrivileged([
  { scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// The portable launcher extracts the application to a temporary directory.
const portableDir = app.isPackaged && process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR;
const portableDataDir = portableDir && path.join(portableDir, 'Movie Archive Data');
if (portableDataDir) {
  try {
    fs.mkdirSync(portableDataDir, { recursive: true });
    app.setPath('userData', portableDataDir);
    app.setPath('sessionData', portableDataDir);
  } catch (error) {
    dialog.showErrorBox('Movie Archive', `Cannot open the portable data folder:\n${portableDataDir}\n\n${error.message}`);
    app.exit(1);
  }
}

// A second launch must not open a second window: it quits at once and the first window comes forward.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  if (!primary) return;
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const api = createApi({
    db: openDb(path.join(userData, 'archive.db')), userDataDir: userData,
    openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u),
    updater: createUpdater({ isPackaged: app.isPackaged && !portableDir }), version: require('../package.json').version,
  });

  api.initCatalog().catch(() => {}); // the phone catalog comes back when it was left on

  // poster://x/<file>: serves only files inside <userData>/posters (api.posterPath keeps the base name)
  protocol.handle('poster', (req) => {
    const file = api.posterPath(decodeURIComponent(new URL(req.url).pathname));
    return fs.existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('', { status: 404 });
  });

  for (const name of Object.keys(api)) {
    if (name === 'startQueue' || name === 'startTransfer' || name === 'startPretranslate' || name === 'verifyCopy' || name === 'repairCopy' || name === 'downloadUpdate') {
      // long runs: progress goes back on api:progress, the callback is always the last argument
      ipcMain.handle(`api:${name}`, (e, ...args) => api[name](...args, (p) => e.sender.send('api:progress', p)));
    } else {
      ipcMain.handle(`api:${name}`, (_e, ...args) => api[name](...args));
    }
  }
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // file pickers for backups; the renderer only gets the chosen path back
  const asFilters = (f) => (Array.isArray(f) ? f.filter((x) => x && typeof x.name === 'string' && Array.isArray(x.extensions)) : []);
  ipcMain.handle('dialog:save', async (_e, name, filters) => {
    const r = await dialog.showSaveDialog({ defaultPath: typeof name === 'string' ? name : undefined, filters: asFilters(filters) });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:open', async (_e, filters) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: asFilters(filters) });
    return r.canceled ? null : r.filePaths[0];
  });

  const win = new BrowserWindow({
    width: 1280, height: 800,
    // spellcheck off: it would load a dictionary into memory for a window with one search box
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  ipcMain.handle('report:save-delivery-pdf', async (event) => {
    if (event.sender !== win.webContents || event.senderFrame?.parent !== null) return { status: 'error' };
    try {
      const data = await win.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true, printBackground: true });
      const stamp = new Intl.DateTimeFormat('sv-SE').format(new Date());
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), `Delivery History - ${stamp}.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { status: 'cancelled' };
      await fs.promises.writeFile(filePath, data);
      return { status: 'saved' };
    } catch {
      return { status: 'error' };
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});

app.on('window-all-closed', () => app.quit());

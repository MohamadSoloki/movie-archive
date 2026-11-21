'use strict';

// Self-update from GitHub Releases (see build.publish in package.json). Only the packaged app updates itself;
// `npm start` from source never does. Three steps, each its own call so the page can show them:
// check() finds a newer release, download() fetches it with progress, install() restarts into it.
function createUpdater({ isPackaged, getUpdater = () => require('electron-updater').autoUpdater }) {
  let busy = false;
  return {
    async check() {
      if (!isPackaged) return { state: 'dev' };
      try {
        const u = getUpdater();
        u.autoDownload = false; // the person decides with the Update button
        const r = await u.checkForUpdates();
        return r && r.isUpdateAvailable ? { state: 'available', version: r.updateInfo.version } : { state: 'latest' };
      } catch {
        return { state: 'error' };
      }
    },
    // onProgress({ type: 'update', percent })
    async download(onProgress) {
      if (!isPackaged) return { state: 'dev' };
      if (busy) return { state: 'busy' };
      busy = true;
      const u = getUpdater();
      const onP = (p) => onProgress({ type: 'update', percent: Math.round(p.percent) });
      u.on('download-progress', onP);
      try {
        await u.downloadUpdate();
        return { state: 'ready' };
      } catch (e) {
        return { state: 'error', message: e?.message || String(e) };
      } finally {
        u.removeListener('download-progress', onP);
        busy = false;
      }
    },
    // silent install, then the app starts again by itself
    install() {
      if (isPackaged) getUpdater().quitAndInstall(true, true);
    },
  };
}

module.exports = { createUpdater };

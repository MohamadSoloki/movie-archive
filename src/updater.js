'use strict';

// Checks GitHub Releases (see build.publish in package.json) and installs a found update when the app quits.
// Only the packaged app updates itself; `npm start` from source never does.
function checkForUpdates({ isPackaged, getUpdater = () => require('electron-updater').autoUpdater }) {
  if (!isPackaged) return;
  // offline, or no release published yet: stay silent
  getUpdater().checkForUpdatesAndNotify().catch(() => {});
}

// The update button: check, download a found update, then install on request.
function createUpdater({ isPackaged, getUpdater = () => require('electron-updater').autoUpdater }) {
  return {
    async check() {
      if (!isPackaged) return { state: 'dev' };
      try {
        const u = getUpdater();
        const r = await u.checkForUpdates();
        if (!r || !r.isUpdateAvailable) return { state: 'latest' };
        await (r.downloadPromise ?? u.downloadUpdate());
        return { state: 'ready', version: r.updateInfo.version };
      } catch {
        return { state: 'error' };
      }
    },
    install() {
      if (isPackaged) getUpdater().quitAndInstall();
    },
  };
}

module.exports = { checkForUpdates, createUpdater };

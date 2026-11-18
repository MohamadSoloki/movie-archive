'use strict';

// Checks GitHub Releases (see build.publish in package.json) and installs a found update when the app quits.
// Only the packaged app updates itself; `npm start` from source never does.
function checkForUpdates({ isPackaged, getUpdater = () => require('electron-updater').autoUpdater }) {
  if (!isPackaged) return;
  // offline, or no release published yet: stay silent
  getUpdater().checkForUpdatesAndNotify().catch(() => {});
}

module.exports = { checkForUpdates };

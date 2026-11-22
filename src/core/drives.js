'use strict';
const { execFile } = require('node:child_process');

const CMD = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,VolumeSerialNumber | ConvertTo-Json';

function defaultRun() {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', CMD], { windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function listDrives(run = defaultRun) {
  const out = (await run()).trim();
  if (!out) return [];
  // PowerShell prints a bare object, not an array, when there is a single drive
  return [].concat(JSON.parse(out))
    .filter((d) => d.VolumeSerialNumber)
    .map((d) => ({ serial: d.VolumeSerialNumber, label: d.VolumeName || '', root: `${d.DeviceID}\\` }));
}

function refreshDrives(db, drives) {
  const up = db.prepare(`INSERT INTO drives(serial, label, root, online) VALUES(?, ?, ?, 1)
    ON CONFLICT(serial) DO UPDATE SET label = excluded.label, root = excluded.root, online = 1`);
  db.exec('BEGIN');
  try {
    db.exec('UPDATE drives SET online = 0');
    for (const d of drives) up.run(d.serial, d.label, d.root);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const slash = (s) => s.replace(/\\/g, '/');

function toDriveRel(drives, absPath) {
  let abs = slash(absPath);
  if (!abs.endsWith('/')) abs += '/';
  const hits = drives
    .map((d) => ({ d, root: slash(d.root).replace(/\/?$/, '/') }))
    .filter((x) => abs.toLowerCase().startsWith(x.root.toLowerCase()))
    .sort((a, b) => b.root.length - a.root.length);
  if (!hits.length) return null;
  const rel = abs.slice(hits[0].root.length).replace(/^\/+|\/+$/g, '');
  return { serial: hits[0].d.serial, relPath: rel };
}

const REMOVABLE_CMD = 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json';

function psRun(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// Flash drives and other removable disks that are plugged in, with their size and free space. [] when they cannot be listed.
async function listRemovable(run = () => psRun(REMOVABLE_CMD)) {
  try {
    const out = String(await run()).trim();
    if (!out) return [];
    return [].concat(JSON.parse(out)).filter((d) => /^[A-Za-z]:$/.test(d.DeviceID || ''))
      .map((d) => ({ root: `${d.DeviceID.toUpperCase()}\\`, label: d.VolumeName || '', size: Number(d.Size) || 0, free: Number(d.FreeSpace) || 0 }));
  } catch {
    return [];
  }
}

const isDriveRoot = (s) => typeof s === 'string' && /^[A-Za-z]:\\?$/.test(s);

// "Safely remove": the Explorer eject verb, for one drive letter that passed isDriveRoot, so nothing from outside reaches the command.
async function ejectDrive(root, run = psRun) {
  if (!isDriveRoot(root)) return { ok: false, error: 'bad_drive' };
  const letter = `${root[0].toUpperCase()}:`;
  try {
    await run(`(New-Object -comObject Shell.Application).Namespace(17).ParseName('${letter}').InvokeVerb('Eject')`);
    return { ok: true };
  } catch {
    return { ok: false, error: 'eject_failed' };
  }
}

module.exports = { listDrives, refreshDrives, toDriveRel, listRemovable, ejectDrive, isDriveRoot };

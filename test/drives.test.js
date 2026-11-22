'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { listDrives, refreshDrives, toDriveRel } = require('../src/core/drives.js');

const one = '{"DeviceID":"E:","VolumeName":"Films1","VolumeSerialNumber":"A1B2C3D4"}';

test('listDrives accepts the single-object output PowerShell prints for one drive', async () => {
  assert.deepEqual(await listDrives(async () => one), [{ serial: 'A1B2C3D4', label: 'Films1', root: 'E:\\' }]);
});

test('listDrives accepts an array and skips drives without a serial', async () => {
  const out = '[{"DeviceID":"C:","VolumeName":"","VolumeSerialNumber":null},' +
    '{"DeviceID":"F:","VolumeName":"Anime","VolumeSerialNumber":"FFFF0001"}]';
  const drives = await listDrives(async () => out);
  assert.deepEqual(drives.map((d) => d.serial), ['FFFF0001']);
});

test('listDrives returns [] for empty output', async () => {
  assert.deepEqual(await listDrives(async () => ''), []);
});

test('refreshDrives marks absent drives offline and updates root for the same serial', () => {
  const db = openDb();
  refreshDrives(db, [{ serial: 'S1', label: 'A', root: 'E:\\' }, { serial: 'S2', label: 'B', root: 'F:\\' }]);
  refreshDrives(db, [{ serial: 'S1', label: 'A', root: 'G:\\' }]);
  const rows = db.prepare('SELECT serial, root, online FROM drives ORDER BY serial').all();
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { serial: 'S1', root: 'G:\\', online: 1 });
  assert.equal(rows[1].online, 0);
});

test('toDriveRel splits an absolute path into serial and forward-slash relative path', () => {
  const drives = [{ serial: 'S', label: '', root: 'E:\\' }];
  assert.deepEqual(toDriveRel(drives, 'e:\\Movies\\Action'), { serial: 'S', relPath: 'Movies/Action' });
  assert.deepEqual(toDriveRel(drives, 'E:\\'), { serial: 'S', relPath: '' });
  assert.equal(toDriveRel(drives, 'F:\\x'), null);
});

const { listRemovable, ejectDrive, isDriveRoot } = require('../src/core/drives.js');

test('listRemovable reads flash drives with size and free space', async () => {
  const out = '[{"DeviceID":"F:","VolumeName":"FLASH","Size":16000000000,"FreeSpace":9000000000},{"DeviceID":"G:","VolumeName":null,"Size":0,"FreeSpace":null}]';
  assert.deepEqual(await listRemovable(async () => out), [
    { root: 'F:\\', label: 'FLASH', size: 16000000000, free: 9000000000 },
    { root: 'G:\\', label: '', size: 0, free: 0 },
  ]);
  assert.deepEqual(await listRemovable(async () => ''), []);
  assert.deepEqual(await listRemovable(async () => { throw new Error('no powershell'); }), []);
});

test('isDriveRoot accepts only a drive letter root', () => {
  assert.equal(isDriveRoot('F:\\'), true);
  assert.equal(isDriveRoot('f:'), true);
  for (const bad of ['F:\\x', '..', 'F:\; calc', '', 'FF:', null]) assert.equal(isDriveRoot(bad), false);
});

test('ejectDrive runs one fixed PowerShell command for a valid letter and refuses anything else', async () => {
  const seen = [];
  assert.deepEqual(await ejectDrive('f:\\', async (cmd) => { seen.push(cmd); return ''; }), { ok: true });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Namespace\(17\)\.ParseName\('F:'\)/);
  assert.deepEqual(await ejectDrive('F:\; calc', async () => assert.fail('must not run')), { ok: false, error: 'bad_drive' });
  assert.deepEqual(await ejectDrive('F:\\', async () => { throw new Error('x'); }), { ok: false, error: 'eject_failed' });
});

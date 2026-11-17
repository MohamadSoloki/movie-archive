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

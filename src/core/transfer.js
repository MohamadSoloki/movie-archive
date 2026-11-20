'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

// Copy-only transfer of films out of the archive. Sources are only read; the destination is always outside every archive folder.

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/;

// a folder name the owner typed: trimmed, no path characters, not "." or "..", no trailing dot (Windows drops it)
function cleanName(name) {
  const n = String(name ?? '').trim();
  if (!n || n === '.' || n === '..' || UNSAFE.test(n) || /[. ]$/.test(n) || n.length > 100) return null;
  return n;
}

// shortcut: lower-cased compare also for case-sensitive file systems; the app targets Windows, where paths ignore case
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// One usable copy of a movie, or one copy of every season of a series. A copy on the destination drive is the last choice:
// reading and writing the same disk is slower than going from one disk to another.
function pickLocations(locations, destDrive) {
  const usable = locations.filter((l) => l.online && !l.missing && !l.isEmpty);
  if (!usable.length) {
    const reason = locations.some((l) => !l.missing && !l.isEmpty) ? 'offline' : locations.every((l) => l.missing) ? 'missing' : 'empty';
    return { picks: [], reason };
  }
  const groups = new Map();
  for (const l of usable) {
    const k = l.season == null ? 'x' : String(l.season);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const picks = [...groups.values()].map((g) => g.find((l) => l.driveSerial !== destDrive) || g[0]);
  return { picks };
}

function treeSize(p) {
  const st = fs.lstatSync(p);
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let n = 0;
  for (const d of fs.readdirSync(p)) n += treeSize(path.join(p, d));
  return n;
}

async function copyFile(src, dst, st, { onBytes, signal }) {
  const out = fs.createWriteStream(dst, { flags: 'wx' });
  const input = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 });
  input.on('data', (c) => onBytes?.(c.length));
  try {
    await pipeline(input, out, signal ? { signal } : {});
  } catch (e) {
    fs.rmSync(dst, { force: true }); // only the partial file this copy created in the destination
    throw e;
  }
  fs.utimesSync(dst, st.atime, st.mtime);
}

// Copies a file or folder tree to dst. Never overwrites: a file already in dst is skipped. Symlinks are not followed.
async function copyTree(src, dst, opts = {}) {
  const r = { copied: 0, skipped: 0, bytes: 0, cancelled: false };
  const walk = async (from, to) => {
    const st = fs.lstatSync(from);
    if (st.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const d of fs.readdirSync(from)) await walk(path.join(from, d), path.join(to, d));
    } else if (st.isFile()) {
      if (fs.existsSync(to)) { r.skipped += 1; return; }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      await copyFile(from, to, st, opts);
      r.copied += 1;
      r.bytes += st.size;
    }
  };
  try {
    await walk(src, dst);
  } catch (e) {
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') r.cancelled = true;
    else throw e;
  }
  return r;
}

module.exports = { cleanName, isInside, pickLocations, treeSize, copyTree };

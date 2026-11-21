'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

// SHA-256 of a file, streamed. `onBytes` sees every chunk so a long check can show progress.
async function hashFile(file, { onBytes, signal } = {}) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024, signal });
  for await (const chunk of input) {
    hash.update(chunk);
    onBytes?.(chunk.length);
  }
  return hash.digest('hex');
}

// Checks copied files against what was recorded when they were copied: [{dest, size, sha}].
// Quick: the file exists and has the recorded size. Deep: also re-reads it and compares the SHA-256
// (a file with no recorded hash is checked by size only). Read-only.
async function verifyFiles(files, { deep = false, signal, onFile, onBytes } = {}) {
  const problems = [];
  for (const [i, f] of files.entries()) {
    if (signal?.aborted) return { problems, cancelled: true };
    onFile?.(i, files.length, f);
    let st;
    try { st = fs.statSync(f.dest); } catch { problems.push({ dest: f.dest, reason: 'missing' }); continue; }
    if (!st.isFile()) { problems.push({ dest: f.dest, reason: 'missing' }); continue; }
    if (st.size !== f.size) { problems.push({ dest: f.dest, reason: 'size' }); continue; }
    if (deep && f.sha) {
      try {
        if (await hashFile(f.dest, { onBytes, signal }) !== f.sha) problems.push({ dest: f.dest, reason: 'hash' });
      } catch (e) {
        if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return { problems, cancelled: true };
        problems.push({ dest: f.dest, reason: 'unreadable' });
      }
    }
  }
  return { problems, cancelled: false };
}

module.exports = { hashFile, verifyFiles };

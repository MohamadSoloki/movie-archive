'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Returns the saved file name, or null on any failure: a missing poster never fails a match.
async function savePoster(url, dir, key, fetch = globalThis.fetch) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    await fs.promises.mkdir(dir, { recursive: true });
    const file = `${key}.jpg`;
    await fs.promises.writeFile(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

module.exports = { savePoster };

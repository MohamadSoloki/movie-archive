'use strict';

const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

async function preparePortableData() {
  const sourceDir = process.argv[2] || path.join(process.env.APPDATA, 'movie-archive');
  const outputDir = path.resolve(__dirname, '..', 'dist', 'portable');
  const destination = path.join(outputDir, 'Movie Archive Data');

  await fs.mkdir(outputDir, { recursive: true });
  if (existsSync(destination)) {
    throw new Error(`The portable data folder already exists and was kept: ${destination}`);
  }

  const staging = await fs.mkdtemp(path.join(outputDir, '.data-'));
  try {
    const db = new DatabaseSync(path.join(sourceDir, 'archive.db'), { readOnly: true });
    try {
      await backup(db, path.join(staging, 'archive.db'));
    } finally {
      db.close();
    }

    const posters = path.join(sourceDir, 'posters');
    if (existsSync(posters)) await fs.cp(posters, path.join(staging, 'posters'), { recursive: true });

    await fs.rename(staging, destination);
    console.log(`Portable database and any saved posters are ready in "${destination}".`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

preparePortableData().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

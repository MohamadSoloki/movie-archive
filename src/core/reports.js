'use strict';

// Films and series whose every present folder is on one drive: lose that drive and the title is gone. Grouped by drive.
function singleDrive(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.kind === 'collection') continue;
    const present = e.locations.filter((l) => !l.missing);
    const serials = new Set(present.map((l) => l.driveSerial));
    if (serials.size !== 1) continue;
    const l = present[0];
    if (!groups.has(l.driveSerial)) groups.set(l.driveSerial, { driveSerial: l.driveSerial, driveLabel: l.driveLabel, online: l.online, items: [] });
    groups.get(l.driveSerial).items.push({ key: e.key, title: e.title, year: e.year, kind: e.kind });
  }
  const byName = (a, b) => a.localeCompare(b);
  return [...groups.values()].sort((a, b) => byName(a.driveLabel, b.driveLabel))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => byName(a.title, b.title)) }));
}

module.exports = { singleDrive };

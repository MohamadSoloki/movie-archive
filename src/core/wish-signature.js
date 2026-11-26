'use strict';

// Shared with the embedded catalog page. Only customer-editable values identify a change.
function wishSignature({ name, phone, note, items }) {
  const field = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const numbers = (list) => [...new Set(list || [])].sort((a, b) => a - b);
  const choices = items.map(({ key, sel }) => {
    const seasons = numbers(sel?.seasons);
    const episodes = Object.entries(sel?.episodes || {})
      .filter(([season, list]) => !seasons.includes(Number(season)) && list.length)
      .map(([season, list]) => [Number(season), numbers(list)])
      .sort(([a], [b]) => a - b);
    return [key, seasons, episodes];
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return JSON.stringify([field(name, 80), field(phone, 30), field(note, 200), choices]);
}

module.exports = { wishSignature };

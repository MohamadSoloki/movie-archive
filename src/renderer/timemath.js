'use strict';
// The arithmetic behind the air-time clock (app.js draws it): a 24-hour dial with two rings, minutes, and typing by arrow keys.
// Angles are degrees clockwise from the top (12 o'clock).
(function (root) {
  const norm = (a) => ((a % 360) + 360) % 360;
  const pad = (n) => String(n).padStart(2, '0');

  // "20:05" (already checked by timepicker.parseTime) -> { h: 20, m: 5 }
  const split = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return { h, m }; };

  const formatTime = (h, m) => `${pad(h)}:${pad(m)}`;

  // Outer ring: 12 on top, then 1..11. Inner ring: 00 on top, then 13..23.
  function hourFromDial(angle, inner) {
    const idx = Math.round(norm(angle) / 30) % 12;
    return inner ? (idx === 0 ? 0 : 12 + idx) : (idx === 0 ? 12 : idx);
  }

  function dialFromHour(h) {
    const inner = h === 0 || h > 12;
    const idx = inner ? (h === 0 ? 0 : h - 12) : (h === 12 ? 0 : h);
    return { angle: idx * 30, inner };
  }

  const minuteFromDial = (angle, step = 1) => (Math.round(norm(angle) / 6 / step) * step) % 60;
  const dialFromMinute = (m) => m * 6;

  function pointToDial(dx, dy) {
    const angle = norm((Math.atan2(dx, -dy) * 180) / Math.PI);
    return { angle: Math.round(angle * 1e6) / 1e6, dist: Math.hypot(dx, dy) };
  }

  // The middle of the face is the inner ring, the rim is the outer ring.
  const isInner = (dist, radius) => dist < radius * 0.64;

  // One arrow-key step on one part; hours wrap around midnight, minutes wrap without touching the hour
  function nudge({ h, m }, part, delta) {
    return part === 'h' ? { h: (((h + delta) % 24) + 24) % 24, m } : { h, m: (((m + delta) % 60) + 60) % 60 };
  }

  const api = { split, formatTime, hourFromDial, dialFromHour, minuteFromDial, dialFromMinute, pointToDial, isInner, nudge };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.timeMath = api;
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';
// Typing and arrow keys for the air-time field (app.js draws the field and the dial; the dial arithmetic is in timemath.js).
(function (root) {
  const DIGITS = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9, '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };
  const two = (n) => String(n).padStart(2, '0');
  const DEFAULT = '20:00';

  // What a person types -> "HH:MM", or null. "20:30", "8:5", "8", "2030", "830", "20.30", Persian digits.
  function parseTime(typed) {
    if (typeof typed !== 'string') return null;
    const s = typed.trim().replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]);
    let m = /^(\d{1,2})[:.](\d{1,2})$/.exec(s);
    let h, min;
    if (m) { h = Number(m[1]); min = Number(m[2]); }
    else if ((m = /^(\d{1,2})$/.exec(s))) { h = Number(m[1]); min = 0; }
    else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) { h = Number(m[1]); min = Number(m[2]); }
    else return null;
    return h <= 23 && min <= 59 ? `${two(h)}:${two(min)}` : null;
  }

  // Moves a time by minutes and wraps around midnight both ways; a broken value starts from 20:00.
  function stepTime(value, minutes) {
    const [h, m] = (parseTime(value) || DEFAULT).split(':').map(Number);
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
  }

  const api = { parseTime, stepTime, DEFAULT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.timePicker = api;
})(typeof window !== 'undefined' ? window : globalThis);

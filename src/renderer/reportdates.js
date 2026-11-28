'use strict';

(function (root) {
  const DAY = 86_400_000;
  const persian = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  });

  // Search the Persian calendar that Intl uses for the report headings as well.
  function persianToLocalDate(year, month, day) {
    const target = year * 10000 + month * 100 + day;
    let lo = Math.floor(Date.UTC(year + 621, 2, 15) / DAY);
    let hi = lo + 380;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const utc = new Date(mid * DAY);
      const parts = Object.fromEntries(persian.formatToParts(utc).map(({ type, value }) => [type, Number(value)]));
      const date = parts.year * 10000 + parts.month * 100 + parts.day;
      if (date === target) return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
      if (date < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  function parseDate(text, language) {
    const value = text.trim().replace(/[۰-۹٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)));
    if (!value) return undefined;
    const match = /^([1-9][0-9]{3})[/-]([0-9]{1,2})[/-]([0-9]{1,2})$/.exec(value);
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (language === 'fa') return persianToLocalDate(year, month, day);
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  const api = { parseDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.reportDates = api;
})(typeof window !== 'undefined' ? window : globalThis);

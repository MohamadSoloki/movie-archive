'use strict';

const DIGITS = { '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9,
  '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };

// One spelling for what people type differently: Arabic ي/ك, Persian and Arabic digits, آ/أ/إ, ة/ۀ, half-space,
// diacritics, tatweel, letter case. Used for searching only; nothing stored is changed.
function normalizeFa(text) {
  return String(text ?? '').toLowerCase()
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[آأإ]/g, 'ا').replace(/[ةۀ]/g, 'ه')
    .replace(/[‌‍ـً-ٰٟ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

module.exports = { normalizeFa };

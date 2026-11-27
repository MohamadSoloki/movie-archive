'use strict';
const { randomInt } = require('node:crypto');

const DEFAULT_ROTATION_MINUTES = 60;
const MAX_ROTATION_MINUTES = 24 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_TRACKED_ADDRESSES = 4096;

function rotationMinutes(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_ROTATION_MINUTES ? n : DEFAULT_ROTATION_MINUTES;
}

function createCatalogCode({ readSettings, clock = Date.now }) {
  let active = null;
  const failed = new Map();

  function current() {
    const settings = readSettings();
    if (!settings.enabled) {
      active = null;
      failed.clear();
      return { enabled: false };
    }
    const now = clock();
    const minutes = rotationMinutes(settings.minutes);
    if (!active || active.minutes !== minutes || active.expiresAt <= now) {
      const previous = active?.code;
      const draw = randomInt(previous === undefined ? 101 : 100);
      const code = previous !== undefined && draw >= previous ? draw + 1 : draw;
      active = { code, minutes, expiresAt: now + minutes * 60_000 };
      failed.clear();
    }
    return { enabled: true, code: active.code, expiresAt: active.expiresAt };
  }

  function check(code, address) {
    const expected = current();
    if (!expected.enabled) return null;
    if (code == null) return 'shop_code_required';
    if (!Number.isInteger(code) || code < 0 || code > 100) return 'shop_code_invalid';
    const attempts = failed.get(address) ?? 0;
    if (attempts >= MAX_FAILED_ATTEMPTS || (!attempts && failed.size >= MAX_TRACKED_ADDRESSES)) return 'shop_code_locked';
    if (code === expected.code) return null;
    failed.set(address, attempts + 1);
    return 'shop_code_invalid';
  }

  return { current, check };
}

module.exports = { createCatalogCode, rotationMinutes, DEFAULT_ROTATION_MINUTES };

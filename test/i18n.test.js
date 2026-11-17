'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STRINGS, t } = require('../src/renderer/i18n.js');

test('fa and en define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.fa).sort(), Object.keys(STRINGS.en).sort());
});

test('every key has the same {placeholders} in both languages', () => {
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(STRINGS.en)) assert.equal(vars(STRINGS.fa[k]), vars(STRINGS.en[k]), k);
});

test('no empty strings', () => {
  for (const lang of ['fa', 'en']) for (const [k, v] of Object.entries(STRINGS[lang])) assert.ok(v.trim().length > 0, `${lang}.${k}`);
});

test('the fix button is named Online Info Fix in English', () => {
  assert.equal(t('en', 'online_info_fix'), 'Online Info Fix');
  assert.ok(t('fa', 'online_info_fix').length > 0);
});

test('placeholders are filled and unknown keys return the key', () => {
  assert.equal(t('en', 'scan_done', { n: 4 }).includes('4'), true);
  assert.equal(t('en', 'missing_key_xyz'), 'missing_key_xyz');
});

test('every data-i18n key used in index.html exists', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="(\w+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 5);
  for (const k of keys) assert.ok(k in STRINGS.en, k);
});

test('every t() key used in app.js exists', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const keys = [...js.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 10);
  for (const k of keys) assert.ok(k in STRINGS.en, k);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFa } = require('../src/core/persian.js');

test('arabic letters and digits become persian-keyboard ones', () => {
  assert.equal(normalizeFa('علي'), 'علی');
  assert.equal(normalizeFa('كتاب'), 'کتاب');
  assert.equal(normalizeFa('۲۰۲۲'), '2022');
  assert.equal(normalizeFa('٢٠٢٢'), '2022');
});

test('half-space, diacritics, tatweel and letter case do not matter', () => {
  assert.equal(normalizeFa('دوبله‌ی  فارسی'), 'دوبلهی فارسی');
  assert.equal(normalizeFa('جَنگ'), 'جنگ');
  assert.equal(normalizeFa('بتمـــن'), 'بتمن');
  assert.equal(normalizeFa('The BATMAN'), 'the batman');
});

test('alef and he variants fold together', () => {
  assert.equal(normalizeFa('آواتار'), normalizeFa('اواتار'));
  assert.equal(normalizeFa('خانۀ'), normalizeFa('خانه'));
  assert.equal(normalizeFa(null), '');
});

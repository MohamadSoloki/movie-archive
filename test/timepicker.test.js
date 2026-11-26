'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, stepTime } = require('../src/renderer/timepicker.js');

test('parseTime reads the ways a person types a 24-hour time', () => {
  for (const [typed, want] of [['20:30', '20:30'], ['8:5', '08:05'], ['8', '08:00'], ['20', '20:00'], ['2030', '20:30'], ['830', '08:30'], ['20.30', '20:30'], ['  9:15 ', '09:15'], ['00:00', '00:00'], ['23:59', '23:59']]) {
    assert.equal(parseTime(typed), want, typed);
  }
});

test('parseTime accepts Persian and Arabic-Indic digits', () => {
  assert.equal(parseTime('۲۰:۳۰'), '20:30');
  assert.equal(parseTime('٢١٤٥'), '21:45');
});

test('parseTime refuses what is not a time', () => {
  for (const typed of ['', '  ', 'abc', '24:00', '12:60', '25', '1:2:3', '12:345', '-1:00', null, undefined]) {
    assert.equal(parseTime(typed), null, String(typed));
  }
});

test('stepTime moves by minutes and wraps around midnight both ways', () => {
  assert.equal(stepTime('20:00', 5), '20:05');
  assert.equal(stepTime('20:58', 5), '21:03');
  assert.equal(stepTime('23:55', 10), '00:05');
  assert.equal(stepTime('00:05', -10), '23:55');
  assert.equal(stepTime('20:30', 60), '21:30');
  assert.equal(stepTime('20:30', -1440), '20:30');
});

test('stepTime on a broken value starts from 20:00', () => {
  assert.equal(stepTime('', 5), '20:05');
});

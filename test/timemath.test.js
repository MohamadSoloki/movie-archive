'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tm = require('../src/renderer/timemath.js');

test('split turns HH:MM into hour and minute numbers', () => {
  assert.deepEqual(tm.split('20:05'), { h: 20, m: 5 });
  assert.deepEqual(tm.split('00:00'), { h: 0, m: 0 });
});

test('formatTime is always HH:MM, the shape the calendar core checks', () => {
  assert.equal(tm.formatTime(7, 5), '07:05');
  assert.equal(tm.formatTime(0, 0), '00:00');
  assert.equal(tm.formatTime(23, 59), '23:59');
});

test('the 24-hour dial: outer ring 12 at the top then 1..11, inner ring 00 at the top then 13..23', () => {
  assert.deepEqual(tm.dialFromHour(12), { angle: 0, inner: false });
  assert.deepEqual(tm.dialFromHour(3), { angle: 90, inner: false });
  assert.deepEqual(tm.dialFromHour(0), { angle: 0, inner: true });
  assert.deepEqual(tm.dialFromHour(18), { angle: 180, inner: true });
  for (let hh = 0; hh < 24; hh++) {
    const { angle, inner } = tm.dialFromHour(hh);
    assert.equal(tm.hourFromDial(angle, inner), hh, `hour ${hh}`);
  }
});

test('hourFromDial snaps to the nearest hour mark and wraps at the top', () => {
  assert.equal(tm.hourFromDial(14, false), 12);
  assert.equal(tm.hourFromDial(16, false), 1);
  assert.equal(tm.hourFromDial(359, false), 12);
  assert.equal(tm.hourFromDial(359, true), 0);
});

test('minutes: 6 degrees each, snapped, 60 wraps to 0', () => {
  assert.equal(tm.minuteFromDial(0), 0);
  assert.equal(tm.minuteFromDial(90), 15);
  assert.equal(tm.minuteFromDial(359), 0);
  assert.equal(tm.minuteFromDial(92), 15);
  assert.equal(tm.minuteFromDial(90, 5), 15);
  assert.equal(tm.minuteFromDial(100, 5), 15);
  assert.equal(tm.minuteFromDial(104, 5), 15);
  assert.equal(tm.minuteFromDial(106, 5), 20);
  assert.equal(tm.dialFromMinute(45), 270);
});

test('pointToDial gives the clockwise angle from the top and the distance', () => {
  assert.deepEqual(tm.pointToDial(0, -10), { angle: 0, dist: 10 });
  assert.deepEqual(tm.pointToDial(10, 0), { angle: 90, dist: 10 });
  assert.deepEqual(tm.pointToDial(0, 10), { angle: 180, dist: 10 });
  assert.deepEqual(tm.pointToDial(-10, 0), { angle: 270, dist: 10 });
});

test('isInner: the inner ring is the middle of the face, the outer ring its rim', () => {
  assert.equal(tm.isInner(30, 100), true);
  assert.equal(tm.isInner(85, 100), false);
});

test('nudge moves one part and wraps: hours around midnight, minutes without carrying into the hour', () => {
  assert.deepEqual(tm.nudge({ h: 23, m: 30 }, 'h', 1), { h: 0, m: 30 });
  assert.deepEqual(tm.nudge({ h: 0, m: 30 }, 'h', -1), { h: 23, m: 30 });
  assert.deepEqual(tm.nudge({ h: 20, m: 58 }, 'm', 5), { h: 20, m: 3 });
  assert.deepEqual(tm.nudge({ h: 20, m: 2 }, 'm', -5), { h: 20, m: 57 });
});

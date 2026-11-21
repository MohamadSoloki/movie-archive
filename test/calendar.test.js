'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { createCalendar, nextAir, isEnded } = require('../src/core/calendar.js');

// 2026-11-23 is a Monday (getDay() === 1); all times are local
const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();
const MON = 1;

test('nextAir gives the first matching weekday and time that is not in the past', () => {
  assert.equal(nextAir(MON, '20:00', at(21, 12, 26)), at(23, 20, 0)); // Saturday -> Monday
  assert.equal(nextAir(MON, '20:00', at(23, 19, 59)), at(23, 20, 0)); // same day, still ahead
  assert.equal(nextAir(MON, '20:00', at(23, 20, 0)), at(23, 20, 0)); // exactly on time counts
  assert.equal(nextAir(MON, '20:00', at(23, 20, 1)), at(30, 20, 0)); // just missed -> next week
});

test('isEnded reads the OMDb year range: an open range is still airing', () => {
  assert.equal(isEnded('2019–2022'), true);
  assert.equal(isEnded('2019-2022'), true);
  assert.equal(isEnded('2019–'), false);
  assert.equal(isEnded('2019'), false);
  assert.equal(isEnded(null), false);
});

test('add stores a reminder whose first due time is the next matching slot', () => {
  const cal = createCalendar(openDb());
  const r = cal.add({ title: 'بامداد خمار', weekday: MON, time: '20:00', episode: 7 }, at(21, 12));
  assert.equal(r.ok, true);
  const [x] = cal.list(at(21, 12));
  assert.deepEqual([x.title, x.episode, x.due, x.state], ['بامداد خمار', 7, at(23, 20), 'soon']);
});

test('add refuses bad input with a reason', () => {
  const cal = createCalendar(openDb());
  const bad = (o) => cal.add({ title: 'X', weekday: MON, time: '20:00', ...o }, at(21)).error;
  assert.equal(bad({ title: '  ' }), 'bad_title');
  assert.equal(bad({ weekday: 7 }), 'bad_day');
  assert.equal(bad({ time: '25:00' }), 'bad_time');
  assert.equal(bad({ time: '8pm' }), 'bad_time');
  assert.equal(bad({ episode: 0 }), 'bad_episode');
  assert.equal(bad({ episode: 1.5 }), 'bad_episode');
  assert.equal(cal.list(at(21)).length, 0);
});

test('state is today before the time, out from the time on', () => {
  const cal = createCalendar(openDb());
  cal.add({ title: 'X', weekday: MON, time: '20:00' }, at(21));
  assert.equal(cal.list(at(23, 9))[0].state, 'today');
  assert.equal(cal.list(at(23, 20, 0))[0].state, 'out');
  assert.equal(cal.list(at(24, 9))[0].state, 'out'); // still not ticked a day later
});

test('tick moves to next week and the next episode without a new reminder', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00', episode: 7 }, at(21));
  assert.deepEqual(cal.tick(id, at(23, 21)), { ok: true });
  const [x] = cal.list(at(23, 21));
  assert.deepEqual([x.episode, x.due, x.state], [8, at(30, 20), 'soon']);
});

test('tick two weeks late leaves the next episode already out', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00', episode: 7 }, at(21));
  cal.tick(id, at(30, 21));
  const [x] = cal.list(at(30, 21));
  assert.deepEqual([x.episode, x.state], [8, 'out']);
});

test('tick before the episode is out is refused', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00', episode: 7 }, at(21));
  assert.deepEqual(cal.tick(id, at(22)), { ok: false, error: 'not_out' });
  assert.equal(cal.list(at(22))[0].episode, 7);
});

test('a reminder without an episode number keeps none', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00' }, at(21));
  cal.tick(id, at(23, 21));
  assert.equal(cal.list(at(23, 21))[0].episode, null);
});

test('skip moves a week ahead and keeps the episode number', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00', episode: 7 }, at(21));
  cal.skip(id);
  const [x] = cal.list(at(21));
  assert.deepEqual([x.episode, x.due], [7, at(30, 20)]);
});

test('update changes title and episode in place; a new day or time recomputes the slot from now', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00', episode: 7 }, at(21));
  cal.update(id, { title: 'Y', episode: 3 }, at(22));
  let [x] = cal.list(at(22));
  assert.deepEqual([x.title, x.episode, x.due], ['Y', 3, at(23, 20)]);
  cal.update(id, { weekday: 3, time: '22:30' }, at(22)); // Wednesday
  [x] = cal.list(at(22));
  assert.equal(x.due, at(25, 22, 30));
});

test('update refuses bad input and unknown ids', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00' }, at(21));
  assert.equal(cal.update(id, { time: '99:99' }, at(21)).error, 'bad_time');
  assert.equal(cal.update(id, { title: '' }, at(21)).error, 'bad_title');
  assert.equal(cal.update(999, { title: 'Z' }, at(21)).error, 'unknown');
  assert.equal(cal.list(at(21))[0].title, 'X');
});

test('a paused reminder is never today or out; resuming schedules from now', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00' }, at(21));
  cal.update(id, { enabled: false }, at(22));
  assert.equal(cal.list(at(24))[0].state, 'paused');
  cal.update(id, { enabled: true }, at(24));
  assert.deepEqual([cal.list(at(24))[0].state, cal.list(at(24))[0].due], ['soon', at(30, 20)]);
});

test('remove deletes it', () => {
  const cal = createCalendar(openDb());
  const { id } = cal.add({ title: 'X', weekday: MON, time: '20:00' }, at(21));
  cal.remove(id);
  assert.equal(cal.list(at(21)).length, 0);
});

test('a series key can have only one reminder, and forKey finds it', () => {
  const cal = createCalendar(openDb());
  const a = cal.add({ title: 'X', weekday: MON, time: '20:00', key: 't:5' }, at(21));
  assert.equal(cal.add({ title: 'X', weekday: 2, time: '21:00', key: 't:5' }, at(21)).error, 'exists');
  assert.equal(cal.forKey('t:5').id, a.id);
  assert.equal(cal.forKey('t:6'), null);
});

test('list is ordered by due time, out first', () => {
  const cal = createCalendar(openDb());
  cal.add({ title: 'late', weekday: 5, time: '20:00' }, at(21));
  cal.add({ title: 'early', weekday: MON, time: '20:00' }, at(21));
  assert.deepEqual(cal.list(at(21)).map((r) => r.title), ['early', 'late']);
});

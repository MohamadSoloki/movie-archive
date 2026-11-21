'use strict';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// First moment at or after `from` that falls on `weekday` (0 = Sunday, as Date.getDay) at `time` (HH:MM), local clock.
function nextAir(weekday, time, from) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  while (d.getDay() !== weekday || d.getTime() < from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// One week later on the same local clock time (setDate keeps the hour across clock changes)
function weekLater(ms) {
  const d = new Date(ms);
  d.setDate(d.getDate() + 7);
  return d.getTime();
}

// OMDb writes a running series as "2019–" and a finished one as "2019–2022"
function isEnded(year) {
  return /[–-]\s*\d{4}\s*$/.test(String(year ?? ''));
}

function check({ title, weekday, time, episode }) {
  if (title !== undefined && !String(title).trim()) return 'bad_title';
  if (weekday !== undefined && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) return 'bad_day';
  if (time !== undefined && !TIME.test(time)) return 'bad_time';
  if (episode != null && !(Number.isInteger(episode) && episode >= 1)) return 'bad_episode';
  return null;
}

function createCalendar(db) {
  const row = (id) => db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const view = (r, now) => ({
    id: r.id, title: r.title, key: r.key, weekday: r.weekday, time: r.time, episode: r.episode, due: r.due,
    enabled: !!r.enabled,
    state: !r.enabled ? 'paused' : r.due <= now ? 'out' : sameDay(r.due, now) ? 'today' : 'soon',
  });

  return {
    add(data, now) {
      const bad = check({ ...data, title: data.title ?? '' });
      if (bad) return { ok: false, error: bad };
      if (data.key && db.prepare('SELECT 1 FROM reminders WHERE key = ?').get(data.key)) return { ok: false, error: 'exists' };
      const id = Number(db.prepare('INSERT INTO reminders(title, key, weekday, time, episode, due) VALUES(?,?,?,?,?,?)')
        .run(String(data.title).trim(), data.key ?? null, data.weekday, data.time, data.episode ?? null, nextAir(data.weekday, data.time, now)).lastInsertRowid);
      return { ok: true, id };
    },
    list(now) {
      return db.prepare('SELECT * FROM reminders ORDER BY enabled DESC, due, id').all().map((r) => view(r, now));
    },
    forKey(key) {
      const r = db.prepare('SELECT * FROM reminders WHERE key = ?').get(key);
      return r ? view(r, Date.now()) : null;
    },
    // The episode is downloaded: next week's slot and the next episode number, with nothing for the owner to create.
    tick(id, now) {
      const r = row(id);
      if (!r) return { ok: false, error: 'unknown' };
      if (!r.enabled || r.due > now) return { ok: false, error: 'not_out' };
      db.prepare('UPDATE reminders SET due = ?, episode = ? WHERE id = ?').run(weekLater(r.due), r.episode == null ? null : r.episode + 1, id);
      return { ok: true };
    },
    // No episode this week: move a week ahead and keep the number.
    skip(id) {
      const r = row(id);
      if (!r) return { ok: false, error: 'unknown' };
      db.prepare('UPDATE reminders SET due = ? WHERE id = ?').run(weekLater(r.due), id);
      return { ok: true };
    },
    update(id, patch, now) {
      const r = row(id);
      if (!r) return { ok: false, error: 'unknown' };
      const bad = check(patch);
      if (bad) return { ok: false, error: bad };
      const n = {
        title: patch.title !== undefined ? String(patch.title).trim() : r.title,
        weekday: patch.weekday ?? r.weekday,
        time: patch.time ?? r.time,
        episode: patch.episode !== undefined ? patch.episode : r.episode,
        enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : r.enabled,
      };
      // a changed day, time or a resume means a fresh slot from now; anything else keeps the slot
      const reslot = n.weekday !== r.weekday || n.time !== r.time || (n.enabled && !r.enabled);
      db.prepare('UPDATE reminders SET title=?, weekday=?, time=?, episode=?, enabled=?, due=? WHERE id=?')
        .run(n.title, n.weekday, n.time, n.episode, n.enabled, reslot ? nextAir(n.weekday, n.time, now) : r.due, id);
      return { ok: true };
    },
    remove(id) {
      db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    },
  };
}

module.exports = { createCalendar, nextAir, isEnded };

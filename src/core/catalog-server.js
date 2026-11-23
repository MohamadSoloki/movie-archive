'use strict';
const http = require('node:http');
const { pageHtml } = require('./catalog-page.js');

const MAX_BODY = 16 * 1024;
const MAX_ITEMS = 200;
const RATE = { windowMs: 10 * 60 * 1000, wish: 5, ask: 20 };
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The phone catalog: a small read-only web server for the shop's local network. Customers browse the film list on their
 * phone and send back the list they want. No file path, drive or folder name ever leaves it; sent lists only reach `submit`.
 */
function createCatalogServer({ films, posterFile, known, submit, ask, info = () => ({ prices: {}, shop: '' }), seasons = () => null, font = () => null, clock = Date.now }) {
  let server = null;
  const sent = new Map(); // address -> times of its recent lists

  // `what` is 'wish' or 'ask': each has its own allowance per address
  const limited = (ip, what) => {
    const now = clock();
    const id = `${what}:${ip}`;
    const recent = (sent.get(id) ?? []).filter((x) => now - x < RATE.windowMs);
    if (recent.length >= RATE[what]) { sent.set(id, recent); return true; }
    sent.set(id, [...recent, now]);
    return false;
  };
  // the customer's page is always Persian; the shop's own language setting does not reach it
  const langOf = () => 'fa';

  const reply = (res, status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const json = (res, status, obj) => reply(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));

  function readBody(req, res, done) {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { over = true; return; }
      chunks.push(c);
    });
    req.on('end', () => (over ? json(res, 413, { ok: false, error: 'too_big' }) : done(Buffer.concat(chunks).toString('utf8'))));
  }

  // what the customer chose of a series: { seasons: [1, 2], episodes: { 3: [1, 2, 5] } }, numbers only; null when nothing usable is left
  const nums = (a, max) => [...new Set((Array.isArray(a) ? a : []).filter((n) => Number.isInteger(n) && n > 0 && n < 10000))].slice(0, max);
  function cleanSel(p) {
    const episodes = {};
    for (const [s, list] of Object.entries(p?.episodes && typeof p.episodes === 'object' ? p.episodes : {}).slice(0, 200)) {
      if (/^\d{1,4}$/.test(s) && nums(list, 1000).length) episodes[Number(s)] = nums(list, 1000);
    }
    const sel = { seasons: nums(p?.seasons, 200), episodes };
    return sel.seasons.length || Object.keys(episodes).length ? sel : null;
  }

  function onWish(req, res) {
    readBody(req, res, async (text) => {
      let b;
      try { b = JSON.parse(text); } catch { json(res, 400, { ok: false, error: 'bad_json' }); return; }
      const name = clean(b?.name, 80);
      const keys = Array.isArray(b?.keys) ? b.keys.filter((k) => typeof k === 'string') : [];
      if (!name || !keys.length || keys.length > MAX_ITEMS) { json(res, 400, { ok: false, error: 'bad_list' }); return; }
      const picks = b.picks && typeof b.picks === 'object' ? b.picks : {};
      const items = await Promise.all([...new Set(keys)].map((k) => known(k)).filter(Boolean).map(async (e) => {
        const sel = (await seasons(e.key))?.length ? cleanSel(picks[e.key]) : null; // a choice only makes sense for a film that has seasons
        return { key: e.key, title: e.title, year: e.year ?? null, ...(sel ? { sel } : {}) };
      }));
      if (!items.length) { json(res, 400, { ok: false, error: 'bad_list' }); return; }
      if (limited(req.socket.remoteAddress, 'wish')) { json(res, 429, { ok: false, error: 'slow_down' }); return; }
      const id = submit({ name, phone: clean(b.phone, 30), note: clean(b.note, 200), items });
      if (!id) json(res, 503, { ok: false, error: 'full' });
      else json(res, 200, { ok: true, id });
    });
  }

  // a film the archive lacks: the answer lists what the archive already has under that name
  function onAsk(req, res) {
    readBody(req, res, (text) => {
      let b;
      try { b = JSON.parse(text); } catch { json(res, 400, { ok: false, error: 'bad_json' }); return; }
      const name = clean(b?.name, 101);
      if (!name || name.length > 100) { json(res, 400, { ok: false, error: 'bad_name' }); return; }
      if (limited(req.socket.remoteAddress, 'ask')) { json(res, 429, { ok: false, error: 'slow_down' }); return; }
      const r = ask(name);
      if (!r?.ok) json(res, 400, { ok: false, error: 'bad_name' });
      else json(res, 200, { ok: true, inArchive: r.inArchive });
    });
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const routes = ['/', '/api/films', '/api/info', '/api/seasons', '/api/wish', '/api/ask', '/font.woff2'];
    const poster = path.startsWith('/poster/');
    if (!routes.includes(path) && !poster) { json(res, 404, { ok: false }); return; }
    if (path === '/api/wish' || path === '/api/ask') {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return; }
      (path === '/api/wish' ? onWish : onAsk)(req, res);
      return;
    }
    if (req.method !== 'GET') { json(res, 405, { ok: false }); return; }
    if (path === '/') reply(res, 200, 'text/html; charset=utf-8', pageHtml(langOf(url)));
    else if (path === '/font.woff2') {
      const f = font();
      if (!f) json(res, 404, { ok: false });
      else { res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' }); res.end(f); }
    } else if (path === '/api/films') json(res, 200, films(langOf(url)));
    else if (path === '/api/info') json(res, 200, info());
    else if (path === '/api/seasons') {
      Promise.resolve(seasons(url.searchParams.get('k') ?? '')).then((list) => {
        if (!list) json(res, 404, { ok: false });
        else json(res, 200, { ok: true, seasons: list.map((s) => ({ season: s.season, episodes: s.episodes })) });
      }, () => json(res, 500, { ok: false }));
    }
    else {
      let key = '';
      try { key = decodeURIComponent(path.slice('/poster/'.length)); } catch { /* bad escape */ }
      const img = posterFile(key);
      if (!img) json(res, 404, { ok: false });
      else { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }); res.end(img); }
    }
  }

  return {
    start(port, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        if (server) { resolve({ port: server.address().port }); return; }
        const s = http.createServer(handle);
        s.once('error', reject);
        s.listen(port, host, () => { server = s; resolve({ port: s.address().port }); });
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) { resolve(); return; }
        const s = server;
        server = null;
        s.closeAllConnections?.();
        s.close(() => resolve());
      });
    },
    get running() { return !!server; },
  };
}

module.exports = { createCatalogServer };

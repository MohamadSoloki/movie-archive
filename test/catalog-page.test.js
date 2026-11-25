'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { pageHtml } = require('../src/core/catalog-page.js');

class Element {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.id = attrs.id;
    this.hidden = 'hidden' in attrs;
    this.children = [];
    this.value = '';
    this.events = {};
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }

  get dataset() { return { recommendation: this.attrs['data-recommendation'] }; }
  addEventListener(event, fn) { this.events[event] = fn; }
  focus() {}
  setCustomValidity(message) { this.invalid = message; }
  reportValidity() { this.reported = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  append(...kids) {
    this.children.push(...kids.filter((k) => k instanceof Element));
    if (this.tag === 'select' && !this.value) this.value = kids[0]?.attrs.value || '';
    this.content = (this.content || '') + kids.map((k) => k instanceof Element ? k.textContent : k).join('');
  }

  replaceChildren(...kids) { this.children = []; this.content = ''; this.append(...kids); }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() { return this.content || ''; }
  all(filter) { return [this, ...this.children.flatMap((k) => k.all(() => true))].filter(filter); }
  querySelectorAll(name) { return this.all((e) => name === '[data-recommendation]' && e.dataset.recommendation); }
  click() { if (!this.disabled) this.onclick?.({ preventDefault() {} }); }
}

const genre = ['درام', 'معمایی', 'اکشن'];
const titles = ['نیمه شب', 'گاما', 'گاما ۲'];
const cards = titles.map((f, i) => ({ k: 't:' + (i + 1), t: 'Film ' + i, f, g: [genre[i]], b: [], a: [], s: i === 1 ? 2 : 0, o: i, kd: i === 1 ? 'series' : 'movie' }));
const seasons = [1, 2].map((season) => ({
  season, selectable: true, episodes: [1, 3], knownEpisodes: 2, average: 9, ratedEpisodes: 2, runtimeByEpisode: { 1: '43 min' },
}));
const settle = () => new Promise(setImmediate);

function page() {
  const html = pageHtml('fa');
  const nodes = Object.fromEntries(Array.from(html.matchAll(/<([a-z]+)[^>]*? id="([^"]+)"([^>]*?)>/g), ([, tag, id, tail]) =>
    [id, new Element(tag, /\bhidden\b/.test(tail) ? { id, hidden: '' } : { id })]));
  const byId = (id) => nodes[id] || Object.values(nodes).flatMap((e) => e.all((child) => child.id === id))[0];
  const entries = [{ hash: '', state: null }];
  let index = 0;
  const events = {};
  const win = {
    scrollY: 0, crypto: webcrypto, addEventListener: (name, fn) => { events[name] = fn; },
    location: { get hash() { return entries[index].hash; } },
    scrollTo: (_, y) => { win.scrollY = y; },
    history: {
      get state() { return entries[index].state; },
      replaceState(state) { entries[index].state = state; },
      pushState(state, _, hash) { entries.splice(++index, Infinity, { hash, state }); },
      back() { index -= 1; events.popstate(); },
    },
  };
  const submissions = [];
  const fetch = async (url, options) => {
    if (url.startsWith('/api/films')) return Response.json(cards);
    if (url === '/api/info') return Response.json({ prices: {} });
    if (url === '/api/wish') {
      submissions.push(JSON.parse(options.body));
      return Response.json({ ok: true, id: 52 });
    }
    if (!url.startsWith('/api/detail')) throw new Error('Unexpected mock request: ' + url);
    const series = url.endsWith('t%3A2');
    return Response.json({ detail: { episodic: series, plot: 'داستان آزمایشی', actors: 'Test Actor', awards: 'Won 1 Emmy',
      seasons: series ? seasons : [], related: series ? ['t:3'] : [], similar: series ? ['t:1'] : [] } });
  };
  const local = new Map();
  vm.runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)[1], {
    document: { getElementById: byId, createElement: (tag) => new Element(tag) },
    fetch, window: win, localStorage: { getItem: (k) => local.get(k), setItem: (k, v) => local.set(k, v) },
    setTimeout: (fn) => fn(), clearTimeout() {},
  });
  return { get: byId, nodes, win, submissions };
}

test('catalog disclosure preserves multiple genres and back restores the catalog and its scroll', async () => {
  const { get, nodes: e, win } = page();
  await settle();
  assert.equal(e.genres.hidden, true);
  e.genreToggle.click();
  e.genres.children.find((n) => n.textContent === genre[0]).click();
  assert.equal(get('title-t:2'), undefined);
  e.genres.children.find((n) => n.textContent === genre[1]).click();
  assert.ok(get('title-t:2'));
  assert.equal(get('title-t:3'), undefined);
  e.genreToggle.click();
  assert.match(e.genreToggle.textContent, /۲ انتخاب/);
  assert.equal(e.genres.hidden, true);
  e.q.value = 'گاما';
  e.q.events.input();
  win.scrollY = 240;
  const card = e.grid.children.find((node) => node.all((child) => child.id === 'title-t:2').length);
  assert.equal(card.all((node) => node.tag === 'button').length, 1);
  card.all((node) => node.attrs.class === 'img')[0].click();
  await settle();
  assert.equal(e.grid.hidden, true);
  assert.equal(win.scrollY, 0);
  assert.equal(get('detailTitle').textContent, 'گاما');
  assert.match(e.detailBody.textContent, /Won 1 Emmy/);
  e.detailBody.querySelectorAll('[data-recommendation]').find((link) => link.dataset.recommendation === 't:3').click();
  await settle();
  assert.equal(get('detailTitle').textContent, 'گاما ۲');
  e.detailBack.click();
  assert.equal(get('detailTitle').textContent, 'گاما');
  e.detailBack.click();
  assert.equal(e.grid.hidden, false);
  assert.equal(e.q.value, 'گاما');
  assert.equal(e.genres.hidden, true);
  assert.equal(win.scrollY, 240);
  assert.equal(get('title-t:3'), undefined);
});

test('series details add all seasons by default and submit only the edited episode and whole season', async () => {
  const { get, nodes: e, submissions } = page();
  await settle();
  get('title-t:2').click();
  await settle();
  assert.match(e.detailBody.textContent, /۹ میانگین IMDb/);
  assert.match(e.detailBody.textContent, /۴۳ دقیقه/);
  e.detailAdd.click();
  assert.equal(e.detailAdd.textContent, 'در لیست شما');
  assert.equal(e.detailAdd.disabled, true);
  const input = e.detailBody.all((node) => node.tag === 'input' && node.attrs.type === 'text')[0];
  input.value = '۲';
  input.oninput();
  e.detailAdd.click();
  assert.ok(input.invalid);
  assert.equal(input.reported, true);
  input.value = '۳';
  input.oninput();
  e.detailAdd.click();
  assert.equal(e.detailAdd.disabled, true);
  e.detailCart.click();
  e.name.value = 'Test Customer';
  e.form.onsubmit({ preventDefault() {} });
  await settle();
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].picks, { 't:2': { seasons: [2], episodes: { 1: [3] } } });
  assert.equal(e.submit.disabled, true);
});

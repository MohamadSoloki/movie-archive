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
  focus() { this.focused = true; }
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
  click(detail = 1) { if (!this.disabled) this.onclick?.({ detail, preventDefault() {} }); }
}

const genre = ['درام', 'معمایی', 'اکشن'];
const titles = ['نیمه شب', 'گاما', 'گاما ۲'];
const cards = titles.map((f, i) => ({ k: 't:' + (i + 1), t: 'Film ' + i, f, g: [genre[i]], b: [], a: [], s: i === 1 ? 2 : 0, o: i, kd: i === 1 ? 'series' : 'movie' }));
const seasons = [1, 2].map((season) => ({
  season, selectable: true, episodes: [1, 3], knownEpisodes: 2, average: 9, ratedEpisodes: 2, runtimeByEpisode: { 1: '43 min' },
}));
const settle = () => new Promise(setImmediate);

function page({ reduceMotion = false, darkMode = false, catalog = cards, local = new Map(), episodeSeasons = seasons, prices = {}, waitForSend } = {}) {
  const html = pageHtml('fa');
  const nodes = Object.fromEntries(Array.from(html.matchAll(/<([a-z]+)[^>]*? id="([^"]+)"([^>]*?)>/g), ([, tag, id, tail]) =>
    [id, new Element(tag, /\bhidden\b/.test(tail) ? { id, hidden: '' } : { id })]));
  const byId = (id) => nodes[id] || Object.values(nodes).flatMap((e) => e.all((child) => child.id === id))[0];
  const entrances = [];
  nodes.detailBody.animate = (frames, options) => {
    const entrance = { frames, options, cancel() { this.canceled = true; } };
    entrances.push(entrance);
    return entrance;
  };
  const entries = [{ hash: '', state: null }];
  let index = 0;
  const events = {};
  const win = {
    matchMedia: () => ({ matches: reduceMotion }),
    scrollY: 0, crypto: webcrypto, addEventListener: (name, fn) => { events[name] = fn; },
    location: { pathname: '/', search: '', get hash() { return entries[index].hash; } },
    scrollTo: (_, y) => { win.scrollY = y; },
    history: {
      get state() { return entries[index].state; },
      replaceState(state) { entries[index].state = state; },
      pushState(state, _, url) { entries.splice(++index, Infinity, { hash: url.startsWith('#') ? url : '', state }); },
      back() { index -= 1; events.popstate(); },
    },
  };
  const submissions = [];
  const fetch = async (url, options) => {
    if (url.startsWith('/api/films')) return Response.json(catalog);
    if (url === '/api/info') return Response.json({ prices });
    if (url === '/api/wish') {
      submissions.push(JSON.parse(options.body));
      if (waitForSend) await waitForSend;
      return Response.json({ ok: true, id: 52 });
    }
    if (!url.startsWith('/api/detail')) throw new Error('Unexpected mock request: ' + url);
    const series = url.endsWith('t%3A2');
    return Response.json({ detail: { episodic: series, plot: 'داستان آزمایشی در سال ۲۰۲۵', actors: 'Test Actor', awards: 'Won 1 Emmy',
      seasons: series ? episodeSeasons : [], related: series ? ['t:3'] : [], similar: series ? ['t:1'] : [] } });
  };
  const root = new Element('html');
  const context = {
    document: { documentElement: root, getElementById: byId, createElement: (tag) => new Element(tag) },
    fetch, window: win, localStorage: { getItem: (k) => local.get(k), setItem: (k, v) => local.set(k, v) },
    setTimeout: (fn) => fn(), clearTimeout() {},
  };
  let onSystemTheme;
  const colorScheme = { matches: darkMode, addEventListener: (_, callback) => { onSystemTheme = callback; } };
  win.matchMedia = (query) => query.includes('color-scheme') ? colorScheme : { matches: reduceMotion };
  const init = html.match(/<script id="catalog-theme-init">([\s\S]*?)<\/script>/);
  if (init) vm.runInNewContext(init[1], context);
  vm.runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)[1], context);
  return { get: byId, nodes, win, submissions, entrances, root, systemTheme(matches) { colorScheme.matches = matches; onSystemTheme?.(); } };
}

test('catalog theme follows device changes until manually changed and keeps the override across visits', async () => {
  const local = new Map();
  const initial = page({ darkMode: true, local });
  await settle();
  assert.equal(initial.root.attrs['data-theme'], undefined);
  assert.match(initial.nodes.themeToggle.textContent, /☀/);
  initial.systemTheme(false);
  assert.match(initial.nodes.themeToggle.textContent, /☾/);
  initial.nodes.themeToggle.click();
  assert.equal(initial.root.attrs['data-theme'], 'dark');
  assert.match(initial.nodes.detailThemeToggle.textContent, /☀/);
  initial.systemTheme(false);
  assert.equal(initial.root.attrs['data-theme'], 'dark');
  const reopened = page({ darkMode: false, local });
  await settle();
  assert.equal(reopened.root.attrs['data-theme'], 'dark');
  reopened.nodes.detailThemeToggle.click();
  assert.equal(reopened.root.attrs['data-theme'], 'light');
  assert.match(reopened.nodes.themeToggle.textContent, /☾/);
});

test('a film request keeps the customer draft when catalog controls change', async () => {
  const { get, nodes: e } = page();
  await settle();
  const request = get('askTitleInput');
  const customer = get('askCustomerInput');
  e.q.value = 'جست‌وجوی اول';
  e.q.events.input();
  assert.equal(request.value, 'جست‌وجوی اول');
  request.value = 'عنوان دلخواه';
  request.events.input();
  customer.value = 'نام مشتری';
  e.q.value = 'جست‌وجوی دوم';
  e.q.events.input();
  e.sort.onchange();
  assert.equal(get('askTitleInput'), request);
  assert.equal(request.value, 'عنوان دلخواه');
  assert.equal(customer.value, 'نام مشتری');
});

test('load more appends results without replacing the first cards', async () => {
  const catalog = Array.from({ length: 65 }, (_, i) => ({ ...cards[0], k: 'more:' + i, o: i }));
  const { nodes: e } = page({ catalog });
  await settle();
  const first = e.grid.children[0];
  assert.equal(e.grid.children.length, 60);
  e.loadMore.click();
  assert.equal(e.grid.children.length, 65);
  assert.equal(e.grid.children[0], first);
  assert.ok(e.grid.children[60].all((node) => node.attrs.class === 'title-link')[0].focused);
  assert.equal(e.catalogMore.hidden, true);
});

test('the catalog skip link focuses results and is hidden while viewing details', async () => {
  const { get, nodes: e } = page();
  await settle();
  e.skipToCatalog.click();
  assert.equal(e.grid.focused, true);
  get('title-t:2').click();
  await settle();
  assert.equal(e.skipToCatalog.hidden, true);
  assert.equal(e.askSlot.hidden, true);
});

test('clearing a list offers undo and sending has a visible pending state', async () => {
  let complete;
  const waitForSend = new Promise((resolve) => { complete = resolve; });
  const { get, nodes: e, submissions } = page({ waitForSend });
  await settle();
  get('pick-t:1').click();
  e.open.click();
  e.clearAll.click();
  assert.equal(e.dlg.open, true);
  assert.equal(e.undoClearRow.hidden, false);
  assert.equal(e.mine.children.length, 0);
  e.undoClear.click();
  assert.equal(e.mine.children.length, 1);
  e.name.value = 'Test Customer';
  e.form.onsubmit({ preventDefault() {} });
  assert.equal(e.submit.textContent, 'در حال ارسال…');
  assert.equal(e.submit.disabled, true);
  assert.deepEqual(submissions[0].keys, ['t:1']);
  complete();
  await settle();
  assert.notEqual(e.submit.textContent, 'در حال ارسال…');
});

test('the price tag opens configured tariffs and the header has no tariff strip', async () => {
  const { nodes: e } = page({ prices: { movie: 15000, season: 50000, episode: 0 } });
  await settle();
  assert.equal(e.tariff, undefined);
  assert.equal(e.tariffToggle.hidden, false);
  assert.equal(e.tariffDialog.open, undefined);
  e.tariffToggle.click();
  assert.equal(e.tariffDialog.open, true);
  assert.match(e.tariffRates.textContent, /هر فیلم.*15,000 تومان/);
  assert.match(e.tariffRates.textContent, /هر فصل سریال.*50,000 تومان/);
  assert.doesNotMatch(e.tariffRates.textContent, /هر قسمت/);
  e.closeTariff.click();
  assert.equal(e.tariffDialog.open, false);
  const empty = page();
  await settle();
  assert.equal(empty.nodes.tariffToggle.hidden, true);
});

test('newest is the default and sorts by release year, with undated titles last', async () => {
  const catalog = cards.map((f, i) => ({ ...f, y: ['۲۰۲۵', '2020–2026', null][i], o: i + 1 }));
  const { nodes } = page({ catalog });
  await settle();
  assert.equal(nodes.sort.children[0].textContent, 'جدیدترین');
  const titles = nodes.grid.children.slice(0, 3).map((card) => card.all((e) => e.tag === 'b')[0].textContent);
  assert.deepEqual(titles, ['Film 0', 'Film 1', 'Film 2']);
});

test('quick selection keeps the grid and search intact and updates the review button', async () => {
  const { get, nodes } = page();
  await settle();
  const before = get('pick-t:1');
  before.click();
  assert.equal(get('pick-t:1'), before);
  assert.equal(before.attrs['aria-pressed'], 'true');
  assert.match(nodes.open.textContent, /مرور لیست.*1/);
  before.click();
  assert.equal(before.attrs['aria-pressed'], 'false');
  assert.equal(nodes.bar.className, 'bar');
});

test('cartoon search finds animation and anime even without a Persian title', async () => {
  const catalog = cards.map((f, i) => ({ ...f, f: '', kd: ['movie', 'animation', 'anime'][i] }));
  const { nodes, get } = page({ catalog });
  await settle();
  nodes.q.value = 'کارتون';
  nodes.q.events.input();
  assert.equal(get('title-t:1'), undefined);
  assert.ok(get('title-t:2') && get('title-t:3'));
});

test('details animate on tap, including late sections, and cancel the entrance when leaving', async () => {
  const { get, nodes: e, entrances } = page();
  await settle();
  get('title-t:2').click();
  assert.equal(e.detailView.hidden, false);
  assert.equal(entrances.length, 1);
  await settle();
  assert.equal(entrances.length, 1);
  const sections = () => e.detailBody.all((node) => node.attrs.class?.includes('detail-enter-section'));
  assert.ok(sections().length > 1);
  e.dlg.events.close();
  assert.equal(sections().length, 0);
  e.detailBack.click();
  assert.equal(entrances[0].canceled, true);
  get('title-t:2').click();
  assert.equal(entrances.length, 2);
  assert.ok(sections().length > 1);
});

test('details open instantly with reduced motion or keyboard navigation', async () => {
  for (const reduceMotion of [false, true]) {
    const { get, nodes: e, entrances } = page({ reduceMotion });
    await settle();
    get('title-t:2').click(reduceMotion ? 1 : 0);
    await settle();
    assert.equal(e.detailView.hidden, false);
    assert.equal(entrances.length, 0);
    assert.equal(e.detailBody.all((node) => node.attrs.class?.includes('detail-enter-section')).length, 0);
  }
});

test('catalog disclosure preserves multiple genres and the site back button returns to the top', async () => {
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
  assert.match(e.genreToggle.textContent, /2 انتخاب/);
  assert.equal(e.genres.hidden, true);
  e.q.value = 'گاما';
  e.q.events.input();
  win.scrollY = 240;
  const card = e.grid.children.find((node) => node.all((child) => child.id === 'title-t:2').length);
  assert.equal(card.all((node) => node.tag === 'button').length, 1);
  assert.equal(card.all((node) => node.tag === 'b')[0].textContent, 'Film 1');
  assert.equal(card.all((node) => node.tag === 'small')[0].textContent, 'گاما');
  card.all((node) => node.attrs.class === 'img')[0].click();
  await settle();
  assert.equal(e.grid.hidden, true);
  assert.equal(win.scrollY, 0);
  assert.equal(get('detailTitle').textContent, 'Film 1');
  assert.equal(e.detailBody.all((node) => node.attrs.class === 'subtitle subtle')[0].textContent, 'گاما');
  assert.match(e.detailBody.textContent, /Won 1 Emmy/);
  assert.match(e.detailBody.textContent, /داستان آزمایشی در سال 2025/);
  win.scrollY = 180;
  e.detailBody.querySelectorAll('[data-recommendation]').find((link) => link.dataset.recommendation === 't:3').click();
  await settle();
  assert.equal(get('detailTitle').textContent, 'Film 2');
  e.detailBack.click();
  assert.equal(get('detailTitle').textContent, 'Film 1');
  assert.equal(win.scrollY, 0);
  e.detailBack.click();
  assert.equal(e.grid.hidden, false);
  assert.equal(e.q.value, 'گاما');
  assert.equal(e.genres.hidden, true);
  assert.equal(win.scrollY, 0);
  assert.equal(get('title-t:3'), undefined);
});

test('home goes straight to the catalog from a related title', async () => {
  const { get, nodes: e, win } = page();
  await settle();
  e.q.value = 'گاما';
  e.q.events.input();
  get('title-t:2').click();
  await settle();
  e.detailBody.querySelectorAll('[data-recommendation]').find((link) => link.dataset.recommendation === 't:3').click();
  await settle();
  assert.equal(get('detailTitle').textContent, 'Film 2');
  e.detailHome.click();
  assert.equal(win.location.hash, '');
  assert.equal(e.grid.hidden, false);
  assert.equal(e.q.value, 'گاما');
  assert.equal(win.scrollY, 0);
});

test('quick series selection uses saved numbers when the drive is disconnected', async () => {
  const episodeSeasons = seasons.map((season) => ({ ...season, episodes: null, choiceEpisodes: [1, 2, 3, 4, 5, 6, 7, 8] }));
  const { get, nodes: e, submissions } = page({ episodeSeasons });
  await settle();
  get('pick-t:2').click();
  assert.ok(e.seasonPicker.open);
  await settle();
  assert.equal(get('pick-t:2').attrs['aria-pressed'], 'false');
  const [first, second] = e.seasonPickerBody.all((node) => node.tag === 'input' && node.attrs.type === 'checkbox');
  const episode = e.seasonPickerBody.all((node) => node.tag === 'input' && node.attrs.type === 'text')[0];
  assert.doesNotMatch(e.seasonPickerBody.textContent, /درایو|شمارهٔ قسمت‌های این فصل هنوز ثبت نشده/);
  const firstSeason = e.seasonPickerBody.all((node) => node.attrs.class === 'season season-selectable')[0];
  assert.equal(firstSeason.children[0].children[0], first);
  assert.equal(firstSeason.children[1].tag, 'details');
  assert.equal(first.checked, false);
  second.checked = true;
  second.onchange();
  assert.match(e.seasonPickerSelection.textContent, /فصل 2 کامل/);
  const episodeError = e.seasonPickerBody.all((node) => node.attrs.class === 'episode-error')[0];
  episode.value = '۳a';
  episode.oninput();
  assert.equal(episode.value, '3');
  assert.equal(episode.attrs['aria-invalid'], 'true');
  assert.match(episodeError.textContent, /عدد/);
  episode.value = '۱۱';
  episode.oninput();
  assert.match(episodeError.textContent, /آخرین قسمت این فصل 8/);
  assert.equal(episode.attrs['aria-invalid'], 'true');
  e.applySeasonPicker.click();
  assert.ok(e.seasonPicker.open);
  episode.value = '۳';
  episode.oninput();
  assert.equal(episode.attrs['aria-invalid'], 'false');
  assert.equal(episodeError.hidden, true);
  assert.match(e.seasonPickerSelection.textContent, /فصل 2 کامل.*1 قسمت از فصل 1/);
  e.applySeasonPicker.click();
  assert.equal(e.seasonPicker.open, false);
  e.open.click();
  e.name.value = 'Test Customer';
  e.form.onsubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(submissions[0].picks, { 't:2': { seasons: [2], episodes: { 1: [3] } } });
});

test('series details allow selecting the whole series, canceling a change and editing episodes', async () => {
  const { get, nodes: e, submissions } = page();
  await settle();
  get('title-t:2').click();
  await settle();
  assert.match(e.detailBody.textContent, /9 میانگین IMDb/);
  assert.match(e.detailBody.textContent, /2 قسمت موجود/);
  assert.doesNotMatch(e.detailBody.textContent, /قسمت موجود · 1، 3/);
  assert.match(e.detailBody.textContent, /43 دقیقه/);
  e.detailAdd.click();
  await settle();
  e.pickWholeSeries.click();
  assert.equal(get('pick-t:2').attrs['aria-pressed'], 'false');
  assert.equal(e.seasonPicker.open, true);
  assert.match(e.seasonPickerSelection.textContent, /کل سریال/);
  e.closeSeasonPicker.click();
  assert.equal(get('pick-t:2').attrs['aria-pressed'], 'false');
  e.detailAdd.click();
  await settle();
  e.pickWholeSeries.click();
  e.applySeasonPicker.click();
  assert.equal(e.detailAdd.textContent, 'ویرایش فصل و قسمت');
  assert.equal(get('pick-t:2').attrs['aria-pressed'], 'true');
  e.detailAdd.click();
  await settle();
  e.closeSeasonPicker.click();
  assert.equal(get('pick-t:2').attrs['aria-pressed'], 'true');
  const input = e.detailBody.all((node) => node.tag === 'input' && node.attrs.type === 'text')[0];
  input.value = '۲';
  input.oninput();
  e.detailAdd.click();
  assert.ok(input.invalid);
  assert.equal(input.reported, true);
  input.value = '۳';
  input.oninput();
  e.detailAdd.click();
  assert.equal(e.detailAdd.textContent, 'ویرایش فصل و قسمت');
  e.detailCart.click();
  e.name.value = 'Test Customer';
  e.form.onsubmit({ preventDefault() {} });
  await settle();
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].picks, { 't:2': { seasons: [2], episodes: { 1: [3] } } });
  assert.equal(e.submit.disabled, true);
});

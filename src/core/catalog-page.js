'use strict';

const { wishSignature } = require('./wish-signature.js');
const { renderDetailView } = require('./catalog-detail-view.js');

const TEXT = {
  fa: {
    dir: 'rtl', lang: 'fa', other: 'English', otherLang: 'en', title: 'کاتالوگ فیلم و سریال', search: 'اسم فیلم، بازیگر یا کارگردان…',
    all: 'همه', movie: 'فیلم', series: 'سریال', animation: 'انیمیشن', anime: 'انیمه', pick: 'انتخاب', picked: 'انتخاب شد', send: 'ارسال لیست', mine: 'لیست من',
    name: 'اسم شما', phone: 'شماره تماس (اختیاری)', note: 'توضیح (اختیاری)', submit: 'ارسال', close: 'بستن', remove: 'حذف از لیست',
    done: 'لیستت ثبت شد. شمارهٔ پیگیری:', updated: 'لیستت به‌روز شد. شمارهٔ پیگیری:', updateList: 'به‌روزرسانی لیست',
    saved: 'ثبت شده', receipt: 'شمارهٔ پیگیری',
    fail: 'ارسال نشد. بعداً دوباره امتحان کن.', slow: 'چند بار پشت هم فرستادی. چند دقیقه بعد دوباره امتحان کن.',
    full: 'الان لیست جدید قبول نمی‌کنیم. به مغازه بگو.', none: 'چیزی پیدا نشد.', more: 'نمایش بیشتر', loadFail: 'کاتالوگ باز نشد. دوباره امتحان کن.', retry: 'تلاش دوباره',
    sortNew: 'تازه‌اضافه‌شده', sortName: 'الفبا', sortRating: 'امتیاز', sortYear: 'سال', sort: 'مرتب‌سازی', seasons: 'فصل', stars: 'امتیاز',
    askTitle: 'پیدا نکردی؟', askText: 'اسم فیلم رو بنویس تا برات تهیه کنیم.', askGo: 'درخواست', askThanks: 'ثبت شد. اگه تهیه کردیم بهت خبر می‌دیم.',
    askHave: 'این فیلم توی آرشیو هست:', askName: 'اسم شما (برای خبر دادن، اختیاری)', askPhone: 'شماره تماس (اختیاری)', empty: 'کاتالوگ هنوز خالیه.',
    tariff: 'تعرفه', perMovie: 'هر فیلم', perSeason: 'هر فصل سریال', perEpisode: 'هر قسمت', currency: 'تومان', total: 'مبلغ کل',
    related: 'عنوان‌های مرتبط', similar: 'پیشنهادهای مشابه', back: 'برگشت', seasonN: 'فصل', epWord: 'قسمت',
    episodesHint: 'شمارهٔ قسمت‌ها، مثلاً ۱-۵ یا ۲ ۵ ۷', wholeSeason: 'همهٔ قسمت‌های موجود', invalidEpisodes: 'شمارهٔ قسمت‌های موجود را وارد کن.',
    genres: 'ژانرها', genreCount: 'انتخاب', addToList: 'اضافه به لیست سینمایی', inList: 'در لیست شما', updatePick: 'ثبت انتخاب فصل و قسمت',
    editSeasons: 'ویرایش فصل و قسمت', loading: 'در حال بارگذاری جزئیات…', detailError: 'جزئیات در دسترس نیست.', unknownTitle: 'این عنوان در کاتالوگ پیدا نشد.',
    synopsis: 'خلاصهٔ داستان', morePlot: 'ادامهٔ توضیحات', people: 'بازیگران و عوامل', cast: 'بازیگران', director: 'کارگردان', awards: 'جوایز',
    availableSeasons: 'فصل موجود', availableEpisodes: 'قسمت موجود', totalSeasons: 'فصل در مجموع', knownEpisodes: 'قسمت ثبت‌شده',
    typicalRuntime: 'مدت معمول هر قسمت', average: 'میانگین IMDb', ratingsCount: 'قسمت امتیازدار', episodeTimes: 'مدت قسمت‌ها',
    clearAll: 'پاک کردن همهٔ انتخاب‌ها', doneNote: 'می‌تونی لیستت رو تغییر بدی و دوباره بفرستی؛ همین لیست به‌روز می‌شه.', whole: 'همهٔ فصل‌ها', onlyEps: 'قسمت',
    badge: { '4K': '4K', '1080p': '1080p', dub: 'دوبله', sub: 'زیرنویس', hardsub: 'زیرنویس چسبیده' },
  },
};

// One self-contained page: no outside files, so it works on a shop network with no internet.
function pageHtml(lang) {
  const x = TEXT[lang] ?? TEXT.fa;
  const client = JSON.stringify(x).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${x.lang}" dir="${x.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${x.title}</title>
<style>
@font-face { font-family: "Vazirmatn"; src: url("/font.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
:root { --bg: #eceff5; --card: #fff; --ink: #141925; --muted: #586276; --accent: #3a46d6; --accent-ink: #fff; --line: #dde2ec; --ok: #1f7a52; }
@media (prefers-color-scheme: dark) { :root { --bg: #11141c; --card: #1a1f2b; --ink: #eef0f6; --muted: #a2abbd; --accent: #8b95ff; --accent-ink: #141925; --line: #2a3142; --ok: #5fd39a; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; font: 17px/1.5 "Vazirmatn", system-ui, Tahoma, sans-serif; background: var(--bg); color: var(--ink); padding-bottom: 6rem; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); padding: 0.6rem 1rem 0.6rem; border-bottom: 1px solid var(--line); }
.filters { padding: 0 1rem; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.3rem; }
h1 { font-size: 1.1rem; margin: 0; }
a.lang { color: var(--accent); text-decoration: none; font-size: 0.9rem; padding: 0.4rem 0.2rem; }
input, textarea, select, button { font-family: inherit; }
input, textarea, select { width: 100%; font: inherit; padding: 0.65rem 0.8rem; min-height: 44px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.tools { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.tools select { flex: 1; min-width: 0; }
.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.5rem 0 0; scrollbar-width: none; }
.chip { flex: none; min-height: 40px; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 0.2rem 0.9rem; font: inherit; font-size: 0.9rem; }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
#grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(128px, 100%), 1fr)); gap: 0.8rem; padding: 1rem; }
.film { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.film .img { aspect-ratio: 2 / 3; background: var(--line); display: grid; place-items: center; text-align: center; padding: 0.5rem; color: var(--muted); }
.film img { width: 100%; height: 100%; object-fit: cover; display: block; }
.film .body { padding: 0.5rem 0.6rem 0.6rem; display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
.film b { font-size: 0.95rem; line-height: 1.35; }
.film a { display: block; color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.film .title-link:hover, .rec:hover { text-decoration: underline; }
.title-link:focus-visible, .rec:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.film small { color: var(--muted); font-size: 0.8rem; }
.film .subtitle, .detail-heading h1, .detail-heading .subtitle { text-align: match-parent; }
.film button { margin-top: auto; min-height: 44px; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 8px; padding: 0.35rem; font: inherit; font-size: 0.9rem; }
.film.on { border-color: var(--accent); }
.film.on button { background: var(--accent); color: var(--accent-ink); }
.bar { position: fixed; z-index: 3; inset-inline: 0; bottom: 0; padding: 0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--line); display: none; }
.bar.show { display: block; }
.big { width: 100%; min-height: 48px; padding: 0.75rem; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 700; }
.big:disabled { opacity: 0.6; }
.quiet { background: transparent; color: var(--muted); }
dialog { width: min(92vw, 440px); max-height: 92vh; overflow: auto; border: 0; border-radius: 16px; background: var(--card); color: var(--ink); padding: 1rem; }
dialog::backdrop { background: rgba(0,0,0,.5); }
form { display: grid; gap: 0.6rem; }
ul { margin: 0; padding: 0; list-style: none; max-height: 30vh; overflow: auto; }
li.row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.2rem 0; }
li.row button { flex: none; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: var(--muted); font-size: 1.2rem; }
.tariff { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.85rem; }
#genres { flex-wrap: wrap; overflow: visible; }
#genreToggle { min-height: 44px; max-width: 65%; }
#detailView { width: min(100%, 740px); margin-inline: auto; padding: 1rem 1rem 3rem; }
#detailBack { min-height: 44px; margin-bottom: 0.75rem; }
.detail-hero { display: grid; grid-template-columns: minmax(96px, 30%) minmax(0, 1fr); gap: clamp(0.75rem, 4vw, 1.75rem); align-items: center; }
.detail-heading { min-width: 0; overflow-wrap: anywhere; }
.detail-heading h1 { font-size: clamp(1.3rem, 4.8vw, 2rem); line-height: 1.3; }
.detail-poster, .rec-poster { aspect-ratio: 2 / 3; width: 100%; display: grid; place-items: center; object-fit: cover; background: var(--line); color: var(--muted); border-radius: 10px; overflow: hidden; text-align: center; }
.card-poster { width: 100%; height: 100%; }
.detail-meta { margin-block: 0.45rem; font-size: 0.9rem; }
.detail-genres { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.detail-genres span { padding: 0.12rem 0.45rem; background: var(--card); border: 1px solid var(--line); border-radius: 999px; font-size: 0.8rem; }
.detail-section { border-top: 1px solid var(--line); margin-top: 1.15rem; padding-top: 0.85rem; }
.detail-section h2 { margin: 0 0 0.45rem; font-size: 1.05rem; }
.detail-section p, .detail-section dl { margin: 0.25rem 0 0.5rem; overflow-wrap: anywhere; }
.detail-section p, .detail-section dd { unicode-bidi: plaintext; }
.detail-section dt, .subtle { color: var(--muted); font-size: 0.88rem; }
.detail-section dd { margin: 0 0 0.45rem; }
.detail-section summary { cursor: pointer; min-height: 44px; padding-block: 0.55rem; }
.detail-section details > summary { color: var(--accent); }
.season { background: var(--card); padding-inline: 0.65rem; border-radius: 10px; margin-block: 0.4rem; border: 1px solid var(--line); }
.season-name { font-weight: 700; color: var(--ink); }
.season-info { display: inline; color: var(--muted); font-size: 0.82rem; }
.season label { display: flex; align-items: center; gap: 0.5rem; min-height: 44px; }
.season input[type=checkbox] { width: 20px; height: 20px; min-height: 0; flex: none; }
.season input[type=text] { margin-bottom: 0.5rem; }
.season .episode-times { margin-bottom: 0.5rem; }
.recommendations { display: grid; grid-auto-flow: column; grid-auto-columns: clamp(94px, 25vw, 130px); gap: 0.6rem; overflow-x: auto; padding: 0.2rem 0.15rem 0.6rem; }
.rec { display: grid; align-content: start; gap: 0.25rem; color: inherit; text-decoration: none; font-size: 0.85rem; overflow-wrap: anywhere; }
#detailActions { display: flex; gap: 0.5rem; width: min(100%, 740px); margin-inline: auto; }
#detailCart { min-height: 48px; }
.sum { margin: 0.2rem 0 0; display: grid; gap: 0.15rem; font-size: 0.95rem; }
.sum b { color: var(--accent); }
.price { color: var(--accent); font-size: 0.85rem; white-space: nowrap; }
.msg { color: var(--ok); font-weight: 600; margin: 0; }
.msg.bad { color: #d83a2b; }
.wide { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 1.2rem 0; display: grid; gap: 0.6rem; justify-items: center; }
.wide .ask { width: 100%; max-width: 420px; text-align: start; display: grid; gap: 0.5rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem; color: var(--ink); }
.wide .ask p { margin: 0; }
.wide .ask button { min-height: 44px; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 10px; font: inherit; }
</style>
</head>
<body>
<header id="catalogHead">
  <div class="top"><h1>${x.title}</h1></div>
  <p class="tariff" id="tariff" hidden></p>
  <input id="q" type="search" placeholder="${x.search}" autocomplete="off" aria-label="${x.search}">
</header>
<section class="filters" id="catalogFilters">
  <div class="chips" id="kinds" role="group"></div>
  <div class="tools"><select id="sort" aria-label="${x.sort}"></select><button class="chip" type="button" id="genreToggle" aria-expanded="false" aria-controls="genres">${x.genres} ▾</button></div>
  <div class="chips" id="genres" role="group" aria-label="${x.genres}" hidden></div>
</section>
<main id="grid"></main>
<main id="detailView" hidden>
  <button id="detailBack" type="button" class="chip">${x.back}</button>
  <div id="detailBody"></div>
</main>
<div class="bar" id="bar"><button id="open" class="big" type="button"></button></div>
<div class="bar show" id="detailBar" hidden><div id="detailActions">
  <button id="detailAdd" type="button" class="big">${x.addToList}</button>
  <button id="detailCart" type="button" class="chip" hidden>${x.mine}</button>
</div></div>
<dialog id="dlg">
  <form id="form" method="dialog">
    <h2 style="margin:0;font-size:1.05rem">${x.mine}</h2>
    <ul id="mine"></ul>
    <div class="sum" id="sum"></div>
    <input id="name" maxlength="80" placeholder="${x.name}" aria-label="${x.name}" autocomplete="name" required>
    <input id="phone" maxlength="30" inputmode="tel" placeholder="${x.phone}" aria-label="${x.phone}" autocomplete="tel">
    <textarea id="note" maxlength="200" rows="2" placeholder="${x.note}" aria-label="${x.note}"></textarea>
    <p class="msg" id="msg" role="status"></p>
    <button type="submit" id="submit" class="big">${x.submit}</button>
    <button type="button" id="clearAll" class="big quiet">${x.clearAll}</button>
    <button type="button" id="close" class="big quiet">${x.close}</button>
  </form>
</dialog>
<script>
(function () {
  ${wishSignature.toString()}
  ${renderDetailView.toString()}
  var T = ${client};
  var PAGE = 60;
  var films = [], filmByKey = new Map(), kind = '', genres = new Set(), shown = PAGE, chosen = {}, sel = {}, P = { movie: 0, season: 0, episode: 0 };
  var $ = function (id) { return document.getElementById(id); };
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[آأإ]/g, 'ا').replace(/[ةۀ]/g, 'ه')
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 1776; }).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; })
      .replace(/[\\u200c\\u0640\\u064b-\\u065f]/g, '').replace(/\\s+/g, ' ').trim();
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { e.append(c); });
    return e;
  }
  function fa(n) { return Number(n).toLocaleString('fa-IR'); }
  function money(n) { return fa(n) + ' ' + T.currency; }
  function hasPrice() { return P.movie > 0 || P.season > 0 || P.episode > 0; }
  // "1-5, 7 9" -> [1,2,3,4,5,7,9]
  function parseEps(text) {
    var out = {};
    norm(text).split(/[,،\\s]+/).forEach(function (p) {
      var m = /^(\\d{1,4})(?:[-–](\\d{1,4}))?$/.exec(p);
      if (!m) return;
      var a = +m[1], b = m[2] === undefined ? a : +m[2], t;
      if (a > b) { t = a; a = b; b = t; }
      for (var n = Math.max(a, 1); n <= Math.min(b, 999); n++) out[n] = 1;
    });
    return Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
  }
  // what one chosen film costs by kind: a film, whole seasons, single episodes (a partial season costs a whole season when there is no episode price)
  function itemCounts(k) {
    var f = chosen[k], s = sel[k], c = { movies: 0, seasons: 0, episodes: 0 };
    if (!(f.s > 0)) { c.movies = 1; return c; }
    if (!s) { c.seasons = f.s; return c; }
    c.seasons = s.seasons.length;
    Object.keys(s.episodes).forEach(function (n) {
      if (s.seasons.indexOf(Number(n)) >= 0) return;
      if (P.episode > 0) c.episodes += s.episodes[n].length; else c.seasons += 1;
    });
    return c;
  }
  function priceOfCounts(c) { return c.movies * P.movie + c.seasons * P.season + c.episodes * P.episode; }
  function totals() {
    var c = { movies: 0, seasons: 0, episodes: 0 };
    Object.keys(chosen).forEach(function (k) { var x = itemCounts(k); c.movies += x.movies; c.seasons += x.seasons; c.episodes += x.episodes; });
    return c;
  }
  function selText(k) {
    var s = sel[k];
    if (!s) return '';
    var parts = [];
    if (s.seasons.length) parts.push(T.seasonN + ' ' + s.seasons.map(fa).join('، '));
    Object.keys(s.episodes).forEach(function (n) { if (s.seasons.indexOf(Number(n)) < 0) parts.push(T.seasonN + ' ' + fa(n) + ': ' + T.onlyEps + ' ' + s.episodes[n].map(fa).join('، ')); });
    return parts.join(' · ');
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private mode */ } return null; }
  var editKey = store('wishEditKey') || '', wishId = editKey ? Number(store('wishId')) : 0;
  var lastSent = wishId ? store('wishSnapshot') : null, sending = false;
  function draft() {
    return { name: $('name').value, phone: $('phone').value, note: $('note').value, keys: Object.keys(chosen), picks: sel };
  }
  function signature(body) {
    return wishSignature({ ...body, items: body.keys.map(function (key) { return { key: key, sel: body.picks[key] }; }) });
  }
  function syncSend() {
    var saved = Boolean(wishId && lastSent && signature(draft()) === lastSent);
    $('submit').disabled = sending || saved;
    $('submit').textContent = saved ? T.saved : wishId ? T.updateList : T.submit;
    var n = Object.keys(chosen).length;
    var label = saved ? T.saved + ' · ' + T.receipt + ' ' + fa(wishId) : (wishId ? T.updateList : T.send) + ' (' + fa(n) + ')';
    $('open').textContent = label + (hasPrice() ? ' · ' + money(priceOfCounts(totals())) : '');
  }
  function browserEditKey() {
    editKey = store('wishEditKey') || editKey;
    if (!editKey) {
      var bytes = window.crypto.getRandomValues(new Uint8Array(32));
      editKey = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      store('wishEditKey', editKey);
    }
    return editKey;
  }
  var SORTS = {
    sortNew: function (a, b) { return b.o - a.o; },
    sortName: function (a, b) { return (a.f || a.t).localeCompare(b.f || b.t, 'fa'); },
    sortRating: function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); },
    sortYear: function (a, b) { return (parseInt(b.y, 10) || 0) - (parseInt(a.y, 10) || 0); }
  };
  function visible() {
    var words = norm($('q').value).split(' ').filter(Boolean);
    var list = films.filter(function (f) {
      return (!kind || f.kd === kind) && (!genres.size || f.g.some(function (g) { return genres.has(g); }))
        && words.every(function (w) { return f._n.indexOf(w) >= 0; });
    });
    return list.sort(function (a, b) { return SORTS[$('sort').value](a, b) || (a.f || a.t).localeCompare(b.f || b.t, 'fa'); });
  }
  function askBox(prefill) {
    var input = el('input', { maxlength: '100', 'aria-label': T.askText, placeholder: T.askText });
    input.value = prefill;
    var who = el('input', { maxlength: '80', 'aria-label': T.askName, placeholder: T.askName });
    var tel = el('input', { maxlength: '30', type: 'tel', inputmode: 'tel', dir: 'ltr', 'aria-label': T.askPhone, placeholder: T.askPhone });
    var out = el('p', { 'class': 'msg', role: 'status' });
    var go = el('button', { type: 'button' }, [T.askGo]);
    go.onclick = function () {
      if (!input.value.trim()) return;
      go.disabled = true;
      fetch('/api/ask', { method: 'POST', body: JSON.stringify({ name: input.value, customer: who.value, phone: tel.value }) }).then(function (r) { return r.json().then(function (j) { return [r.status, j]; }); }).then(function (a) {
        out.className = 'msg' + (a[0] === 200 ? '' : ' bad');
        if (a[0] === 200) out.textContent = a[1].inArchive.length ? T.askHave + ' ' + a[1].inArchive.join('، ') : T.askThanks;
        else out.textContent = a[0] === 429 ? T.slow : T.fail;
        go.disabled = false;
      }, function () { out.className = 'msg bad'; out.textContent = T.fail; go.disabled = false; });
    };
    return el('div', { 'class': 'ask' }, [el('b', {}, [T.askTitle]), el('p', {}, [T.askText]), input, who, tel, go, out]);
  }
  function render() {
    var list = visible();
    var grid = $('grid');
    grid.replaceChildren();
    list.slice(0, shown).forEach(function (f) {
      var on = !!chosen[f.k];
      var title = f.t || f.f;
      var subtitle = f.f && f.f !== title ? f.f : '';
      var tags = f.b.map(function (b) { return T.badge[b] || b; });
      if (f.s) tags.unshift(fa(f.s) + ' ' + T.seasons);
      var meta = [f.y, f.r ? '★ ' + f.r : ''].concat(tags).filter(Boolean).join(' · ');
      var pick = el('button', { type: 'button', 'aria-pressed': String(on) }, [on ? T.picked : T.pick]);
      pick.onclick = function () {
        setChoice(f, !chosen[f.k], null);
        $(pick.id)?.focus({ preventScroll: true });
      };
      pick.id = 'pick-' + f.k;
      var card = el('div', { 'class': 'film' + (on ? ' on' : '') }, [
        detailLink(f, { class: 'img', 'aria-label': title, tabindex: '-1' }, [poster(f, 'card-poster', true)]),
        el('div', { class: 'body' }, [detailLink(f, { class: 'title-link', id: 'title-' + f.k }, [
          el('b', { dir: 'auto' }, [title]),
        ]), subtitle ? el('small', { dir: 'auto', class: 'subtitle' }, [subtitle]) : '', el('small', {}, [meta]), pick])]);
      grid.append(card);
    });
    var tail = el('div', { 'class': 'wide' }, []);
    if (!list.length) tail.append(el('span', {}, [films.length ? T.none : T.empty]));
    if (list.length > shown) {
      var more = el('button', { type: 'button', 'class': 'chip' }, [T.more]);
      more.onclick = function () { shown += PAGE; render(); };
      tail.append(more);
    }
    if (films.length) tail.append(askBox($('q').value.trim()));
    grid.append(tail);
    var n = Object.keys(chosen).length;
    $('bar').className = 'bar' + (n || wishId ? ' show' : '');
    syncSend();
  }
  function save() { store('pick', JSON.stringify(Object.keys(chosen))); store('sel', JSON.stringify(sel)); }
  function setChoice(f, include, selection) {
    if (include) chosen[f.k] = f; else delete chosen[f.k];
    if (include && selection) sel[f.k] = selection; else delete sel[f.k];
    save(); render();
  }
  function chips(box, items, selected, set) {
    box.replaceChildren();
    items.forEach(function (it) {
      var b = el('button', { 'class': 'chip', type: 'button', 'aria-pressed': String(selected(it[0])) }, [it[1]]);
      b.onclick = function () {
        set(it[0]); shown = PAGE;
        Array.from(box.children).forEach(function (button, i) { button.setAttribute('aria-pressed', String(selected(items[i][0]))); });
        updateGenreToggle(); render();
      };
      box.append(b);
    });
  }
  function updateGenreToggle() {
    var open = !$('genres').hidden;
    $('genreToggle').setAttribute('aria-expanded', String(open));
    $('genreToggle').textContent = T.genres + (genres.size ? ' · ' + fa(genres.size) + ' ' + T.genreCount : '') + (open ? ' ▴' : ' ▾');
  }
  $('genreToggle').onclick = function () { $('genres').hidden = !$('genres').hidden; updateGenreToggle(); };
  // prices are read once; without them the page shows no money at all
  function loadPrices() {
    fetch('/api/info').then(function (r) { return r.json(); }).then(function (j) {
      P = { movie: +j.prices.movie || 0, season: +j.prices.season || 0, episode: +j.prices.episode || 0 };
      var t = $('tariff');
      var parts = [];
      if (P.movie > 0) parts.push(T.perMovie + ' ' + money(P.movie));
      if (P.season > 0) parts.push(T.perSeason + ' ' + money(P.season));
      if (P.episode > 0) parts.push(T.perEpisode + ' ' + money(P.episode));
      t.hidden = !parts.length;
      t.textContent = T.tariff + ': ' + parts.join(' · ');
      if (catalogReady) render();
    }).catch(function () { /* no prices: no money shown */ });
  }
  var catalogReady = false, activeDetail = null, detailData = new Map();
  function poster(f, style, lazy) {
    if (!f.p) return el('span', { class: style, 'aria-hidden': 'true', dir: 'auto' }, [f.t || f.f]);
    return el('img', { class: style, src: '/poster/' + encodeURIComponent(f.k), alt: '', loading: lazy ? 'lazy' : 'eager' });
  }
  function detailHash(key) { return '#title=' + encodeURIComponent(key); }
  function detailLink(f, attrs, children) {
    var link = el('a', { ...attrs, href: detailHash(f.k) }, children);
    link.onclick = function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      ev.preventDefault();
      window.history.replaceState({ ...window.history.state, scroll: window.scrollY, focusKey: f.k }, '');
      window.history.pushState({ fromCatalog: true }, '', detailHash(f.k));
      showRoute();
    };
    return link;
  }
  function recommendation(key) {
    var f = filmByKey.get(key);
    return f && detailLink(f, { class: 'rec', 'data-recommendation': f.k }, [
      poster(f, 'rec-poster', true), el('span', { dir: 'auto' }, [f.f || f.t]),
    ]);
  }
  function showRoute() {
    var hash = window.location?.hash || '';
    var detail = hash.startsWith('#title=');
    var key = '';
    if (detail) {
      try { key = decodeURIComponent(hash.slice(7)); } catch (e) { /* unknown title */ }
    }
    activeDetail = detail ? filmByKey.get(key) || null : null;
    ['catalogHead', 'catalogFilters', 'grid', 'bar'].forEach(function (id) { $(id).hidden = detail; });
    $('detailView').hidden = !detail;
    $('detailBar').hidden = !activeDetail;
    if (activeDetail) renderTitle(activeDetail);
    else if (detail) $('detailBody').replaceChildren(el('p', { role: 'status' }, [T.unknownTitle]));
    var route = window.history?.state;
    if (detail) {
      var previous = Array.from($('detailBody').querySelectorAll?.('[data-recommendation]') || [])
        .find(function (link) { return link.dataset.recommendation === route?.focusKey; });
      (previous || $('detailTitle') || $('detailBack')).focus({ preventScroll: true });
    } else if (route?.focusKey) {
      $('title-' + route.focusKey)?.focus({ preventScroll: true });
    }
    window.scrollTo(0, route?.scroll || 0);
  }
  $('detailBack').onclick = function () {
    if (window.history.state?.fromCatalog) window.history.back();
    else { window.history.replaceState(null, '', window.location.pathname + window.location.search); showRoute(); }
  };
  if (window.history) window.history.scrollRestoration = 'manual';
  window.addEventListener?.('popstate', function () { if (catalogReady) showRoute(); });

  function renderTitle(f, retry, fetching) {
    var data = detailData.get(f.k);
    var add = $('detailAdd');
    function label(text, disabled) {
      add.textContent = text;
      add.disabled = disabled;
      $('detailCart').hidden = !(Object.keys(chosen).length || wishId);
    }
    label(chosen[f.k] ? T.inList : T.addToList, !!chosen[f.k]);
    add.onclick = function () {
      setChoice(f, true, null);
      label(T.inList, true);
    };
    renderDetailView({
      body: $('detailBody'), title: f, data: data, text: T, element: el, fa: fa,
      poster: function (film) { return poster(film, 'detail-poster', false); }, link: recommendation,
      controls: function (seasons) { return seasonEditor(f, seasons, label); },
      retry: retry ? function () { renderTitle(f); } : null,
    });
    if (data || retry || fetching) return;
    fetch('/api/detail?k=' + encodeURIComponent(f.k)).then(function (r) {
      if (!r.ok) throw new Error('bad');
      return r.json();
    }).then(function (j) {
      detailData.set(f.k, j.detail);
      if (activeDetail === f) {
        var focusHeading = document.activeElement === $('detailTitle');
        renderTitle(f, false, true);
        if (focusHeading) $('detailTitle').focus({ preventScroll: true });
      }
    }).catch(function () { if (activeDetail === f) renderTitle(f, true, true); });
  }

  function seasonEditor(f, seasons, label) {
    var block = el('div', {});
    var rows = [];
    var current = sel[f.k];
    var edit = el('button', { type: 'button', class: 'chip' }, [T.editSeasons]);
    block.append(edit);
    seasons.forEach(function (s) {
      var description = [];
      if (s.episodes) description.push(fa(s.episodes.length) + ' ' + T.availableEpisodes);
      else if (s.knownEpisodes) description.push(fa(s.knownEpisodes) + ' ' + T.knownEpisodes);
      if (s.average != null) description.push('★ ' + fa(s.average) + ' ' + T.average + ' · ' + fa(s.ratedEpisodes) + ' ' + T.ratingsCount);
      var summary = el('summary', {}, [
        el('span', { class: 'season-name' }, [T.seasonN + ' ' + fa(s.season)]),
        description.length ? el('span', { class: 'season-info' }, [' · ' + description.join(' · ')]) : '',
      ]);
      var panel = el('details', { class: 'season' }, [summary]);
      var times = Object.entries(s.runtimeByEpisode);
      if (s.selectable) {
        var whole = el('input', { type: 'checkbox' });
        whole.checked = !current || current.seasons.includes(s.season);
        var eps = s.episodes ? el('input', { type: 'text', inputmode: 'text', 'aria-label': T.episodesHint, placeholder: T.episodesHint, dir: 'auto' }) : null;
        if (eps) eps.value = (current?.episodes[s.season] || []).map(fa).join(' ');
        rows.push({ season: s.season, whole: whole, eps: eps, available: s.episodes, panel: panel, summary: summary });
        whole.onchange = function () { if (whole.checked && eps) eps.value = ''; update(); };
        if (eps) eps.oninput = function () { if (eps.value.trim()) whole.checked = false; update(); };
        panel.append(el('label', {}, [whole, T.wholeSeason]), eps || '');
        if (s.episodes) panel.append(el('p', { class: 'subtle' }, [T.availableEpisodes + ' · ' + s.episodes.map(fa).join('، ')]));
      }
      if (times.length) {
        panel.append(el('details', { class: 'episode-times' }, [
          el('summary', {}, [T.episodeTimes]),
          ...times.map(function (pair) { return el('p', {}, [T.epWord + ' ' + fa(pair[0]) + ' · ' + pair[1].replace(/^(\\d+) min$/, function (_, n) { return fa(n) + ' دقیقه'; })]); }),
        ]));
      }
      if (s.selectable || times.length) block.append(panel);
      else block.append(el('div', { class: 'season' }, [
        el('span', { class: 'season-name' }, [T.seasonN + ' ' + fa(s.season)]),
        description.length ? el('span', { class: 'season-info' }, [' · ' + description.join(' · ')]) : '',
      ]));
    });
    edit.hidden = !chosen[f.k] || !rows.length;
    edit.onclick = function () { rows[0].panel.open = true; rows[0].summary.focus(); };
    if (!rows.length) return block;

    function update() {
      var selection = { seasons: [], episodes: {} }, invalid = null;
      rows.forEach(function (row) {
        if (row.whole.checked) selection.seasons.push(row.season);
        if (!row.eps) return;
        var numbers = parseEps(row.eps.value);
        var bad = !!row.eps.value.trim() && (!numbers.length || numbers.some(function (n) { return !row.available.includes(n); }));
        row.eps.setCustomValidity(bad ? T.invalidEpisodes : '');
        if (bad) invalid = invalid || row;
        else if (numbers.length && !row.whole.checked) selection.episodes[row.season] = numbers;
      });
      var include = !!(selection.seasons.length || Object.keys(selection.episodes).length);
      var next = selection.seasons.length === rows.length ? null : selection;
      var before = JSON.stringify(sel[f.k] || null);
      var picked = !!chosen[f.k];
      var same = picked === include && (!include || before === JSON.stringify(next));
      label(picked ? (same && !invalid ? T.inList : include ? T.updatePick : T.remove) : T.addToList, !invalid && (same || (!picked && !include)));
      $('detailAdd').onclick = function () {
        if (invalid) { invalid.panel.open = true; invalid.eps.reportValidity(); return; }
        if (same) return;
        setChoice(f, include, next);
        edit.hidden = !include;
        update();
      };
    }
    update();
    return block;
  }
  function load() {
    loadPrices();
    fetch('/api/films?lang=' + T.lang).then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); }).then(function (list) {
      films = list.map(function (f) { f._n = norm([f.t, f.f || ''].concat(f.a || []).join(' ') + ' ' + (f.y || '')); return f; });
      filmByKey = new Map(films.map(function (f) { return [f.k, f]; }));
      var kinds = [['', T.all]];
      ['movie', 'series', 'animation', 'anime'].forEach(function (k) { if (films.some(function (f) { return f.kd === k; })) kinds.push([k, T[k]]); });
      chips($('kinds'), kinds, function (v) { return kind === v; }, function (v) { kind = v; });
      var count = {};
      films.forEach(function (f) { f.g.forEach(function (g) { count[g] = (count[g] || 0) + 1; }); });
      var gs = [['', T.all]].concat(Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).map(function (g) { return [g, g]; }));
      chips($('genres'), gs, function (v) { return v ? genres.has(v) : !genres.size; }, function (v) {
        if (!v) genres.clear(); else if (genres.has(v)) genres.delete(v); else genres.add(v);
      });
      try { JSON.parse(store('pick') || '[]').forEach(function (k) { var f = filmByKey.get(k); if (f) chosen[k] = f; }); } catch (e) { /* nothing saved */ }
      try { var old = JSON.parse(store('sel') || '{}'); Object.keys(old).forEach(function (k) { if (chosen[k]) sel[k] = old[k]; }); } catch (e) { /* nothing saved */ }
      catalogReady = true;
      render();
      if (window.location?.hash.startsWith('#title=')) showRoute();
    }).catch(function () {
      var g = $('grid');
      var retry = el('button', { type: 'button', 'class': 'chip' }, [T.retry]);
      retry.onclick = load;
      g.replaceChildren(el('div', { 'class': 'wide' }, [el('span', {}, [T.loadFail]), retry]));
    });
  }
  ['sortNew', 'sortRating', 'sortYear', 'sortName'].forEach(function (k) { $('sort').append(el('option', { value: k }, [T[k]])); });
  $('sort').onchange = function () { shown = PAGE; render(); };
  var typing = 0;
  $('q').addEventListener('input', function () { clearTimeout(typing); typing = setTimeout(function () { shown = PAGE; render(); }, 150); });
  $('name').value = store('name') || '';
  $('phone').value = store('phone') || '';
  $('note').value = store('wishNote') || '';
  function listBox() {
    var ul = $('mine');
    ul.replaceChildren();
    syncSend();
    Object.keys(chosen).forEach(function (k) {
      var x = el('button', { type: 'button', 'aria-label': T.remove }, ['×']);
      x.onclick = function () { delete chosen[k]; delete sel[k]; save(); render(); if (Object.keys(chosen).length || wishId) listBox(); else $('dlg').close(); };
      var what = selText(k);
      var cost = hasPrice() ? el('span', { 'class': 'price' }, [money(priceOfCounts(itemCounts(k)))]) : '';
      ul.append(el('li', { 'class': 'row' }, [el('span', { dir: 'auto' }, [chosen[k].f ? chosen[k].f + ' (' + chosen[k].t + ')' : chosen[k].t, what ? el('small', { style: 'display:block;color:var(--muted)' }, [what]) : '']), cost, x]));
    });
    // the price by kind, so the customer sees how it is made up
    var c = totals();
    var lines = [];
    if (hasPrice()) {
      if (c.movies) lines.push(fa(c.movies) + ' ' + T.movie + ' × ' + money(P.movie) + ' = ' + money(c.movies * P.movie));
      if (c.seasons) lines.push(fa(c.seasons) + ' ' + T.seasonN + ' ' + T.series + ' × ' + money(P.season) + ' = ' + money(c.seasons * P.season));
      if (c.episodes) lines.push(fa(c.episodes) + ' ' + T.epWord + ' × ' + money(P.episode) + ' = ' + money(c.episodes * P.episode));
      lines.push(T.total + ': ' + money(priceOfCounts(c)));
    }
    $('sum').replaceChildren.apply($('sum'), lines.map(function (l, i) { return el(i === lines.length - 1 ? 'b' : 'span', {}, [l]); }));
  }
  function showReference() {
    $('msg').textContent = wishId ? T.receipt + ' ' + fa(wishId) : '';
    $('msg').className = 'msg';
  }
  $('form').addEventListener('input', function () { syncSend(); showReference(); });
  $('open').onclick = $('detailCart').onclick = function () { listBox(); showReference(); $('dlg').showModal(); };
  $('close').onclick = function () { $('dlg').close(); };
  $('dlg').addEventListener('close', function () { if (activeDetail) renderTitle(activeDetail); });
  $('clearAll').onclick = function () { chosen = {}; sel = {}; save(); render(); if (wishId) listBox(); else $('dlg').close(); };
  $('form').onsubmit = function (ev) {
    ev.preventDefault();
    var body = draft(), snapshot = signature(body);
    if (sending || (wishId && snapshot === lastSent)) return;
    body.editKey = browserEditKey();
    sending = true;
    syncSend();
    store('name', $('name').value); store('phone', $('phone').value); store('wishNote', $('note').value);
    fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return [r.status, j]; });
    }).then(function (a) {
      sending = false;
      if (a[0] === 200 && a[1].ok && a[1].id) {
        var edited = wishId === a[1].id;
        wishId = a[1].id;
        store('wishId', String(wishId));
        lastSent = snapshot;
        store('wishSnapshot', lastSent);
        listBox(); render();
        $('msg').className = 'msg'; $('msg').textContent = (edited ? T.updated : T.done) + ' ' + wishId + ' · ' + T.doneNote;
      } else {
        $('msg').className = 'msg bad'; $('msg').textContent = a[0] === 429 ? T.slow : a[0] === 503 ? T.full : T.fail;
        syncSend();
      }
    }, function () { sending = false; $('msg').className = 'msg bad'; $('msg').textContent = T.fail; syncSend(); });
  };
  load();
}());
</script>
</body>
</html>`;
}

module.exports = { pageHtml };

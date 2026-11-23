'use strict';

const TEXT = {
  fa: {
    dir: 'rtl', lang: 'fa', other: 'English', otherLang: 'en', title: 'کاتالوگ فیلم و سریال', search: 'اسم فیلم، بازیگر یا کارگردان…',
    all: 'همه', movie: 'فیلم', series: 'سریال', animation: 'انیمیشن', anime: 'انیمه', pick: 'انتخاب', picked: 'انتخاب شد', send: 'ارسال لیست', mine: 'لیست من',
    name: 'اسم شما', phone: 'شماره تماس (اختیاری)', note: 'توضیح (اختیاری)', submit: 'ارسال', close: 'بستن', remove: 'حذف از لیست',
    done: 'لیستت ثبت شد. شمارهٔ پیگیری:', fail: 'ارسال نشد. بعداً دوباره امتحان کن.', slow: 'چند بار پشت هم فرستادی. چند دقیقه بعد دوباره امتحان کن.',
    full: 'الان لیست جدید قبول نمی‌کنیم. به مغازه بگو.', none: 'چیزی پیدا نشد.', more: 'نمایش بیشتر', loadFail: 'کاتالوگ باز نشد. دوباره امتحان کن.', retry: 'تلاش دوباره',
    sortNew: 'تازه‌اضافه‌شده', sortName: 'الفبا', sortRating: 'امتیاز', sortYear: 'سال', sort: 'مرتب‌سازی', seasons: 'فصل', stars: 'امتیاز',
    askTitle: 'پیدا نکردی؟', askText: 'اسم فیلم رو بنویس تا برات تهیه کنیم.', askGo: 'درخواست', askThanks: 'ثبت شد. اگه تهیه کردیم بهت خبر می‌دیم.',
    askHave: 'این فیلم توی آرشیو هست:', empty: 'کاتالوگ هنوز خالیه.',
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
:root { --bg: #eceff5; --card: #fff; --ink: #141925; --muted: #586276; --accent: #3a46d6; --line: #dde2ec; --ok: #1f7a52; }
@media (prefers-color-scheme: dark) { :root { --bg: #11141c; --card: #1a1f2b; --ink: #eef0f6; --muted: #a2abbd; --accent: #8b95ff; --line: #2a3142; --ok: #5fd39a; } }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.5 "Vazirmatn", system-ui, Tahoma, sans-serif; background: var(--bg); color: var(--ink); padding-bottom: 6rem; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); padding: 0.6rem 1rem 0.6rem; border-bottom: 1px solid var(--line); }
.filters { padding: 0 1rem; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.3rem; }
h1 { font-size: 1.1rem; margin: 0; }
a.lang { color: var(--accent); text-decoration: none; font-size: 0.9rem; padding: 0.4rem 0.2rem; }
input, textarea, select, button { font-family: inherit; }
input, textarea, select { width: 100%; font: inherit; padding: 0.65rem 0.8rem; min-height: 44px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.tools { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.tools select { flex: 1; }
.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.5rem 0 0; scrollbar-width: none; }
.chip { flex: none; min-height: 40px; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 0.2rem 0.9rem; font: inherit; font-size: 0.9rem; }
.chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.8rem; padding: 1rem; }
.film { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.film .img { aspect-ratio: 2 / 3; background: var(--line); display: grid; place-items: center; text-align: center; padding: 0.5rem; color: var(--muted); }
.film img { width: 100%; height: 100%; object-fit: cover; display: block; }
.film .body { padding: 0.5rem 0.6rem 0.6rem; display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
.film b { font-size: 0.95rem; line-height: 1.35; }
.film small { color: var(--muted); font-size: 0.8rem; }
.film button { margin-top: auto; min-height: 44px; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 8px; padding: 0.35rem; font: inherit; font-size: 0.9rem; }
.film.on { border-color: var(--accent); }
.film.on button { background: var(--accent); color: #fff; }
.bar { position: fixed; inset-inline: 0; bottom: 0; padding: 0.7rem 1rem; background: var(--bg); border-top: 1px solid var(--line); display: none; }
.bar.show { display: block; }
.big { width: 100%; min-height: 48px; padding: 0.75rem; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 700; }
.big:disabled { opacity: 0.6; }
.quiet { background: transparent; color: var(--muted); }
dialog { width: min(92vw, 440px); max-height: 92vh; overflow: auto; border: 0; border-radius: 16px; background: var(--card); color: var(--ink); padding: 1rem; }
dialog::backdrop { background: rgba(0,0,0,.5); }
form { display: grid; gap: 0.6rem; }
ul { margin: 0; padding: 0; list-style: none; max-height: 30vh; overflow: auto; }
li.row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.2rem 0; }
li.row button { flex: none; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: var(--muted); font-size: 1.2rem; }
.msg { color: var(--ok); font-weight: 600; margin: 0; }
.msg.bad { color: #d83a2b; }
.wide { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 1.2rem 0; display: grid; gap: 0.6rem; justify-items: center; }
.wide .ask { width: 100%; max-width: 420px; text-align: start; display: grid; gap: 0.5rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem; color: var(--ink); }
.wide .ask p { margin: 0; }
.wide .ask button { min-height: 44px; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 10px; font: inherit; }
</style>
</head>
<body>
<header>
  <div class="top"><h1>${x.title}</h1></div>
  <input id="q" type="search" placeholder="${x.search}" autocomplete="off" aria-label="${x.search}">
</header>
<section class="filters">
  <div class="chips" id="kinds" role="group"></div>
  <div class="tools"><select id="sort" aria-label="${x.sort}"></select></div>
  <div class="chips" id="genres" role="group"></div>
</section>
<main id="grid"></main>
<div class="bar" id="bar"><button id="open" class="big" type="button"></button></div>
<dialog id="dlg">
  <form id="form" method="dialog">
    <h2 style="margin:0;font-size:1.05rem">${x.mine}</h2>
    <ul id="mine"></ul>
    <input id="name" maxlength="80" placeholder="${x.name}" aria-label="${x.name}" autocomplete="name" required>
    <input id="phone" maxlength="30" inputmode="tel" placeholder="${x.phone}" aria-label="${x.phone}" autocomplete="tel">
    <textarea id="note" maxlength="200" rows="2" placeholder="${x.note}" aria-label="${x.note}"></textarea>
    <p class="msg" id="msg" role="status"></p>
    <button type="submit" id="submit" class="big">${x.submit}</button>
    <button type="button" id="close" class="big quiet">${x.close}</button>
  </form>
</dialog>
<script>
(function () {
  var T = ${client};
  var PAGE = 60;
  var films = [], kind = '', genre = '', shown = PAGE, chosen = {};
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
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private mode */ } return null; }
  var SORTS = {
    sortNew: function (a, b) { return b.o - a.o; },
    sortName: function (a, b) { return (a.f || a.t).localeCompare(b.f || b.t, 'fa'); },
    sortRating: function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); },
    sortYear: function (a, b) { return (parseInt(b.y, 10) || 0) - (parseInt(a.y, 10) || 0); }
  };
  function visible() {
    var words = norm($('q').value).split(' ').filter(Boolean);
    var list = films.filter(function (f) {
      return (!kind || f.kd === kind) && (!genre || f.g.indexOf(genre) >= 0) && words.every(function (w) { return f._n.indexOf(w) >= 0; });
    });
    return list.sort(function (a, b) { return SORTS[$('sort').value](a, b) || (a.f || a.t).localeCompare(b.f || b.t, 'fa'); });
  }
  function askBox(prefill) {
    var input = el('input', { maxlength: '100', 'aria-label': T.askText, placeholder: T.askText });
    input.value = prefill;
    var out = el('p', { 'class': 'msg', role: 'status' });
    var go = el('button', { type: 'button' }, [T.askGo]);
    go.onclick = function () {
      if (!input.value.trim()) return;
      go.disabled = true;
      fetch('/api/ask', { method: 'POST', body: JSON.stringify({ name: input.value }) }).then(function (r) { return r.json().then(function (j) { return [r.status, j]; }); }).then(function (a) {
        out.className = 'msg' + (a[0] === 200 ? '' : ' bad');
        if (a[0] === 200) out.textContent = a[1].inArchive.length ? T.askHave + ' ' + a[1].inArchive.join('، ') : T.askThanks;
        else out.textContent = a[0] === 429 ? T.slow : T.fail;
        go.disabled = false;
      }, function () { out.className = 'msg bad'; out.textContent = T.fail; go.disabled = false; });
    };
    return el('div', { 'class': 'ask' }, [el('b', {}, [T.askTitle]), el('p', {}, [T.askText]), input, go, out]);
  }
  function render() {
    var list = visible();
    var grid = $('grid');
    grid.replaceChildren();
    list.slice(0, shown).forEach(function (f) {
      var on = !!chosen[f.k];
      var img = f.p ? el('img', { src: '/poster/' + encodeURIComponent(f.k), alt: '', loading: 'lazy' }) : el('span', {}, [f.f || f.t]);
      var tags = f.b.map(function (b) { return T.badge[b] || b; });
      if (f.s) tags.unshift(f.s + ' ' + T.seasons);
      var meta = [f.y, f.r ? '★ ' + f.r : ''].concat(tags).filter(Boolean).join(' · ');
      var card = el('div', { 'class': 'film' + (on ? ' on' : '') }, [
        el('div', { 'class': 'img' }, [img]),
        el('div', { 'class': 'body' }, [el('b', { dir: 'auto' }, [f.f || f.t]), f.f ? el('small', { dir: 'ltr', 'class': 'orig' }, [f.t]) : '', el('small', {}, [meta]), f.d ? el('small', { dir: 'auto' }, [f.d]) : '',
          el('button', { type: 'button', 'aria-pressed': String(on) }, [on ? T.picked : T.pick])])]);
      card.querySelector('button').onclick = function () { if (chosen[f.k]) delete chosen[f.k]; else chosen[f.k] = f; save(); render(); };
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
    $('bar').className = 'bar' + (n ? ' show' : '');
    $('open').textContent = T.send + ' (' + n + ')';
  }
  function save() { store('pick', JSON.stringify(Object.keys(chosen))); }
  function chips(box, items, current, set) {
    box.replaceChildren();
    items.forEach(function (it) {
      var b = el('button', { 'class': 'chip', type: 'button', 'aria-pressed': String(current() === it[0]) }, [it[1]]);
      b.onclick = function () { set(it[0]); chips(box, items, current, set); shown = PAGE; render(); };
      box.append(b);
    });
  }
  function load() {
    fetch('/api/films?lang=' + T.lang).then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); }).then(function (list) {
      films = list.map(function (f) { f._n = norm([f.t, f.f || ''].concat(f.a || []).join(' ') + ' ' + (f.y || '')); return f; });
      var kinds = [['', T.all]];
      ['movie', 'series', 'animation', 'anime'].forEach(function (k) { if (films.some(function (f) { return f.kd === k; })) kinds.push([k, T[k]]); });
      chips($('kinds'), kinds, function () { return kind; }, function (v) { kind = v; });
      var count = {};
      films.forEach(function (f) { f.g.forEach(function (g) { count[g] = (count[g] || 0) + 1; }); });
      var gs = [['', T.all]].concat(Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 24).map(function (g) { return [g, g]; }));
      chips($('genres'), gs, function () { return genre; }, function (v) { genre = v; });
      try { JSON.parse(store('pick') || '[]').forEach(function (k) { var f = films.filter(function (x) { return x.k === k; })[0]; if (f) chosen[k] = f; }); } catch (e) { /* nothing saved */ }
      render();
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
  function listBox() {
    var ul = $('mine');
    ul.replaceChildren();
    Object.keys(chosen).forEach(function (k) {
      var x = el('button', { type: 'button', 'aria-label': T.remove }, ['×']);
      x.onclick = function () { delete chosen[k]; save(); render(); if (Object.keys(chosen).length) listBox(); else $('dlg').close(); };
      ul.append(el('li', { 'class': 'row' }, [el('span', { dir: 'auto' }, [chosen[k].f ? chosen[k].f + ' (' + chosen[k].t + ')' : chosen[k].t]), x]));
    });
  }
  $('open').onclick = function () { listBox(); $('msg').textContent = ''; $('msg').className = 'msg'; $('dlg').showModal(); };
  $('close').onclick = function () { $('dlg').close(); };
  $('form').onsubmit = function (ev) {
    ev.preventDefault();
    var sendBtn = $('submit');
    sendBtn.disabled = true;
    var body = { name: $('name').value, phone: $('phone').value, note: $('note').value, keys: Object.keys(chosen) };
    store('name', $('name').value); store('phone', $('phone').value);
    fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return [r.status, j]; });
    }).then(function (a) {
      if (a[0] === 200) {
        chosen = {}; save(); render(); $('mine').replaceChildren(); $('note').value = '';
        $('msg').className = 'msg'; $('msg').textContent = T.done + ' ' + a[1].id;
        setTimeout(function () { sendBtn.disabled = false; }, 4000);
      } else {
        $('msg').className = 'msg bad'; $('msg').textContent = a[0] === 429 ? T.slow : a[0] === 503 ? T.full : T.fail;
        sendBtn.disabled = false;
      }
    }, function () { $('msg').className = 'msg bad'; $('msg').textContent = T.fail; sendBtn.disabled = false; });
  };
  load();
}());
</script>
</body>
</html>`;
}

module.exports = { pageHtml };

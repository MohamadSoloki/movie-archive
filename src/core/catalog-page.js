'use strict';

const TEXT = {
  fa: {
    dir: 'rtl', title: 'کاتالوگ فیلم و سریال', search: 'جستجوی اسم فیلم…', all: 'همه', pick: 'انتخاب', picked: 'انتخاب شد',
    send: 'ارسال لیست', mine: 'لیست من', name: 'اسم شما', phone: 'شماره تماس (اختیاری)', note: 'توضیح (اختیاری)',
    submit: 'ارسال', close: 'بستن', done: 'لیستت ثبت شد. منتظر تماس بمون.', fail: 'ارسال نشد. بعداً دوباره امتحان کن.',
    slow: 'چند لیست پشت هم فرستادی. چند دقیقه بعد دوباره امتحان کن.', none: 'چیزی پیدا نشد.', count: 'مورد',
  },
  en: {
    dir: 'ltr', title: 'Film and series catalog', search: 'Search by name…', all: 'All', pick: 'Choose', picked: 'Chosen',
    send: 'Send list', mine: 'My list', name: 'Your name', phone: 'Phone (optional)', note: 'Note (optional)',
    submit: 'Send', close: 'Close', done: 'Your list was sent. We will get back to you.', fail: 'Could not send. Try again later.',
    slow: 'Too many lists in a row. Try again in a few minutes.', none: 'Nothing found.', count: 'items',
  },
};

// One self-contained page: no outside files, so it works on a shop network with no internet.
function pageHtml(lang) {
  const x = TEXT[lang] ?? TEXT.fa;
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'fa'}" dir="${x.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${x.title}</title>
<style>
:root { --bg: #eceff5; --card: #fff; --ink: #141925; --muted: #586276; --accent: #3a46d6; --line: #dde2ec; }
@media (prefers-color-scheme: dark) { :root { --bg: #11141c; --card: #1a1f2b; --ink: #eef0f6; --muted: #9aa3b5; --accent: #8b95ff; --line: #2a3142; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, Tahoma, sans-serif; background: var(--bg); color: var(--ink); padding-bottom: 5rem; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); padding: 0.75rem 1rem 0.5rem; border-bottom: 1px solid var(--line); }
h1 { font-size: 1.1rem; margin: 0 0 0.5rem; }
input, textarea { width: 100%; font: inherit; padding: 0.6rem 0.8rem; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.5rem 0 0; scrollbar-width: none; }
.chip { flex: none; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 0.25rem 0.8rem; font: inherit; font-size: 0.85rem; }
.chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.8rem; padding: 1rem; }
.film { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.film .img { aspect-ratio: 2 / 3; background: var(--line); display: grid; place-items: center; text-align: center; padding: 0.5rem; color: var(--muted); }
.film img { width: 100%; height: 100%; object-fit: cover; display: block; }
.film .body { padding: 0.5rem 0.6rem 0.6rem; display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
.film b { font-size: 0.92rem; line-height: 1.3; }
.film small { color: var(--muted); }
.film button { margin-top: auto; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 8px; padding: 0.35rem; font: inherit; font-size: 0.85rem; }
.film.on button { background: var(--accent); color: #fff; }
.bar { position: fixed; inset-inline: 0; bottom: 0; padding: 0.7rem 1rem; background: var(--bg); border-top: 1px solid var(--line); display: none; }
.bar.show { display: block; }
.bar button, form button { width: 100%; padding: 0.75rem; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 700; }
dialog { width: min(92vw, 420px); border: 0; border-radius: 16px; background: var(--card); color: var(--ink); padding: 1rem; }
dialog::backdrop { background: rgba(0,0,0,.5); }
form { display: grid; gap: 0.6rem; }
ul { margin: 0; padding-inline-start: 1.1rem; max-height: 30vh; overflow: auto; }
.msg { color: var(--accent); font-weight: 600; margin: 0; }
.empty { grid-column: 1 / -1; color: var(--muted); text-align: center; padding: 2rem 0; }
</style>
</head>
<body>
<header>
  <h1>${x.title}</h1>
  <input id="q" type="search" placeholder="${x.search}" autocomplete="off" aria-label="${x.search}">
  <div class="chips" id="genres"></div>
</header>
<main id="grid"></main>
<div class="bar" id="bar"><button id="open" type="button"></button></div>
<dialog id="dlg">
  <form id="form" method="dialog">
    <h2 style="margin:0;font-size:1.05rem">${x.mine}</h2>
    <ul id="mine"></ul>
    <input id="name" maxlength="80" placeholder="${x.name}" aria-label="${x.name}" required>
    <input id="phone" maxlength="30" inputmode="tel" placeholder="${x.phone}" aria-label="${x.phone}">
    <textarea id="note" maxlength="200" rows="2" placeholder="${x.note}" aria-label="${x.note}"></textarea>
    <p class="msg" id="msg" role="status"></p>
    <button type="submit" id="submit">${x.submit}</button>
    <button type="button" id="close" style="background:transparent;color:var(--muted)">${x.close}</button>
  </form>
</dialog>
<script>
(function () {
  var T = ${JSON.stringify({ none: x.none, pick: x.pick, picked: x.picked, send: x.send, all: x.all, done: x.done, fail: x.fail, slow: x.slow, count: x.count })};
  var films = [], genre = '', chosen = {};
  var $ = function (id) { return document.getElementById(id); };
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[آأإ]/g, 'ا')
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 1776; }).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; })
      .replace(/[\\u200c\\u0640\\u064b-\\u065f]/g, '').replace(/\\s+/g, ' ').trim();
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { e.append(c); });
    return e;
  }
  function render() {
    var q = norm($('q').value);
    var shown = films.filter(function (f) {
      return (!genre || f.g.indexOf(genre) >= 0) && (!q || f._n.indexOf(q) >= 0);
    });
    var grid = $('grid');
    grid.replaceChildren();
    if (!shown.length) grid.append(el('p', { 'class': 'empty' }, [T.none]));
    shown.slice(0, 300).forEach(function (f) {
      var on = !!chosen[f.k];
      var img = f.p ? el('img', { src: '/poster/' + encodeURIComponent(f.k), alt: '', loading: 'lazy' }) : el('span', {}, [f.t]);
      var card = el('div', { 'class': 'film' + (on ? ' on' : '') }, [
        el('div', { 'class': 'img' }, [img]),
        el('div', { 'class': 'body' }, [el('b', { dir: 'auto' }, [f.t]), el('small', {}, [[f.y, f.b.join(' · ')].filter(Boolean).join(' · ')]),
          el('button', { type: 'button' }, [on ? T.picked : T.pick])])]);
      card.querySelector('button').onclick = function () { if (chosen[f.k]) delete chosen[f.k]; else chosen[f.k] = f; save(); render(); };
      grid.append(card);
    });
    var n = Object.keys(chosen).length;
    $('bar').className = 'bar' + (n ? ' show' : '');
    $('open').textContent = T.send + ' (' + n + ')';
  }
  function save() { try { localStorage.setItem('pick', JSON.stringify(Object.keys(chosen))); } catch (e) { /* private mode */ } }
  fetch('/api/films').then(function (r) { return r.json(); }).then(function (list) {
    films = list.map(function (f) { f._n = norm([f.t].concat(f.a || []).join(' ')); return f; });
    var count = {};
    films.forEach(function (f) { f.g.forEach(function (g) { count[g] = (count[g] || 0) + 1; }); });
    var box = $('genres');
    var mk = function (label, g) {
      var b = el('button', { 'class': 'chip', type: 'button', 'aria-pressed': String(genre === g) }, [label]);
      b.onclick = function () { genre = g; Array.prototype.forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); render(); };
      return b;
    };
    box.append(mk(T.all, ''));
    Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 20).forEach(function (g) { box.append(mk(g, g)); });
    box.firstChild.setAttribute('aria-pressed', 'true');
    try { JSON.parse(localStorage.getItem('pick') || '[]').forEach(function (k) { var f = films.filter(function (x) { return x.k === k; })[0]; if (f) chosen[k] = f; }); } catch (e) { /* nothing saved */ }
    render();
  });
  $('q').addEventListener('input', render);
  $('open').onclick = function () {
    $('mine').replaceChildren.apply($('mine'), Object.keys(chosen).map(function (k) { return el('li', { dir: 'auto' }, [chosen[k].t]); }));
    $('msg').textContent = '';
    $('dlg').showModal();
  };
  $('close').onclick = function () { $('dlg').close(); };
  $('form').onsubmit = function (ev) {
    ev.preventDefault();
    var body = { name: $('name').value, phone: $('phone').value, note: $('note').value, keys: Object.keys(chosen) };
    fetch('/api/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 200) { chosen = {}; save(); render(); $('msg').textContent = T.done; $('mine').replaceChildren(); $('submit').disabled = true; setTimeout(function () { $('submit').disabled = false; $('dlg').close(); }, 2500); }
      else $('msg').textContent = r.status === 429 ? T.slow : T.fail;
    }, function () { $('msg').textContent = T.fail; });
  };
}());
</script>
</body>
</html>`;
}

module.exports = { pageHtml };

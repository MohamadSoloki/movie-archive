'use strict';
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const state = { lang: 'fa', entries: [], selected: null, query: '', shown: 0 };
  const t = (key, vars) => window.i18n.t(state.lang, key, vars);
  const CHUNK = 200;

  // Builds DOM with textContent only, so titles and plots from the web can never inject markup.
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const setStatus = (text) => { $('status').textContent = text; };

  function errText(code) {
    switch (code) {
      case 'invalid_link': return t('err_invalid_link');
      case 'not_found': return t('err_not_found');
      case 'quota': return t('err_quota');
      case 'bad_key': return t('err_bad_key');
      case 'network': return t('err_network');
      case 'no_drive': return t('err_no_drive');
      default: return String(code);
    }
  }

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
    document.title = t('app_title');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    $('lang').textContent = t('lang_toggle');
  }

  // ---- archive grid ----------------------------------------------------

  function flagsOf(e) {
    const flags = [];
    const present = e.locations.filter((l) => !l.missing);
    if (!present.length) flags.push({ cls: 'missing', text: t('badge_missing') });
    if (e.status === 'review') flags.push({ cls: 'review', text: t('badge_review') });
    if (e.status === 'pending') flags.push({ cls: 'pending', text: t('badge_pending') });
    if (e.guessed) flags.push({ cls: 'guessed', text: t('badge_guessed') });
    if (present.some((l) => l.isEmpty)) flags.push({ cls: 'empty', text: t('badge_empty') });
    if (present.length && present.every((l) => !l.online)) flags.push({ cls: 'offline', text: t('badge_offline') });
    return flags;
  }

  const posterUrl = (file) => `poster://x/${encodeURIComponent(file)}`;

  function posterEl(e) {
    return e.posterFile
      ? h('img', { class: 'poster', src: posterUrl(e.posterFile), alt: '', loading: 'lazy' })
      : h('div', { class: 'poster none' }, h('span', {}, e.title));
  }

  function card(e) {
    const first = flagsOf(e)[0];
    return h('button', {
      class: `card s-${first ? first.cls : 'ok'}${state.selected === e.key ? ' sel' : ''}`,
      type: 'button',
      'data-key': e.key,
      onclick: () => select(e.key),
    },
    posterEl(e),
    h('span', { class: 'name' }, e.title),
    e.year ? h('span', { class: 'year' }, e.year) : null,
    first ? h('span', { class: 'flag' }, first.text) : null);
  }

  function appendChunk() {
    const next = state.entries.slice(state.shown, state.shown + CHUNK);
    $('grid').append(...next.map(card));
    state.shown += next.length;
  }

  function renderGrid() {
    $('grid').replaceChildren();
    state.shown = 0;
    appendChunk();
    $('count').textContent = t('count', { n: state.entries.length });
    $('empty').textContent = state.entries.length ? '' : (state.query ? t('no_results') : t('empty_archive'));
  }

  async function refresh() {
    state.entries = await api.getEntries(state.query);
    if (state.selected && !state.entries.some((e) => e.key === state.selected)) state.selected = null;
    renderGrid();
    renderDetail();
  }

  function select(key) {
    state.selected = key;
    for (const c of document.querySelectorAll('.card')) c.classList.toggle('sel', c.dataset.key === key);
    renderDetail();
  }

  // ---- detail panel ----------------------------------------------------

  function locationRow(l) {
    const notes = [];
    if (l.season) notes.push(t('season_n', { n: Number(l.season) }));
    if (l.missing) notes.push(t('badge_missing'));
    else {
      if (l.isEmpty) notes.push(t('badge_empty'));
      if (!l.online) notes.push(t('badge_offline'));
    }
    return h('li', { class: 'loc' },
      h('span', { class: `led ${l.online ? 'on' : 'off'}` }),
      h('span', { class: 'where' }, `${l.driveLabel || l.driveSerial} `, h('span', { class: 'path' }, l.relPath)),
      notes.length ? h('span', { class: 'note' }, notes.join('، ')) : null);
  }

  function fixSection(e) {
    const target = e.titleId != null ? { titleId: e.titleId } : { locationId: e.locationId };
    const input = h('input', { type: 'text', dir: 'ltr', placeholder: t('fix_placeholder'), 'aria-label': t('online_info_fix') });
    const msg = h('p', { class: 'msg', role: 'alert' });
    const form = h('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        if (!input.value.trim()) return;
        const r = await api.applyFix(target, input.value);
        if (!r.ok) { msg.textContent = errText(r.error); return; }
        state.selected = `t:${r.titleId}`;
        setStatus(t('fix_done'));
        await refresh();
      },
    }, input, h('button', { type: 'submit', class: 'primary' }, t('fix_apply')));
    return h('section', { class: 'fix' },
      h('h3', {}, t('online_info_fix')), h('p', { class: 'help' }, t('fix_help')), form, msg);
  }

  function candidatesSection(e) {
    // the typed search is for folders OMDb cannot read, e.g. a Persian name: type the English title
    const input = h('input', { type: 'text', dir: 'ltr', placeholder: t('candidates_search_ph'), 'aria-label': t('candidates_search') });
    const list = h('div', {});
    const box = h('section', { class: 'cands' }, h('h3', {}, t('candidates_title')),
      h('form', { onsubmit: (ev) => { ev.preventDefault(); load(input.value); } },
        input, h('button', { type: 'submit' }, t('candidates_search'))), list);
    function load(query) {
      api.getCandidates(e.locationId, query).then((r) => {
        if (state.selected !== e.key) return;
        list.replaceChildren();
        if (!r.ok) { list.append(h('p', { class: 'msg' }, errText(r.error))); return; }
        if (!r.candidates.length) { list.append(h('p', { class: 'help' }, t('candidates_none'))); return; }
        for (const c of r.candidates) {
          list.append(h('div', { class: 'cand' },
            h('span', {}, `${c.title} ${c.year}`),
            h('button', {
              type: 'button',
              onclick: async () => {
                const p = await api.pickCandidate(e.locationId, c.imdbId);
                if (!p.ok) { list.append(h('p', { class: 'msg' }, errText(p.error))); return; }
                state.selected = `t:${p.titleId}`;
                setStatus(t('fix_done'));
                await refresh();
              },
            }, t('candidates_use'))));
        }
      });
    }
    load('');
    return box;
  }

  function renderDetail() {
    const d = $('detail');
    const e = state.entries.find((x) => x.key === state.selected);
    if (!e) { d.hidden = true; d.replaceChildren(); return; }
    d.hidden = false;
    const facts = [[t('rating'), e.rating], [t('runtime'), e.runtime], [t('genres'), e.genres], [t('actors'), e.actors]]
      .filter(([, v]) => v);
    // dir="auto": English titles and plots from OMDb stay left-to-right inside the right-to-left Persian UI
    d.replaceChildren(...[
      h('button', { class: 'close', type: 'button', 'aria-label': t('close'), onclick: () => select(null) }, '×'),
      posterEl(e),
      h('h2', { dir: 'auto' }, e.title),
      h('p', { class: 'sub', dir: 'auto' }, [e.year, e.type].filter(Boolean).join(' ')),
      h('ul', { class: 'flags' }, flagsOf(e).map((f) => h('li', {}, f.text))),
      h('dl', { class: 'facts' }, facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { dir: 'auto' }, v)])),
      h('h3', {}, t('plot')),
      h('p', { class: 'plot', dir: 'auto' }, e.plot || t('no_plot')),
      h('h3', {}, t('locations')),
      h('ul', { class: 'plain' }, e.locations.map(locationRow)),
      e.titleId == null && e.status === 'review' ? candidatesSection(e) : null,
      fixSection(e),
    ].filter(Boolean));
  }

  // ---- drives and folders ----------------------------------------------

  async function renderRail() {
    const [drives, roots] = await Promise.all([api.getDrives(), api.getRoots()]);
    $('drives').replaceChildren(...(drives.length
      ? drives.map((d) => h('li', { class: 'drive' },
        h('span', { class: `led ${d.online ? 'on' : 'off'}` }),
        h('span', {}, d.label || d.serial),
        h('span', { class: 'dstate' }, d.online ? t('drive_online') : t('drive_offline')),
        h('span', { class: 'droot', dir: 'ltr' }, d.root)))
      : [h('li', { class: 'none' }, t('no_drives'))]));
    $('roots').replaceChildren(...(roots.length
      ? roots.map((r) => h('li', { class: 'root' },
        h('span', { class: 'rpath' }, `${r.driveLabel} `, h('span', { class: 'path', dir: 'ltr' }, `/${r.relPath}`)),
        h('button', {
          type: 'button',
          onclick: async () => {
            if (!window.confirm(t('confirm_remove'))) return;
            await api.removeRoot(r.id);
            await renderRail();
            await refresh();
          },
        }, t('remove'))))
      : [h('li', { class: 'none' }, t('no_folders'))]));
  }

  // ---- actions ---------------------------------------------------------

  function busy(on) {
    $('scan').disabled = on;
    $('fetch').disabled = on;
  }

  $('add-root').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = $('root-path').value.trim();
    if (!p) return;
    const r = await api.addRoot(p);
    $('rail-msg').textContent = r.ok ? '' : errText(r.error);
    if (r.ok) { $('root-path').value = ''; await renderRail(); }
  });

  $('browse').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (p) $('root-path').value = p;
  });

  $('scan').addEventListener('click', async () => {
    busy(true);
    try {
      const r = await api.scan();
      setStatus(t('scan_done', { n: r.scanned }));
      await renderRail();
      await refresh();
    } catch { setStatus(t('err_unexpected')); } finally { busy(false); }
  });

  $('fetch').addEventListener('click', async () => {
    busy(true);
    api.onProgress((p) => setStatus(t('progress', { done: p.processed, left: p.remaining })));
    try {
      const r = await api.startQueue();
      if (r.stoppedBy === 'quota') setStatus(t('stop_quota'));
      else if (r.stoppedBy === 'network') setStatus(t('stop_network'));
      else if (r.stoppedBy === 'bad_key') setStatus(t('err_bad_key'));
      else setStatus(t('fetch_done'));
      await refresh();
    } catch { setStatus(t('err_unexpected')); } finally { busy(false); }
  });

  let timer = null;
  $('q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = $('q').value; refresh(); }, 150);
  });

  $('lang').addEventListener('click', async () => {
    state.lang = state.lang === 'fa' ? 'en' : 'fa';
    await api.setSettings({ language: state.lang });
    applyLang();
    await renderRail();
    renderGrid();
    renderDetail();
  });

  $('settings-btn').addEventListener('click', async () => {
    const s = await api.getSettings();
    $('set-key').value = s.omdbKey;
    $('set-patterns').value = s.patterns.join('\n');
    $('set-ignore').value = s.ignore.join('\n');
    $('set-collections').value = s.collections.join('\n');
    $('settings-dlg').showModal();
  });
  $('settings-cancel').addEventListener('click', () => $('settings-dlg').close());
  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
    await api.setSettings({
      omdbKey: $('set-key').value.trim(),
      patterns: lines('set-patterns'),
      ignore: lines('set-ignore'),
      collections: lines('set-collections'),
    });
    $('settings-dlg').close();
    setStatus(t('saved'));
  });

  new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting) && state.shown < state.entries.length) appendChunk();
  }).observe($('sentinel'));

  (async function init() {
    const s = await api.getSettings();
    state.lang = s.language === 'en' ? 'en' : 'fa';
    applyLang();
    await renderRail();
    await refresh();
  })();
})();

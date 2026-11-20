'use strict';
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const state = { lang: 'fa', entries: [], selected: null, query: '', shown: 0, tab: 'all', genres: [], genreCounts: [], attention: [], attentionCounts: { ok: 0, guess: 0, problem: 0 }, sort: 'name' };
  const t = (key, vars) => window.i18n.t(state.lang, key, vars);
  const genreName = (g) => window.i18n.genreLabel(state.lang, g);
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
      case 'drive_root': return t('err_drive_root');
      case 'not_folder': return t('err_not_folder');
      case 'offline': return t('err_open_offline');
      case 'missing': return t('err_open_missing');
      case 'unknown': return t('err_open_unknown');
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
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  }

  // ---- tabs, filter sheet ------------------------------------------------

  const sameGenre = (a, b) => a.toLowerCase() === b.toLowerCase();
  const hasGenre = (g) => state.genres.some((x) => sameGenre(x, g));
  const SORTS = ['name', 'year', 'rating', 'added'];
  const STATES = [['ok', 'filter_ok'], ['guess', 'filter_guess'], ['problem', 'filter_problem']];

  function toggleGenre(g) {
    state.genres = hasGenre(g) ? state.genres.filter((x) => !sameGenre(x, g)) : [...state.genres, g];
    return refresh();
  }

  function toggleAttention(a) {
    state.attention = state.attention.includes(a) ? state.attention.filter((x) => x !== a) : [...state.attention, a];
    return refresh();
  }

  function clearFilters() {
    state.genres = []; state.attention = [];
    return refresh();
  }

  const dot = (cls, text) => h('span', { class: `dot ${cls}`, role: 'img', 'aria-label': text, title: text });
  const DOT_CLASS = { ok: 'green', guess: 'yellow', problem: 'red' };

  function chip(label, count, pressed, onclick, lead = null) {
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onclick }, lead, label,
      count == null ? null : h('span', { class: 'n' }, String(count)));
  }

  // the small pills under the tabs: what is filtered right now, each removable
  function renderActive() {
    const pills = [
      ...state.attention.map((a) => h('button', { type: 'button', class: 'pill', onclick: () => toggleAttention(a) },
        dot(DOT_CLASS[a], t(STATES.find((s) => s[0] === a)[1])), t(STATES.find((s) => s[0] === a)[1]), ' ×')),
      ...state.genres.map((g) => h('button', { type: 'button', class: 'pill', onclick: () => toggleGenre(g) }, `${genreName(g)} ×`)),
    ];
    const n = state.genres.length + state.attention.length;
    $('filter-badge').hidden = !n;
    $('filter-badge').textContent = String(n);
    $('active').replaceChildren(...pills);
  }

  // the filter page: state of the film, genres and sort order; it applies at once and the button shows the result count
  function renderSheet() {
    $('f-status').replaceChildren(...STATES.map(([key, label]) =>
      chip(t(label), state.attentionCounts[key], state.attention.includes(key), () => toggleAttention(key), dot(DOT_CLASS[key], ''))));
    // a selected genre stays visible even when the current tab has none of it, so it can be switched off
    const shown = [...state.genreCounts];
    for (const g of state.genres) if (!shown.some((c) => sameGenre(c.name, g))) shown.push({ name: g, count: 0 });
    $('f-genres').replaceChildren(...(shown.length
      ? shown.map((c) => chip(genreName(c.name), c.count, hasGenre(c.name), () => toggleGenre(c.name)))
      : [h('p', { class: 'help' }, t('filter_no_genres'))]));
    $('f-sort').replaceChildren(...SORTS.map((s) => h('button', {
      type: 'button', 'aria-pressed': String(state.sort === s), onclick: () => { state.sort = s; refresh(); },
    }, t(`sort_${s}`))));
    $('filter-show').textContent = t('filter_show', { n: state.entries.length });
    $('filter-clear').disabled = !(state.genres.length || state.attention.length);
  }

  function renderFilters() {
    renderActive();
    renderSheet();
  }

  // ---- archive grid ----------------------------------------------------

  function flagsOf(e) {
    const flags = [];
    if (e.kind === 'collection') return flags;
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

  // The dot beside a name: none when the film is verified, yellow when it was guessed, red when it needs attention.
  function dotOf(e) {
    if (e.attention === 'guess') return dot('yellow', t('badge_guessed'));
    if (e.attention !== 'problem') return null;
    const why = flagsOf(e).find((f) => f.cls !== 'guessed' && f.cls !== 'offline');
    return dot('red', why ? why.text : t('badge_review'));
  }

  function card(e) {
    const meta = [e.year, e.rating ? `⭐ ${e.rating}` : null].filter(Boolean).join(' · ');
    return h('button', {
      class: `card a-${e.attention}${state.selected === e.key ? ' sel' : ''}`,
      type: 'button',
      'data-key': e.key,
      onclick: () => select(e.key),
    },
    posterEl(e),
    h('span', { class: 'title-row' }, dotOf(e), h('span', { class: 'name' }, e.title)),
    meta ? h('span', { class: 'year', dir: 'ltr' }, meta) : null,
    e.kind === 'collection' ? h('span', { class: 'flag' }, t('collection_n', { n: e.members.length })) : null,
    e.genreList.length ? h('span', { class: 'tags' }, e.genreList.slice(0, 3).map((g) => h('span', { class: 'tag' }, genreName(g)))) : null);
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
    const filtered = state.query || state.genres.length || state.attention.length || state.tab !== 'all';
    $('empty').textContent = state.entries.length ? '' : (filtered ? t('no_results') : t('empty_archive'));
  }

  async function refresh() {
    const r = await api.getEntries({ query: state.query, tab: state.tab, genres: state.genres, attention: state.attention, sort: state.sort });
    state.entries = r.entries;
    state.genreCounts = r.genres;
    state.attentionCounts = r.attentionCounts;
    renderFilters();
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
    const blocked = !l.online ? t('open_offline') : (l.missing ? t('open_missing') : null);
    return h('li', { class: 'loc' },
      h('span', { class: `led ${l.online ? 'on' : 'off'}` }),
      h('span', { class: 'where' }, `${l.driveLabel || l.driveSerial} `, h('span', { class: 'path' }, l.relPath)),
      notes.length ? h('span', { class: 'note' }, notes.join('، ')) : null,
      h('button', {
        type: 'button', class: 'open', disabled: !!blocked, title: blocked, 'aria-label': `${t('open_folder')}: ${l.relPath}`,
        onclick: async () => {
          const r = await api.openLocation(l.id);
          if (!r.ok) setStatus(errText(r.error));
        },
      }, t('open_folder')));
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

  // Shows the English text at once and swaps in the stored or fresh Persian translation when it arrives.
  // Returns 'quota' when the daily translation limit is gone, so callers can stop asking.
  async function translateInto(el, text, still) {
    const r = await api.translate(text);
    if (!still()) return null;
    if (!r.ok) return r.error;
    el.textContent = r.text;
    return 'done';
  }

  function plotBlock(e) {
    const el = h('p', { class: 'plot', dir: 'auto' }, e.plot || t('no_plot'));
    const note = h('p', { class: 'help' });
    if (e.plot && state.lang === 'fa') {
      translateInto(el, e.plot, () => el.isConnected).then((r) => {
        if (r === 'done') note.textContent = t('plot_translated');
        else if (r === 'quota') note.textContent = t('translate_quota');
      });
    }
    return [el, note];
  }

  function episodeRow(ep) {
    const plot = h('p', { class: `ep-plot${ep.plot ? '' : ' muted'}`, dir: 'auto' }, ep.plot || t('episode_no_plot'));
    return {
      plot, text: ep.plot,
      el: h('li', { class: 'ep' },
        h('span', { class: 'ep-no' }, String(ep.number)),
        h('span', { class: 'ep-name', dir: 'auto' }, ep.name || ''),
        h('span', { class: 'ep-meta' },
          ep.released ? h('span', { class: 'ep-date', dir: 'ltr' }, ep.released) : null,
          ep.rating ? h('span', { class: 'ep-rate' }, ` ⭐ ${ep.rating}`) : null),
        plot),
    };
  }

  function episodesSection(e) {
    const box = h('section', { class: 'episodes' });
    api.getEpisodes(e.titleId).then((seasons) => {
      if (state.selected !== e.key || !box.isConnected || !seasons.length) return;
      let quotaHit = false;
      const lacking = seasons.reduce((n, s) => n + s.episodes.filter((x) => !x.plot).length, 0);
      for (const s of seasons) {
        const rows = s.episodes.map(episodeRow);
        const det = h('details', {}, h('summary', {}, t('season_title', { n: s.season, m: s.episodes.length })), h('ul', { class: 'eps' }, rows.map((r) => r.el)));
        let started = false;
        det.addEventListener('toggle', async () => {
          if (!det.open || started || state.lang !== 'fa') return;
          started = true;
          for (const r of rows) {
            if (!r.text || quotaHit) continue;
            const res = await translateInto(r.plot, r.text, () => det.isConnected);
            if (res === 'quota') { quotaHit = true; box.append(h('p', { class: 'help' }, t('translate_quota'))); }
            if (res !== 'done') break;
          }
        });
        box.append(det);
      }
      if (lacking) box.append(h('p', { class: 'help' }, t('episodes_missing', { n: lacking })));
    });
    return box;
  }

  // A folder that groups several titles: its folder button and the titles inside it.
  function collectionDetail(e) {
    const c = e.collection;
    const blocked = !c.online ? t('open_offline') : (c.missing ? t('open_missing') : null);
    return [
      h('button', { class: 'close', type: 'button', 'aria-label': t('close'), onclick: () => select(null) }, '×'),
      posterEl(e),
      h('h2', { dir: 'auto' }, e.title),
      h('p', { class: 'sub' }, t('collection_n', { n: e.members.length })),
      h('button', {
        type: 'button', class: 'open', disabled: !!blocked, title: blocked,
        onclick: async () => { const r = await api.openCollection(c.driveSerial, c.relPath); if (!r.ok) setStatus(errText(r.error)); },
      }, t('open_folder')),
      h('h3', {}, t('collection_members')),
      h('ul', { class: 'plain members' }, e.members.map((m) => h('li', {}, h('button', { type: 'button', class: 'member', onclick: () => openMember(m.key) },
        h('span', { dir: 'auto' }, m.title), m.year ? h('span', { class: 'year' }, ` ${m.year}`) : null)))),
    ];
  }

  // the member may be hidden by the current tab, genre filter or search, so these are reset first
  async function openMember(key) {
    state.tab = 'all'; state.genres = []; state.attention = []; state.query = ''; $('q').value = '';
    for (const x of document.querySelectorAll('#tabs button')) x.setAttribute('aria-selected', String(x.dataset.tab === 'all'));
    state.selected = key;
    await refresh();
  }

  function renderDetail() {
    const d = $('detail');
    const e = state.entries.find((x) => x.key === state.selected);
    if (!e) { d.hidden = true; d.replaceChildren(); return; }
    d.hidden = false;
    if (e.kind === 'collection') { d.replaceChildren(...collectionDetail(e)); return; }
    const facts = [[t('rating'), e.rating], [t('runtime'), e.runtime], [t('director'), e.director], [t('actors'), e.actors],
      [t('country'), e.country], [t('rated'), e.rated], [t('awards'), e.awards]].filter(([, v]) => v);
    // dir="auto": English titles and plots from OMDb stay left-to-right inside the right-to-left Persian UI
    d.replaceChildren(...[
      h('button', { class: 'close', type: 'button', 'aria-label': t('close'), onclick: () => select(null) }, '×'),
      posterEl(e),
      h('h2', { dir: 'auto' }, e.title),
      h('p', { class: 'sub', dir: 'auto' }, [e.year, e.type].filter(Boolean).join(' ')),
      h('ul', { class: 'flags' }, flagsOf(e).map((f) => h('li', {}, f.text))),
      e.imdbId ? h('button', { type: 'button', class: 'imdb', onclick: () => api.openImdb(e.titleId) }, t('open_imdb')) : null,
      e.genreList.length ? h('div', { class: 'detail-tags', 'aria-label': t('genres') }, e.genreList.map((g) => h('button', {
        type: 'button', class: 'tag', 'aria-pressed': String(hasGenre(g)), onclick: () => toggleGenre(g),
      }, genreName(g)))) : null,
      h('dl', { class: 'facts' }, facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { dir: 'auto' }, v)])),
      h('h3', {}, t('plot')),
      ...plotBlock(e),
      e.titleId != null && e.kind !== 'movie' ? episodesSection(e) : null,
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
        h('span', { class: 'rpath' }, `${r.driveLabel} `, h('span', { class: 'path', dir: 'ltr' }, `/${r.relPath}`), r.single ? h('span', { class: 'tag' }, t('single_tag')) : null),
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

  async function addRoot(single) {
    const p = $('root-path').value.trim();
    if (!p) return;
    const r = await api.addRoot(p, single);
    $('rail-msg').textContent = r.ok ? '' : errText(r.error);
    if (r.ok) { $('root-path').value = ''; await renderRail(); }
  }
  $('add-root').addEventListener('submit', (ev) => { ev.preventDefault(); addRoot(false); });
  $('add-single').addEventListener('click', () => addRoot(true));

  $('browse').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (p) $('root-path').value = p;
  });

  $('scan').addEventListener('click', async () => {
    busy(true);
    try {
      const r = await api.scan();
      setStatus(t('scan_done', { n: r.scanned, added: r.added }));
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

  for (const b of document.querySelectorAll('#tabs button')) {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      for (const x of document.querySelectorAll('#tabs button')) x.setAttribute('aria-selected', String(x === b));
      refresh();
    });
  }
  const sheet = $('filter-dlg');
  $('filter-open').addEventListener('click', () => { renderSheet(); sheet.showModal(); });
  $('filter-x').addEventListener('click', () => sheet.close());
  $('filter-show').addEventListener('click', () => sheet.close());
  $('filter-clear').addEventListener('click', clearFilters);
  sheet.addEventListener('click', (ev) => { if (ev.target === sheet) sheet.close(); }); // the backdrop

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
    renderFilters();
    renderDetail();
  });

  $('settings-btn').addEventListener('click', async () => {
    const s = await api.getSettings();
    $('set-key').value = s.omdbKey;
    $('set-patterns').value = s.patterns.join('\n');
    $('set-ignore').value = s.ignore.join('\n');
    $('set-collections').value = s.collections.join('\n');
    $('set-email').value = s.translateEmail || '';
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
      translateEmail: $('set-email').value.trim(),
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

'use strict';
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const state = { lang: 'fa', entries: [], selected: null, cart: new Map(), selecting: false, picked: new Set(), copyDest: '', copyPlan: null, copying: false, query: '', shown: 0, tab: 'all', genres: [], genreCounts: [], tags: [], tagCounts: [], countries: [], countryCounts: [], knownTags: [], attention: [], attentionCounts: { ok: 0, guess: 0, problem: 0 }, sort: 'name', rootCount: 0 };
  const t = (key, vars) => window.i18n.t(state.lang, key, vars);
  const genreName = (g) => window.i18n.genreLabel(state.lang, g);
  const countryName = (g) => window.i18n.countryLabel(state.lang, g);
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

  // Icons are built from fixed path data, never from web text.
  const ICONS = {
    star: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.3 6.4 20.2l1.1-6.3L2.9 9.5l6.3-.9z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    link: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  let statusTimer = null;
  // one listener for everything the main process reports while it works; each run sets its own handler by event type
  const progressHandlers = {};
  api.onProgress((p) => progressHandlers[p.type || 'queue']?.(p));
  let planTimer = null;
  function setStatus(text) {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('on', !!text);
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => el.classList.remove('on'), 6000);
  }

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
      case 'not_media': return t('err_not_media');
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
    if ($('update').dataset.v) $('update-label').textContent = t('update_install', { v: $('update').dataset.v });
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    $('lang-label').textContent = t('lang_toggle');
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    for (const el of document.querySelectorAll('[data-i18n-label]')) {
      el.setAttribute('aria-label', t(el.dataset.i18nLabel));
      el.title = t(el.dataset.i18nLabel);
    }
  }

  // ---- tabs, filter sheet ------------------------------------------------

  const sameGenre = (a, b) => a.toLowerCase() === b.toLowerCase();
  const hasGenre = (g) => state.genres.some((x) => sameGenre(x, g));
  const SORTS = ['name', 'year', 'rating', 'added'];
  const STATES = [['ok', 'filter_ok'], ['guess', 'filter_guess'], ['problem', 'filter_problem']];

  function toggleGenre(g) {
    state.genres = hasGenre(g) ? state.genres.filter((x) => !sameGenre(x, g)) : [...state.genres, g];
    return refresh(true);
  }

  const hasTag = (g) => state.tags.some((x) => sameGenre(x, g));

  function toggleTag(g) {
    state.tags = hasTag(g) ? state.tags.filter((x) => !sameGenre(x, g)) : [...state.tags, g];
    return refresh(true);
  }

  const hasCountry = (g) => state.countries.some((x) => sameGenre(x, g));

  function toggleCountry(g) {
    state.countries = hasCountry(g) ? state.countries.filter((x) => !sameGenre(x, g)) : [...state.countries, g];
    return refresh(true);
  }

  function toggleAttention(a) {
    state.attention = state.attention.includes(a) ? state.attention.filter((x) => x !== a) : [...state.attention, a];
    return refresh();
  }

  function clearFilters() {
    state.genres = []; state.attention = []; state.tags = []; state.countries = [];
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
      ...state.countries.map((g) => h('button', { type: 'button', class: 'pill', onclick: () => toggleCountry(g) }, `${countryName(g)} ×`)),
      ...state.tags.map((g) => h('button', { type: 'button', class: 'pill mine', onclick: () => toggleTag(g) }, icon('tag'), `${g} ×`)),
      ...state.genres.map((g) => h('button', { type: 'button', class: 'pill', onclick: () => toggleGenre(g) }, `${genreName(g)} ×`)),
    ];
    const n = state.genres.length + state.attention.length + state.tags.length + state.countries.length;
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
    const places = [...state.countryCounts];
    for (const g of state.countries) if (!places.some((c) => sameGenre(c.name, g))) places.push({ name: g, count: 0 });
    $('f-countries').replaceChildren(...(places.length
      ? places.map((c) => chip(countryName(c.name), c.count, hasCountry(c.name), () => toggleCountry(c.name)))
      : [h('p', { class: 'help' }, t('filter_no_countries'))]));
    const mine = [...state.tagCounts];
    for (const g of state.tags) if (!mine.some((c) => sameGenre(c.name, g))) mine.push({ name: g, count: 0 });
    $('f-tags').replaceChildren(...(mine.length
      ? mine.map((c) => chip(c.name, c.count, hasTag(c.name), () => toggleTag(c.name), icon('tag')))
      : [h('p', { class: 'help' }, t('filter_no_tags'))]));
    $('f-sort').replaceChildren(...SORTS.map((s) => h('button', {
      type: 'button', 'aria-pressed': String(state.sort === s), onclick: () => { state.sort = s; refresh(); },
    }, t(`sort_${s}`))));
    $('filter-show').textContent = t('filter_show', { n: state.entries.length });
    $('filter-clear').disabled = !(state.genres.length || state.attention.length || state.tags.length || state.countries.length);
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

  const hueOf = (text) => { let n = 0; for (const c of text) n = (n * 31 + c.codePointAt(0)) % 360; return n; };

  // A film without a poster gets a colour made from its title, so the wall never has grey holes.
  function posterEl(e) {
    if (e.posterFile) return h('img', { class: 'poster', src: posterUrl(e.posterFile), alt: '', loading: 'lazy', decoding: 'async' });
    const el = h('div', { class: 'poster none', dir: 'auto' }, h('span', {}, e.title));
    el.style.setProperty('--h', String(hueOf(e.title)));
    return el;
  }

  const frame = (e, ...over) => h('span', { class: 'frame' }, posterEl(e), ...over);
  const rateChip = (r) => h('span', { class: 'rate', dir: 'ltr' }, icon('star'), String(r));

  // The dot beside a name: none when the film is verified, yellow when it was guessed, red when it needs attention.
  function dotOf(e) {
    if (e.attention === 'guess') return dot('yellow', t('badge_guessed'));
    if (e.attention !== 'problem') return null;
    return dot('red', t(`badge_${e.reason || 'review'}`));
  }

  const inCart = (key) => state.cart.has(key);

  function card(e) {
    const mine = e.tags.map((g) => h('span', { class: 'mine', dir: 'auto' }, icon('tag'), g));
    const genres = e.genres.map((g) => h('span', {}, genreName(g)));
    return h('button', {
      class: `card a-${e.attention}${state.selected === e.key ? ' sel' : ''}${state.picked.has(e.key) ? ' picked' : ''}`,
      type: 'button',
      'data-key': e.key,
      onclick: () => (state.selecting ? togglePick(e.key) : select(e.key)),
    },
    frame(e,
      e.rating ? rateChip(e.rating) : null,
      inCart(e.key) ? h('span', { class: 'cart-mark' }, icon('check')) : null,
      state.picked.has(e.key) ? h('span', { class: 'pick-mark' }, icon('check')) : null,
      e.kind === 'collection' ? h('span', { class: 'stack' }, icon('layers'), t('collection_n', { n: e.members })) : null),
    h('span', { class: 'info' },
      h('span', { class: 'title-row' }, dotOf(e), h('span', { class: 'name', dir: 'auto' }, e.title)),
      e.year || genres.length || mine.length ? h('span', { class: 'meta' }, e.year ? h('span', { class: 'year' }, String(e.year)) : null, ...mine, ...genres) : null));
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
    renderEmpty();
  }

  function resetView() {
    state.tab = 'all'; state.genres = []; state.tags = []; state.countries = []; state.attention = []; state.query = ''; $('q').value = '';
    for (const x of document.querySelectorAll('#tabs button')) x.setAttribute('aria-selected', String(x.dataset.tab === 'all'));
    return refresh();
  }

  // Nothing to show: say why, and offer the one next step.
  function renderEmpty() {
    const box = $('empty');
    box.hidden = state.entries.length > 0;
    if (box.hidden) { box.replaceChildren(); return; }
    const filtered = state.query || state.genres.length || state.tags.length || state.countries.length || state.attention.length || state.tab !== 'all';
    const [art, title, text, label, go] = filtered
      ? ['search', 'no_results', 'no_results_hint', 'reset_view', resetView]
      : !state.rootCount
        ? ['film', 'empty_title', 'empty_add_text', 'empty_add_btn', () => $('folders-btn').click()]
        : ['film', 'empty_title', 'empty_scan_text', 'scan', () => $('scan').click()];
    box.replaceChildren(h('span', { class: 'art' }, icon(art)), h('h2', {}, t(title)), h('p', {}, t(text)),
      h('button', { type: 'button', class: 'btn primary', onclick: go }, t(label)));
  }

  async function refresh(forceDetail = false) {
    const r = await api.getEntries({ query: state.query, tab: state.tab, genres: state.genres, tags: state.tags, countries: state.countries, attention: state.attention, sort: state.sort, light: true });
    state.entries = r.entries;
    state.genreCounts = r.genres;
    state.tagCounts = r.tagCounts;
    state.countryCounts = r.countryCounts;
    state.knownTags = await api.getTags();
    state.attentionCounts = r.attentionCounts;
    renderFilters();
    for (const key of [...state.picked]) if (!state.entries.some((e) => e.key === key)) state.picked.delete(key); // filtered out of view
    renderSelbar();
    if (state.selected && !state.entries.some((e) => e.key === state.selected)) state.selected = null;
    renderGrid();
    await renderDetail(forceDetail);
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
      notes.length ? h('span', { class: 'note' }, notes.join(state.lang === 'fa' ? '، ' : ', ')) : null,
      h('button', {
        type: 'button', class: 'btn open', disabled: !!blocked, title: blocked, 'aria-label': `${t('open_folder')}: ${l.relPath}`,
        onclick: async () => {
          const r = await api.openLocation(l.id);
          if (!r.ok) setStatus(errText(r.error));
        },
      }, icon('folder'), t('open_folder')));
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
        await refresh(true);
      },
    }, input, h('button', { type: 'submit', class: 'btn primary' }, t('fix_apply')));
    return h('details', { class: 'fix', open: e.attention !== 'ok' },
      h('summary', {}, t('online_info_fix')), h('p', { class: 'help' }, t('fix_help')), form, msg);
  }

  function candidatesSection(e) {
    // the typed search is for folders OMDb cannot read, e.g. a Persian name: type the English title
    const input = h('input', { type: 'text', dir: 'ltr', placeholder: t('candidates_search_ph'), 'aria-label': t('candidates_search') });
    const list = h('div', {});
    const box = h('section', { class: 'cands' }, h('h3', {}, t('candidates_title')),
      h('form', { onsubmit: (ev) => { ev.preventDefault(); load(input.value); } },
        input, h('button', { type: 'submit', class: 'btn' }, t('candidates_search'))), list);
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
              type: 'button', class: 'btn',
              onclick: async () => {
                const p = await api.pickCandidate(e.locationId, c.imdbId);
                if (!p.ok) { list.append(h('p', { class: 'msg' }, errText(p.error))); return; }
                state.selected = `t:${p.titleId}`;
                setStatus(t('fix_done'));
                await refresh(true);
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
          ep.rating ? h('span', { class: 'ep-rate', dir: 'ltr' }, icon('star'), String(ep.rating)) : null),
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

  function hero(e, ...text) {
    const el = h('div', { class: 'hero' },
      h('button', { class: 'icon-btn close', type: 'button', 'aria-label': t('close'), title: t('close'), onclick: () => select(null) }, icon('x')),
      h('div', { class: 'hero-main' }, frame(e), h('div', { class: 'card-text' }, ...text)));
    el.style.setProperty('--hero-bg', e.posterFile ? `url("${posterUrl(e.posterFile)}")` : 'none');
    return el;
  }

  // A folder that groups several titles: its folder button and the titles inside it.
  function collectionDetail(e) {
    const c = e.collection;
    const blocked = !c.online ? t('open_offline') : (c.missing ? t('open_missing') : null);
    return [
      hero(e, h('h2', { dir: 'auto' }, e.title), h('p', { class: 'sub' }, t('collection_n', { n: e.members.length }))),
      h('div', { class: 'detail-body' },
        h('div', { class: 'hero-actions' }, h('button', {
          type: 'button', class: 'btn open', disabled: !!blocked, title: blocked,
          onclick: async () => { const r = await api.openCollection(c.driveSerial, c.relPath); if (!r.ok) setStatus(errText(r.error)); },
        }, icon('folder'), t('open_folder')), cartButton(e)),
        myTagsSection(e),
        h('section', {}, h('h3', {}, t('collection_members')),
          h('ul', { class: 'plain members' }, e.members.map((m) => h('li', {}, h('button', { type: 'button', class: 'member', onclick: () => openMember(m.key) },
            h('span', { dir: 'auto' }, m.title), m.year ? h('span', { class: 'year' }, String(m.year)) : null)))))),
    ];
  }

  // the member may be hidden by the current tab, genre filter or search, so these are reset first
  async function openMember(key) {
    state.selected = key;
    await resetView();
  }

  // ---- selecting several films: tag them or put them in the copy list in one go ----

  function cardOf(key) { return [...document.querySelectorAll('.card')].find((c) => c.dataset.key === key); }

  function togglePick(key) {
    if (state.picked.has(key)) state.picked.delete(key); else state.picked.add(key);
    const el = cardOf(key);
    if (el) {
      el.classList.toggle('picked', state.picked.has(key));
      el.querySelector('.pick-mark')?.remove();
      if (state.picked.has(key)) el.querySelector('.frame').append(h('span', { class: 'pick-mark' }, icon('check')));
    }
    renderSelbar();
  }

  function renderSelbar() {
    $('selbar').hidden = !state.selecting;
    $('select-btn').setAttribute('aria-pressed', String(state.selecting));
    document.body.classList.toggle('selecting', state.selecting);
    if (!state.selecting) return;
    $('sel-count').textContent = t('select_n', { n: state.picked.size });
    const all = state.picked.size > 0 && state.picked.size === state.entries.length;
    $('sel-all').textContent = all ? t('select_none') : t('select_all', { n: state.entries.length });
    for (const id of ['sel-tag-add', 'sel-tag-remove', 'sel-copy']) $(id).disabled = !state.picked.size;
  }

  function setSelecting(on) {
    state.selecting = on;
    if (!on) state.picked.clear();
    if (on) select(null);
    for (const el of document.querySelectorAll('.card.picked')) { el.classList.remove('picked'); el.querySelector('.pick-mark')?.remove(); }
    renderSelbar();
  }

  function pickAll() {
    const all = state.picked.size === state.entries.length;
    state.picked = new Set(all ? [] : state.entries.map((e) => e.key));
    for (const el of document.querySelectorAll('.card')) {
      const on = state.picked.has(el.dataset.key);
      el.classList.toggle('picked', on);
      el.querySelector('.pick-mark')?.remove();
      if (on) el.querySelector('.frame').append(h('span', { class: 'pick-mark' }, icon('check')));
    }
    renderSelbar();
  }

  async function tagPicked(remove) {
    const text = $('sel-tag').value.trim();
    if (!text || !state.picked.size) return;
    const r = await (remove ? api.removeTags : api.addTags)([...state.picked], text);
    if (!r.ok) { setStatus(t(`tag_${r.error}`)); return; }
    $('sel-tag').value = '';
    setStatus(t(remove ? 'sel_untagged' : 'sel_tagged', { tag: text, n: r.count }));
    await refresh(true);
  }

  function copyPicked() {
    const titles = new Map(state.entries.map((e) => [e.key, e.title]));
    let n = 0;
    for (const key of state.picked) if (!inCart(key)) { toggleCart(key, titles.get(key) ?? ''); n += 1; }
    setStatus(t('sel_copied', { n }));
  }

  // ---- copy list: films picked here are copied (never moved) into a new folder somewhere else ----

  function cartButton(e) {
    const btn = h('button', { type: 'button', class: 'btn' });
    const paint = () => {
      btn.setAttribute('aria-pressed', String(inCart(e.key)));
      btn.replaceChildren(icon(inCart(e.key) ? 'check' : 'layers'), t(inCart(e.key) ? 'copy_remove' : 'copy_add'));
    };
    btn.addEventListener('click', () => { toggleCart(e.key, e.title); paint(); });
    paint();
    return btn;
  }

  function toggleCart(key, title) {
    if (state.cart.has(key)) state.cart.delete(key); else state.cart.set(key, title);
    renderCartBadge();
    const cardEl = [...document.querySelectorAll('.card')].find((c) => c.dataset.key === key);
    if (cardEl) {
      cardEl.querySelector('.cart-mark')?.remove();
      if (inCart(key)) cardEl.querySelector('.frame').append(h('span', { class: 'cart-mark' }, icon('check')));
    }
    if ($('copy-dlg').open) renderCopy();
  }

  function renderCartBadge() {
    $('copy-badge').hidden = !state.cart.size;
    $('copy-badge').textContent = String(state.cart.size);
  }

  const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
  const copyMsg = (text, bad = false) => { $('copy-msg').textContent = text; $('copy-msg').classList.toggle('bad', bad); };

  async function updateCopyPlan() {
    const name = $('copy-name').value.trim();
    state.copyPlan = null;
    $('copy-info').classList.remove('bad');
    $('copy-skipped').replaceChildren();
    if (!state.cart.size || !name || !state.copyDest) { $('copy-info').textContent = ''; renderCopy(); return; }
    const plan = await api.planTransfer({ keys: [...state.cart.keys()], destDir: state.copyDest, name });
    if ($('copy-name').value.trim() !== name) return; // typing went on while the plan was computed
    state.copyPlan = plan;
    if (!plan.ok) {
      $('copy-info').classList.add('bad');
      $('copy-info').textContent = t(`copy_err_${plan.error}`, plan.error === 'no_space' ? { needed: size(plan.needed), free: size(plan.free) } : {});
    } else {
      $('copy-info').textContent = plan.jobs.length ? t('copy_summary', { n: plan.jobs.length, size: size(plan.bytes) }) : t('copy_err_nothing');
      $('copy-skipped').replaceChildren(...plan.skipped.map((x) => h('li', { dir: 'auto' }, t('copy_skip', { title: x.title, reason: t(`copy_skip_${x.reason}`) }))));
    }
    renderCopy();
  }

  function renderCopy() {
    $('copy-items').replaceChildren(...[...state.cart].map(([key, title]) => h('li', {},
      h('span', { dir: 'auto' }, title),
      h('button', { type: 'button', class: 'icon-btn x', 'aria-label': t('copy_item_remove', { title }), title: t('copy_item_remove', { title }),
        onclick: () => { toggleCart(key, title); updateCopyPlan(); } }, icon('x')))));
    $('copy-empty').hidden = state.cart.size > 0;
    $('copy-clear').disabled = state.copying || !state.cart.size;
    $('copy-go').textContent = t(state.copying ? 'copy_cancel' : 'copy_start');
    $('copy-go').disabled = !state.copying && !(state.copyPlan?.ok && state.copyPlan.jobs.length);
    $('copy-name').disabled = $('copy-browse').disabled = state.copying;
  }

  async function runCopy() {
    if (state.copying) { api.cancelTransfer(); return; }
    state.copying = true;
    copyMsg('');
    $('copy-bar').hidden = false;
    $('copy-bar').value = 0;
    renderCopy();
    progressHandlers.copy = (p) => {
      $('copy-bar').value = p.totalBytes ? Math.round((p.doneBytes / p.totalBytes) * 100) : 0;
      if (p.title) copyMsg(t('copy_progress', { i: p.index + 1, n: p.total, title: p.title, done: size(p.doneBytes), total: size(p.totalBytes) }));
    };
    let r;
    try {
      r = await api.startTransfer({ keys: [...state.cart.keys()], destDir: state.copyDest, name: $('copy-name').value.trim() });
    } catch { r = { ok: false, error: 'busy' }; }
    state.copying = false;
    $('copy-bar').hidden = true;
    if (!r.ok) copyMsg(t(`copy_err_${r.error}`), true);
    else if (r.cancelled) copyMsg(t('copy_cancelled'), true);
    else if (r.failed.length) copyMsg(t('copy_failed', { titles: r.failed.map((f) => f.title).join(state.lang === 'fa' ? '، ' : ', ') }), true);
    else {
      copyMsg(t('copy_done', { n: r.done, size: size(r.bytes) }));
      for (const key of [...state.cart.keys()]) toggleCart(key, '');
    }
    await updateCopyPlan();
  }

  // The owner's own tags: filled accent chips (genres from OMDb stay outlined). Added with Enter or a comma, removed with the x.
  function myTagsSection(e) {
    const box = h('section', { class: 'mytags' });
    const note = h('p', { class: 'msg', role: 'alert' });
    const change = async (call, text) => {
      const r = await call(e.key, text);
      if (!r.ok) { note.textContent = t(`tag_${r.error}`); return; }
      await refresh(true);
      document.querySelector('.tag-input')?.focus();
    };
    const input = h('input', { type: 'text', class: 'tag-input', list: 'tag-suggest', maxlength: '30', 'aria-label': t('my_tags'), placeholder: t('tag_placeholder') });
    const add = () => {
      const text = input.value.replace(/[,،]+$/, '').trim();
      input.value = '';
      if (text) change(api.addTag, text);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ',' || ev.key === '،') { ev.preventDefault(); add(); }
    });
    const have = e.userTags.map((x) => x.toLowerCase());
    $('tag-suggest').replaceChildren(...state.knownTags.filter((c) => !have.includes(c.name.toLowerCase())).map((c) => h('option', { value: c.name })));
    box.append(h('h3', {}, t('my_tags')),
      h('div', { class: 'detail-tags' }, e.userTags.map((g) => h('span', { class: 'tag mine', dir: 'auto' }, icon('tag'), g,
        h('button', { type: 'button', class: 'x', 'aria-label': t('tag_remove', { tag: g }), title: t('tag_remove', { tag: g }), onclick: () => change(api.removeTag, g) }, icon('x')))),
      input),
      note);
    return box;
  }

  // The whole entry is fetched only for the open card. Without `force` an already open detail is left alone,
  // so typing in the search box does not rebuild it (and collapse its seasons).
  async function renderDetail(force = true) {
    const d = $('detail');
    const key = state.selected;
    if (!key) { d.hidden = true; d.replaceChildren(); delete d.dataset.key; return; }
    if (!force && d.dataset.key === key && !d.hidden) return;
    const e = await api.getEntry(key);
    if (state.selected !== key) return; // another card was chosen while this one loaded
    if (!e) { d.hidden = true; d.replaceChildren(); delete d.dataset.key; return; }
    d.dataset.key = key;
    d.hidden = false;
    if (e.kind === 'collection') { d.replaceChildren(...collectionDetail(e)); return; }
    const facts = [[t('runtime'), e.runtime], [t('director'), e.director], [t('actors'), e.actors],
      [t('country'), e.countryList.map(countryName).join(state.lang === 'fa' ? '، ' : ', ')], [t('rated'), e.rated], [t('awards'), e.awards]].filter(([, v]) => v);
    const flags = flagsOf(e);
    // dir="auto": English titles and plots from OMDb stay left-to-right inside the right-to-left Persian UI
    d.replaceChildren(
      hero(e,
        h('h2', { dir: 'auto' }, e.title),
        h('p', { class: 'sub', dir: 'auto' }, [e.year, e.type].filter(Boolean).join(' · ')),
        e.rating ? h('span', { class: 'score', dir: 'ltr', title: t('rating') }, icon('star'), String(e.rating), h('small', {}, 'IMDb')) : null),
      h('div', { class: 'detail-body' }, ...[
        flags.length ? h('ul', { class: 'flags' }, flags.map((f) => h('li', { class: f.cls }, f.text))) : null,
        h('div', { class: 'hero-actions' },
          e.imdbId ? h('button', { type: 'button', class: 'btn', onclick: () => api.openImdb(e.titleId) }, icon('link'), t('open_imdb')) : null,
          cartButton(e)),
        myTagsSection(e),
        e.genreList.length ? h('div', { class: 'detail-tags', 'aria-label': t('genres') }, e.genreList.map((g) => h('button', {
          type: 'button', class: 'tag', 'aria-pressed': String(hasGenre(g)), onclick: () => { toggleGenre(g); },
        }, genreName(g)))) : null,
        facts.length ? h('dl', { class: 'facts' }, facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { dir: 'auto' }, v)])) : null,
        h('section', {}, h('h3', {}, t('plot')), ...plotBlock(e)),
        e.titleId != null && e.kind !== 'movie' ? airingSection(e) : null,
        e.titleId != null && e.kind !== 'movie' ? episodesSection(e) : null,
        h('section', {}, h('h3', {}, t('locations')), h('ul', { class: 'plain' }, e.locations.map(locationRow))),
        e.titleId == null && e.status === 'review' ? candidatesSection(e) : null,
        fixSection(e),
      ].filter(Boolean)));
  }

  // ---- archive folders (the drives themselves are not listed) ------------

  async function renderRoots() {
    const roots = await api.getRoots();
    state.rootCount = roots.length;
    $('roots').replaceChildren(...(roots.length
      ? roots.map((r) => h('li', { class: 'root' },
        h('span', { class: 'rpath' }, `${r.driveLabel} `, h('span', { class: 'path', dir: 'ltr' }, `/${r.relPath}`), r.single ? h('span', { class: 'tag' }, t('single_tag')) : null),
        h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            if (!window.confirm(t('confirm_remove'))) return;
            await api.removeRoot(r.id);
            await renderRoots();
            await refresh(true);
          },
        }, t('remove'))))
      : [h('li', { class: 'none' }, t('no_folders'))]));
    renderEmpty();
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
    if (r.ok) { $('root-path').value = ''; await renderRoots(); }
  }
  $('add-root').addEventListener('submit', (ev) => { ev.preventDefault(); addRoot(false); });
  $('add-single').addEventListener('click', () => addRoot(true));

  $('browse').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (p) $('root-path').value = p;
  });

  async function runScan() {
    busy(true);
    try {
      const r = await api.scan();
      await renderRoots();
      await refresh(true);
      return r;
    } catch { setStatus(t('err_unexpected')); return null; } finally { busy(false); }
  }

  $('scan').addEventListener('click', async () => {
    const r = await runScan();
    if (r) setStatus(t('scan_done', { n: r.scanned, added: r.added }));
  });

  // ---- drag and drop: folders become single archive folders, a video brings its own folder ----

  let dragDepth = 0;
  const carriesFiles = (ev) => [...(ev.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (ev) => { if (carriesFiles(ev)) { dragDepth += 1; $('drop').hidden = false; } });
  window.addEventListener('dragover', (ev) => { if (carriesFiles(ev)) ev.preventDefault(); });
  window.addEventListener('dragleave', (ev) => { if (carriesFiles(ev) && (dragDepth -= 1) <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  window.addEventListener('drop', async (ev) => {
    if (!carriesFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    $('drop').hidden = true;
    const paths = [...ev.dataTransfer.files].map((f) => api.pathOf(f)).filter(Boolean);
    if (!paths.length) return;
    const r = await api.addDropped(paths);
    if (r.added || r.already) await runScan();
    const parts = [];
    if (r.added) parts.push(t('drop_done', { added: r.added }));
    else if (r.already) parts.push(t('drop_already'));
    if (r.failed.length) parts.push(t('drop_failed', { error: errText(r.failed[0].error) }));
    setStatus(parts.join(' '));
  });

  // first press checks (and downloads); once an update is ready the same button installs it
  $('update').addEventListener('click', async () => {
    if ($('update').dataset.v) { await api.installUpdate(); return; }
    $('update').disabled = true;
    setStatus(t('update_checking'));
    try {
      const r = await api.checkUpdate();
      if (r.state === 'ready') {
        $('update').dataset.v = r.version;
        $('update-label').textContent = t('update_install', { v: r.version });
        $('update-label').hidden = false;
        $('update').classList.add('ready');
        setStatus(t('update_ready', { v: r.version }));
      } else setStatus(t(`update_${r.state}`));
    } catch { setStatus(t('err_unexpected')); } finally { $('update').disabled = false; }
  });

  $('fetch').addEventListener('click', async () => {
    busy(true);
    progressHandlers.queue = (p) => setStatus(t('progress', { done: p.processed, left: p.remaining }));
    try {
      const r = await api.startQueue();
      if (r.stoppedBy === 'quota') setStatus(t('stop_quota'));
      else if (r.stoppedBy === 'network') setStatus(t('stop_network'));
      else if (r.stoppedBy === 'bad_key') setStatus(t('err_bad_key'));
      else setStatus(t('fetch_done'));
      await refresh(true);
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
  for (const dlg of document.querySelectorAll('dialog')) dlg.addEventListener('click', (ev) => { if (ev.target === dlg && !(dlg.id === 'copy-dlg' && state.copying)) dlg.close(); }); // the backdrop

  $('select-btn').addEventListener('click', () => setSelecting(!state.selecting));
  $('sel-done').addEventListener('click', () => setSelecting(false));
  $('sel-all').addEventListener('click', pickAll);
  $('sel-tag-add').addEventListener('click', () => tagPicked(false));
  $('sel-tag-remove').addEventListener('click', () => tagPicked(true));
  $('sel-tag').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); tagPicked(false); } });
  $('sel-copy').addEventListener('click', copyPicked);
  $('copy-btn').addEventListener('click', () => { renderCopy(); $('copy-dlg').showModal(); updateCopyPlan(); });
  $('copy-x').addEventListener('click', () => { if (!state.copying) $('copy-dlg').close(); });
  $('copy-dlg').addEventListener('cancel', (ev) => { if (state.copying) ev.preventDefault(); }); // Esc must not hide a running copy
  $('copy-name').addEventListener('input', () => { clearTimeout(planTimer); planTimer = setTimeout(updateCopyPlan, 300); });
  $('copy-browse').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (!p) return;
    state.copyDest = p;
    $('copy-dest').value = p;
    updateCopyPlan();
  });
  $('copy-go').addEventListener('click', runCopy);
  $('copy-clear').addEventListener('click', () => { for (const key of [...state.cart.keys()]) toggleCart(key, ''); updateCopyPlan(); });
  $('folders-btn').addEventListener('click', async () => { await renderRoots(); $('folders-dlg').showModal(); });
  $('folders-x').addEventListener('click', () => $('folders-dlg').close());
  $('settings-x').addEventListener('click', () => $('settings-dlg').close());
  $('theme').addEventListener('click', () => window.theme.toggle());

  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (ev.key === '/' && !typing && !document.querySelector('dialog[open]')) { ev.preventDefault(); $('q').focus(); }
    else if (ev.key === 'Escape' && !document.querySelector('dialog[open]') && state.selecting) setSelecting(false);
    else if (ev.key === 'Escape' && !document.querySelector('dialog[open]') && state.selected) select(null);
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
    await renderRoots();
    renderGrid();
    renderFilters();
    renderDetail(true);
  });

  // ---- series calendar ----------------------------------------------------

  const DAY_ORDER = { fa: [6, 0, 1, 2, 3, 4, 5], en: [1, 2, 3, 4, 5, 6, 0] }; // Saturday first in Persian, Monday first in English
  const dayName = (d) => t(`cal_day_${d}`);
  const notified = new Set(); // "id:due" of reminders already announced, so each episode is announced once
  let calEditing = null;

  function whenText(r) {
    if (r.state === 'out') return t('cal_state_out');
    if (r.state === 'paused') return t('cal_state_paused');
    if (r.state === 'today') return t('cal_state_today', { time: r.time });
    const date = new Date(r.due).toLocaleDateString(state.lang === 'fa' ? 'fa-IR' : 'en-GB', { weekday: 'long', month: 'short', day: 'numeric' });
    return t('cal_state_soon', { date, time: r.time });
  }

  // One form for adding, editing and the series detail; `onSubmit` gets the fields and returns the api answer.
  function reminderForm(init, label, onSubmit, { withTitle = true } = {}) {
    const name = h('input', { type: 'text', maxlength: '100', dir: 'auto', value: init.title ?? '', 'aria-label': t('cal_name'), placeholder: t('cal_name') });
    const day = h('select', { 'aria-label': t('cal_day') }, DAY_ORDER[state.lang].map((d) => h('option', { value: String(d), selected: d === (init.weekday ?? 1) }, dayName(d))));
    const time = h('input', { type: 'time', value: init.time ?? '20:00', 'aria-label': t('cal_time') });
    const ep = h('input', { type: 'number', min: '1', step: '1', class: 'cal-ep', value: init.episode ?? '', 'aria-label': t('cal_episode'), placeholder: t('cal_episode') });
    const msg = h('p', { class: 'msg', role: 'alert' });
    const form = h('form', { class: 'cal-form' }, withTitle ? name : null, day, time, ep, h('button', { type: 'submit', class: 'btn primary' }, label), msg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = await onSubmit({ title: name.value, weekday: Number(day.value), time: time.value, episode: ep.value === '' ? null : Number(ep.value) });
      msg.textContent = r && !r.ok ? t(`cal_err_${r.error}`) : '';
    });
    return form;
  }

  async function loadCalendar() {
    state.reminders = await api.calendarList();
    const live = state.reminders.filter((r) => r.state === 'out' || r.state === 'today').length;
    $('cal-badge').hidden = !live;
    $('cal-badge').textContent = String(live);
    if ($('cal-dlg').open) renderCal();
  }

  // `inForm`: a form shows its own error and must not be rebuilt (that would wipe the message and the typed text)
  async function calDo(call, inForm = false) {
    const r = await call();
    $('cal-note').hidden = !(r && !r.ok) || inForm;
    if (r && !r.ok) {
      if (!inForm) $('cal-note').textContent = t(`cal_err_${r.error}`);
      return r;
    }
    await loadCalendar();
    if (state.selected) renderDetail(true); // the open series shows its own reminder
    return r;
  }

  function renderCal() {
    $('cal-empty').hidden = state.reminders.length > 0;
    $('cal-items').replaceChildren(...state.reminders.map((r) => h('li', { class: `cal-item ${r.state}` },
      calEditing === r.id
        ? reminderForm(r, t('cal_save'), async (f) => { const x = await calDo(() => api.calendarUpdate(r.id, f), true); if (x.ok) { calEditing = null; renderCal(); } return x; })
        : [
          h('div', { class: 'cal-main' },
            h('strong', { dir: 'auto' }, r.title),
            r.episode ? h('span', { class: 'tag' }, t('cal_ep', { n: r.episode })) : null,
            h('span', { class: 'cal-when' }, whenText(r))),
          h('div', { class: 'cal-actions' },
            r.state === 'out' ? h('button', { type: 'button', class: 'btn primary', onclick: () => calDo(() => api.calendarTick(r.id)) }, icon('check'), t('cal_done')) : null,
            r.enabled ? h('button', { type: 'button', class: 'btn', onclick: () => calDo(() => api.calendarSkip(r.id)) }, t('cal_skip')) : null,
            h('button', { type: 'button', class: 'btn', onclick: () => { calEditing = r.id; renderCal(); } }, t('cal_edit')),
            h('button', { type: 'button', class: 'btn', onclick: () => calDo(() => api.calendarUpdate(r.id, { enabled: !r.enabled })) }, r.enabled ? t('cal_pause') : t('cal_resume')),
            h('button', { type: 'button', class: 'btn', onclick: () => { if (window.confirm(t('cal_confirm_delete'))) calDo(() => api.calendarRemove(r.id)); } }, t('cal_delete'))),
        ])));
    $('cal-new').replaceChildren(reminderForm({}, t('cal_add'), async (f) => {
      const x = await calDo(() => api.calendarAdd(f), true);
      if (x.ok) renderCal();
      return x;
    }));
  }

  function openCal(note) {
    calEditing = null;
    renderCal();
    $('cal-note').hidden = !note;
    $('cal-note').textContent = note || '';
    if (!$('cal-dlg').open) $('cal-dlg').showModal();
  }

  // "Airing" on a series card: the weekly day and time, which become a reminder named after the series.
  function airingSection(e) {
    const box = h('section', { class: 'airing' });
    api.getAiring(e.key).then((a) => {
      if (state.selected !== e.key) return;
      if (!a.canAir && !a.reminder) {
        if (a.ended) box.append(h('h3', {}, t('airing_title')), h('p', { class: 'help' }, t('airing_ended')));
        else box.remove();
        return;
      }
      box.append(h('h3', {}, t('airing_title')));
      if (a.reminder) {
        const r = a.reminder;
        box.append(h('p', {}, icon('calendar'), ' ', r.episode
          ? t('airing_on', { day: dayName(r.weekday), time: r.time, n: r.episode })
          : t('airing_on_noep', { day: dayName(r.weekday), time: r.time })),
        h('button', { type: 'button', class: 'btn', onclick: () => openCal() }, t('airing_open')));
        return;
      }
      box.append(h('p', { class: 'help' }, t('airing_hint')),
        reminderForm({}, t('airing_enable'), (f) => calDo(() => api.calendarAdd({ ...f, key: e.key, title: e.title }), true), { withTitle: false }));
    });
    return box;
  }

  function announce(r) {
    const text = r.episode ? t('cal_out_ep', { title: r.title, n: r.episode }) : t('cal_out', { title: r.title });
    setStatus(text);
    try { new Notification(t('cal_title'), { body: text }); } catch { /* notifications can be blocked by the system */ }
  }

  // Looks at the clock every 20 s. `first` is the check at launch: what is already out goes in the summary, not in a pop-up.
  async function pollCalendar(first) {
    await loadCalendar();
    for (const r of state.reminders) {
      if (r.state !== 'out') continue;
      const k = `${r.id}:${r.due}`;
      if (notified.has(k)) continue;
      notified.add(k);
      if (!first) announce(r);
    }
    if (first && state.reminders.some((r) => r.state === 'out' || r.state === 'today')) openCal(t('cal_today_note'));
  }

  $('cal-btn').addEventListener('click', () => openCal());
  $('cal-x').addEventListener('click', () => $('cal-dlg').close());

  // ---- background translation of plots ----

  let translating = false;
  async function backgroundTranslate(manual) {
    if (translating) { api.stopPretranslate(); return; }
    translating = true;
    $('translate-now').textContent = t('translate_stop');
    progressHandlers.translate = (p) => { if (manual) setStatus(t('translate_progress', { done: p.done, total: p.total })); };
    let r;
    try { r = await api.startPretranslate(); } catch { r = null; }
    translating = false;
    $('translate-now').textContent = t('translate_now');
    if (!r?.ok) return;
    if (r.stoppedBy === 'quota') { if (manual || r.translated) setStatus(t('translate_bg_quota', { n: r.translated, left: r.remaining })); }
    else if (r.stoppedBy === 'network') { if (manual) setStatus(t('translate_bg_network')); }
    else if (manual && r.stoppedBy !== 'cancelled') setStatus(t('translate_bg_done', { n: r.translated }));
    if (r.translated) renderDetail(true);
  }
  $('translate-now').addEventListener('click', () => backgroundTranslate(true));

  $('settings-btn').addEventListener('click', async () => {
    const s = await api.getSettings();
    $('set-key').value = s.omdbKey;
    $('set-patterns').value = s.patterns.join('\n');
    $('set-ignore').value = s.ignore.join('\n');
    $('set-collections').value = s.collections.join('\n');
    $('set-email').value = s.translateEmail || '';
    $('set-auto-translate').checked = s.autoTranslate !== false;
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
      autoTranslate: $('set-auto-translate').checked,
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
    await renderRoots();
    await refresh();
    // a few seconds after launch, so the first screen is not competing with it
    await pollCalendar(true);
    setInterval(() => pollCalendar(false), 20000);
    if (state.lang === 'fa' && s.autoTranslate !== false) setTimeout(() => backgroundTranslate(false), 4000);
  })();
})();

'use strict';

function awardRows(summary, text) {
  const families = [
    { pattern: /^(?:oscars?|academy awards?)$/i, name: 'اسکار', icon: '🏆' },
    { pattern: /^(?:primetime\s+|daytime\s+)?emm(?:y|ys|ies)(?: awards?)?$/i, name: 'امی', icon: '📺' },
    { pattern: /^golden globes?(?: awards?)?$/i, name: 'گلدن گلوب', icon: '◉' },
    { pattern: /^baftas?(?: (?:film )?awards?)?$/i, name: 'بفتا', icon: '◇' },
    { pattern: /^gramm(?:y|ys|ies)(?: awards?)?$/i, name: 'گرمی', icon: '♪' },
  ];
  const rows = [];
  const named = /\b(won|nominated\s+for)\s+(\d+)\s+([^.;,&]+?)(?=\s+(?:and\s+)?(?:won|nominated\s+for)\b|[.;,&]|$)/gi;
  for (const [, result, quantity, award] of summary.matchAll(named)) {
    const count = Number(quantity);
    if (!count) continue;
    const name = award.trim();
    const position = families.findIndex(({ pattern }) => pattern.test(name));
    const family = families[position];
    const nomination = !/^won$/i.test(result);
    const label = family?.name || name;
    rows.push({
      name: nomination ? text.awardNomination + ' ' + label : label,
      icon: nomination ? '☆' : family?.icon || '✦',
      count, nomination, position: family ? position : families.length,
    });
  }
  rows.sort((a, b) => a.position - b.position || Number(a.nomination) - Number(b.nomination));
  for (const [, other, quantity, result] of summary.matchAll(/\b(?:(another)\s+)?(\d+)\s+(wins?|nominations?)\b/gi)) {
    const count = Number(quantity);
    if (!count) continue;
    const nomination = /^nomination/i.test(result);
    rows.push({
      name: nomination ? (other ? text.otherNominations : text.totalNominations) : (other ? text.otherWins : text.totalWins),
      icon: nomination ? '✧' : '✦', count, nomination, total: true,
    });
  }
  return rows;
}

// Embedded by catalog-page in the self-contained phone catalog.
function renderDetailView({ body, title, data, text, element, formatNumber, poster, link, retry, animateSections }) {
  const e = element;
  const name = title.t || title.f;
  const subtitle = title.f && title.f !== name ? title.f : '';
  const heading = e('h1', { id: 'detailTitle', dir: 'auto', tabindex: '-1' }, [name]);
  const facts = [];
  if (title.y) facts.push(e('bdi', { dir: 'ltr' }, [title.y]));
  if (title.r) facts.push(e('bdi', { dir: 'ltr' }, ['★ ' + formatNumber(title.r) + ' / 10']));
  if (data?.runtime && !data.episodic) {
    facts.push(e('bdi', { dir: 'auto' }, [data.runtime.replace(/^(\d+) min$/, (_, n) => formatNumber(n) + ' دقیقه')]));
  }
  const hero = e('div', { class: 'detail-hero' }, [
    poster(title, false),
    e('div', { class: 'detail-heading' }, [
      heading,
      subtitle ? e('div', { class: 'subtitle subtle', dir: 'auto' }, [subtitle]) : '',
      e('div', { class: 'detail-meta' }, facts),
      e('div', { class: 'detail-genres' }, title.g.map((genre) => e('span', {}, [genre]))),
    ]),
  ]);
  body.replaceChildren(hero);
  if (!data) {
    const status = retry ? e('button', { type: 'button', class: 'chip' }, [text.retry]) : '';
    if (status) status.onclick = retry;
    body.append(e('p', { role: 'status', class: 'subtle' }, [retry ? text.detailError : text.loading]), status);
    return;
  }
  const sectionClass = animateSections ? 'detail-section detail-enter-section' : 'detail-section';
  const section = (name, children) => body.append(e('section', { class: sectionClass }, [
    e('h2', {}, [name]), ...children,
  ]));
  if (data.plot) {
    if (data.plot.length > 230) {
      const words = data.plot.slice(0, 230);
      const short = words.slice(0, words.lastIndexOf(' ') > 150 ? words.lastIndexOf(' ') : 230) + '…';
      const excerpt = e('p', { dir: 'auto' }, [short]);
      const more = e('details', {}, [
        e('summary', {}, [text.morePlot]), e('p', { dir: 'auto' }, [data.plot]),
      ]);
      more.ontoggle = () => { excerpt.hidden = more.open; };
      section(text.synopsis, [excerpt, more]);
    } else section(text.synopsis, [e('p', { dir: 'auto' }, [data.plot])]);
  }
  const credits = [[text.cast, data.actors], [text.director, data.director]].filter(([, value]) => value);
  if (credits.length) section(text.people, [e('dl', {}, credits.flatMap(([label, value]) => [
    e('dt', {}, [label]), e('dd', { dir: 'auto' }, [value]),
  ]))]);
  if (data.awards) {
    const rows = awardRows(data.awards, text);
    section(text.awards, rows.length ? [e('ul', { class: 'award-list' }, rows.map((row) =>
      e('li', { class: 'award-row' + (row.nomination ? ' award-nomination' : '') + (row.total ? ' award-total' : '') }, [
        e('span', { class: 'award-icon', 'aria-hidden': 'true' }, [row.icon]),
        e('span', { class: 'award-name', dir: 'auto' }, [row.name]),
        e('bdi', { class: 'award-count', dir: 'ltr' }, [formatNumber(row.count) + 'x']),
      ])))] : [e('p', { dir: 'auto' }, [data.awards])]);
  }
  if (data.episodic) {
    const counts = [];
    if (data.availableSeasons) counts.push(formatNumber(data.availableSeasons) + ' ' + text.availableSeasons);
    if (data.availableEpisodes != null) counts.push(formatNumber(data.availableEpisodes) + ' ' + text.availableEpisodes);
    if (data.totalSeasons) counts.push(formatNumber(data.totalSeasons) + ' ' + text.totalSeasons);
    const known = data.seasons.reduce((n, s) => n + s.knownEpisodes, 0);
    if (data.availableEpisodes == null && known) counts.push(formatNumber(known) + ' ' + text.knownEpisodes);
    if (data.runtime) counts.push(text.typicalRuntime + ' ' + data.runtime.replace(/^(\d+) min$/, (_, n) => formatNumber(n) + ' دقیقه'));
    section(text.seasonN + ' و ' + text.epWord, [
      counts.length ? e('p', { class: 'subtle' }, [counts.join(' · ')]) : '',
      ...data.seasons.map((season) => {
        const description = [];
        if (season.episodes) description.push(formatNumber(season.episodes.length) + ' ' + text.availableEpisodes);
        else if (season.knownEpisodes) description.push(formatNumber(season.knownEpisodes) + ' ' + text.knownEpisodes);
        if (season.average != null) description.push('★ ' + formatNumber(season.average) + ' ' + text.average + ' · ' + formatNumber(season.ratedEpisodes) + ' ' + text.ratingsCount);
        const heading = [
          e('span', { class: 'season-name' }, [text.seasonN + ' ' + formatNumber(season.season)]),
          description.length ? e('span', { class: 'season-info' }, [description.join(' · ')]) : '',
        ];
        const times = Object.entries(season.runtimeByEpisode);
        if (!times.length) return e('div', { class: 'season season-stat' }, heading);
        return e('details', { class: 'season' }, [
          e('summary', {}, heading),
          e('p', { class: 'subtle' }, [text.episodeTimes]),
          ...times.map(([number, runtime]) => e('p', {}, [
            text.epWord + ' ' + formatNumber(number) + ' · ' + runtime.replace(/^(\d+) min$/, (_, n) => formatNumber(n) + ' دقیقه'),
          ])),
        ]);
      }),
    ]);
  }
  for (const [label, keys] of [[text.related, data.related], [text.similar, data.similar]]) {
    const items = keys.map(link).filter(Boolean);
    if (items.length) section(label, [e('div', { class: 'recommendations' }, items)]);
  }
}

module.exports = { renderDetailView, awardRows };

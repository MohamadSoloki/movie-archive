'use strict';

// Embedded by catalog-page in the self-contained phone catalog.
function renderDetailView({ body, title, data, text, element, formatNumber, poster, link, controls, retry, animateSections }) {
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
  if (data.awards) section(text.awards, [e('p', { dir: 'auto' }, [data.awards])]);
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
      controls(data.seasons),
    ]);
  }
  for (const [label, keys] of [[text.related, data.related], [text.similar, data.similar]]) {
    const items = keys.map(link).filter(Boolean);
    if (items.length) section(label, [e('div', { class: 'recommendations' }, items)]);
  }
}

module.exports = { renderDetailView };

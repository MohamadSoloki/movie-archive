'use strict';

const { wishSignature } = require('./wish-signature.js');
const { renderDetailView } = require('./catalog-detail-view.js');
const DETAIL_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const DARK_PALETTE = 'color-scheme: dark; --bg: #101722; --card: #1b2636; --ink: #f0f3f8; --muted: #b5c2d4; --accent: #b2ccef; --accent-ink: #14273d; --line: #3c4e65; --wash: #28394f; --ok: #b2ccef; --error: #ffad98;';

const TEXT = {
  fa: {
    dir: 'rtl', lang: 'fa', other: 'English', otherLang: 'en', title: 'کاتالوگ فیلم و سریال', search: 'اسم فیلم، بازیگر یا کارگردان…',
    all: 'همه', movie: 'فیلم', series: 'سریال', animation: 'انیمیشن', anime: 'انیمه', pick: 'انتخاب', picked: 'انتخاب شد', send: 'ارسال لیست', mine: 'لیست من',
    name: 'اسم شما', phone: 'شماره تماس (اختیاری)', note: 'توضیح (اختیاری)', submit: 'ارسال', close: 'بستن', remove: 'حذف از لیست',
    done: 'لیستت ثبت شد. شمارهٔ پیگیری:', updated: 'لیستت به‌روز شد. شمارهٔ پیگیری:', updateList: 'به‌روزرسانی لیست',
    saved: 'ثبت شده', receipt: 'شمارهٔ پیگیری',
    fail: 'ارسال نشد. بعداً دوباره امتحان کن.', slow: 'چند بار پشت هم فرستادی. چند دقیقه بعد دوباره امتحان کن.',
    full: 'الان لیست جدید قبول نمی‌کنیم. به مغازه بگو.', none: 'چیزی پیدا نشد.', more: 'نمایش بیشتر', loadFail: 'کاتالوگ باز نشد. دوباره امتحان کن.', retry: 'تلاش دوباره',
    sortNew: 'جدیدترین', sortName: 'الفبا', sortRating: 'امتیاز', sort: 'مرتب‌سازی', seasons: 'فصل', stars: 'امتیاز',
    askTitle: 'پیدا نکردی؟', askText: 'اسم فیلم رو بنویس تا برات تهیه کنیم.', askGo: 'درخواست', askThanks: 'ثبت شد. اگه تهیه کردیم بهت خبر می‌دیم.',
    askHave: 'این فیلم توی آرشیو هست:', askName: 'اسم شما (برای خبر دادن، اختیاری)', askPhone: 'شماره تماس (اختیاری)', empty: 'کاتالوگ هنوز خالیه.',
    tariff: 'تعرفه', perMovie: 'هر فیلم', perSeason: 'هر فصل سریال', perEpisode: 'هر قسمت', currency: 'تومان', total: 'مبلغ کل',
    related: 'عنوان‌های مرتبط', similar: 'پیشنهادهای مشابه', back: 'برگشت', seasonN: 'فصل', epWord: 'قسمت',
    episodesHint: 'شمارهٔ قسمت‌ها، مثلاً ۱-۵ یا ۲ ۵ ۷', wholeSeason: 'همهٔ قسمت‌های موجود', invalidEpisodes: 'شمارهٔ قسمت‌های موجود را وارد کن.',
    genres: 'ژانرها', genreCount: 'انتخاب', addToList: 'اضافه به لیست سینمایی', inList: 'در لیست شما', updatePick: 'ثبت انتخاب فصل و قسمت',
    editSeasons: 'ویرایش فصل و قسمت', loading: 'در حال بارگذاری جزئیات…', detailError: 'جزئیات در دسترس نیست.', unknownTitle: 'این عنوان در کاتالوگ پیدا نشد.',
    wholeSeries: 'انتخاب کل سریال', seasonPicker: 'انتخاب فصل و قسمت', applySeasonPick: 'ثبت انتخاب',
    fullSeason: 'کل فصل', episodeField: 'شمارهٔ قسمت‌ها', episodeDisclosure: 'قسمت‌ها', emptySeasonPick: 'فصل یا قسمت دلخواهت را انتخاب کن.',
    episodeNumbersOnly: 'شمارهٔ قسمت را با عدد وارد کن. برای چند قسمت از فاصله، ویرگول یا خط تیره استفاده کن.',
    lastAvailableEpisode: 'آخرین قسمت این فصل', noEpisodeNumbers: 'شمارهٔ قسمت‌های این فصل هنوز ثبت نشده. می‌توانی فصل کامل را انتخاب کنی.',
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
<script id="catalog-theme-init">
try {
  var savedTheme = localStorage.getItem('catalogTheme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
} catch (error) { /* system colors still apply */ }
</script>
<style>
@font-face { font-family: "Vazirmatn"; src: url("/font.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
:root { color-scheme: light; --bg: #f7f5ef; --card: #fffdf8; --ink: #192b41; --muted: #4f5e72; --accent: #24476e; --accent-ink: #fff; --line: #c9d1dc; --wash: #e5edf6; --ok: #24476e; --error: #a53122; --masthead: #17283b; --masthead-muted: #cbd8eb; --gutter: clamp(0.85rem, 3vw, 2rem); }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${DARK_PALETTE} } }
:root[data-theme="dark"] { ${DARK_PALETTE} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; font: 17px/1.5 "Vazirmatn", system-ui, Tahoma, sans-serif; background: var(--bg); color: var(--ink); padding-bottom: 6rem; }
header { background: var(--masthead); color: #fff9ea; border-bottom: 3px solid #d6aa63; }
.masthead, .filters, #grid { max-width: 76rem; margin-inline: auto; }
.masthead { display: grid; gap: .8rem; padding: 1.1rem var(--gutter); }
.top { display: flex; align-items: center; gap: .7rem; }
.top h1 { flex: 1; }
.theme-toggle { flex: none; width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--card); color: var(--ink); font-size: 1.45rem; line-height: 1; cursor: pointer; }
.masthead .theme-toggle { background: transparent; border-color: var(--masthead-muted); color: #ffe2a5; }
.masthead .theme-toggle:focus-visible { outline-color: #e6bc76; }
.detail-toolbar { display: flex; justify-content: space-between; align-items: start; gap: .7rem; }
.top::before { content: ''; flex: none; width: 1.65rem; height: 1.65rem; border-radius: .25rem; background: repeating-linear-gradient(120deg,#e6bc76 0 5px,var(--masthead) 5px 9px) top / 100% 32% no-repeat; border: 2px solid #e6bc76; }
h1 { font-size: clamp(1.45rem,4vw,2.25rem); line-height: 1.4; margin: 0; }
.filters { padding: .55rem var(--gutter) 0; }
.lookup { position: relative; }
.lookup::before { content: ''; position: absolute; width: .75rem; height: .75rem; border: 2px solid var(--muted); border-radius: 100%; inset-inline-start: .9rem; top: .85rem; pointer-events: none; }
.lookup::after { content: ''; position: absolute; width: .48rem; height: 2px; background: var(--muted); inset-inline-start: .65rem; top: 1.72rem; transform: rotate(-48deg); pointer-events: none; }
#q { padding-inline-start: 2.65rem; }
::placeholder { color: var(--muted); opacity: 1; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
#q:focus-visible { outline-color: #e6bc76; }
@media (min-width: 48rem) { .masthead { grid-template-columns: 1fr minmax(16rem, 42%); align-items: center; padding-block: 1.6rem; } .masthead .tariff { grid-column: 1 / -1; } }
input, textarea, select, button { font-family: inherit; }
input, textarea, select { width: 100%; font: inherit; padding: 0.65rem 0.8rem; min-height: 44px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.tools { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.tools select { flex: 1; min-width: 0; }
.tools label { align-self: center; color: var(--muted); font-size: .88rem; }
.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding: 0.5rem 0 0; scrollbar-width: none; }
.chip { flex: none; min-height: 44px; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 0.2rem 0.8rem; font: inherit; font-size: 0.9rem; }
#kinds { flex-wrap: wrap; }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
#grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.15rem .75rem; padding: 1rem var(--gutter); }
@media (min-width: 36rem) { #grid { grid-template-columns: repeat(auto-fill, minmax(10.6rem, 1fr)); gap: 1.2rem; } }
@media (max-width: 18rem) { #grid { grid-template-columns: 1fr; } }
.film { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.film .img { position: relative; aspect-ratio: 2 / 3; overflow: hidden; background: var(--wash); display: grid; place-items: center; text-align: center; color: var(--accent); }
.film .rating { position: absolute; bottom: .45rem; inset-inline-end: .45rem; background: #17283bf2; color: #ffe2a5; font: 700 .86rem/1.5 "Vazirmatn",sans-serif; padding: .12rem .46rem; border-radius: .3rem; }
span.card-poster { display: grid; place-items: center; padding: 1rem; border-block: .45rem double var(--line); font-weight: 700; }
.film img { width: 100%; height: 100%; object-fit: cover; display: block; }
.film .body { padding: .65rem; display: flex; flex-direction: column; gap: .25rem; flex: 1; }
.film b { font-size: 1.06rem; line-height: 1.35; }
.film a { display: block; color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.film .title-link:hover, .rec:hover { text-decoration: underline; }
.title-link:focus-visible, .rec:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.film small { color: var(--muted); font-size: .875rem; }
.film .subtitle, .detail-heading h1, .detail-heading .subtitle { text-align: match-parent; }
.film button { margin-top: auto; min-height: 44px; border: 1px solid var(--line); background: var(--wash); color: var(--accent); border-radius: 8px; padding: .35rem; font: 650 .94rem "Vazirmatn",sans-serif; }
.film button::before { content: '+ '; }
.film.on button::before { content: '✓ '; }
.film .meta { display: flex; flex-wrap: wrap; gap: .2rem .45rem; padding-bottom: .35rem; }
.film .meta bdi { white-space: nowrap; }
.film.on { border-color: var(--accent); }
@media (hover: hover) and (pointer: fine) { .film:hover { border-color: var(--muted); } .film button:hover { border-color: var(--accent); } }
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
.tariff { margin: 0; color: var(--masthead-muted); font-size: .85rem; }
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
@media (prefers-reduced-motion: no-preference) {
  .detail-enter-section { animation: detail-reveal 140ms ${DETAIL_EASE} 10ms backwards; }
  .detail-enter-section:nth-of-type(2) { animation-delay: 40ms; }
  .detail-enter-section:nth-of-type(3) { animation-delay: 70ms; }
  .detail-enter-section:nth-of-type(4) { animation-delay: 100ms; }
  .detail-enter-section:nth-of-type(5) { animation-delay: 130ms; }
  .detail-enter-section:nth-of-type(n+6) { animation-delay: 160ms; }
  @keyframes detail-reveal {
    from { opacity: 0; transform: translateY(7px); }
    to { opacity: 1; transform: translateY(0); }
  }
}
.detail-section h2 { margin: 0 0 .65rem; padding-inline-start: .6rem; border-inline-start: 3px solid var(--accent); font-size: 1.12rem; }
.detail-section p { line-height: 1.85; }
.detail-hero { padding-block: .65rem 1rem; }
.detail-section p, .detail-section dl { margin: 0.25rem 0 0.5rem; overflow-wrap: anywhere; }
.detail-section p, .detail-section dd { unicode-bidi: plaintext; }
.detail-section dt, .subtle { color: var(--muted); font-size: 0.88rem; }
.detail-section dd { margin: 0 0 0.45rem; }
.detail-section summary { cursor: pointer; min-height: 44px; padding-block: 0.55rem; }
.detail-section details > summary { color: var(--accent); }
.season { background: var(--card); padding-inline: 0.65rem; border-radius: 10px; margin-block: 0.4rem; border: 1px solid var(--line); }
.season-name { font-weight: 700; color: var(--ink); }
.season-info { display: block; color: var(--muted); font-size: .875rem; font-variant-numeric: tabular-nums; }
.season label { display: flex; align-items: center; gap: 0.5rem; min-height: 44px; }
.season input[type=checkbox] { width: 20px; height: 20px; min-height: 0; flex: none; }
.season input[type=text] { margin-bottom: 0.5rem; }
.season-selectable { position: relative; }
.season-selectable > .season-content > summary { padding-inline-end: 48px; }
.season-selectable > .season-checkbox { position: absolute; inset-inline-end: .2rem; inset-block-start: 0; width: 44px; display: grid; place-items: center; cursor: pointer; }
.season-selectable .season-checkbox input { margin: 0; accent-color: var(--accent); }
.season input[aria-invalid="true"] { border: 2px solid var(--error); }
.season input[aria-invalid="true"]:focus-visible { outline-color: var(--error); }
.season .episode-error { margin: 0 0 .65rem; color: var(--error); font-size: .875rem; }
.season .episode-times { margin-bottom: 0.5rem; }
.recommendations { display: grid; grid-auto-flow: column; grid-auto-columns: clamp(94px, 25vw, 130px); gap: 0.6rem; overflow-x: auto; padding: 0.2rem 0.15rem 0.6rem; }
.rec { display: grid; align-content: start; gap: 0.25rem; color: inherit; text-decoration: none; font-size: 0.85rem; overflow-wrap: anywhere; }
#detailActions { display: flex; gap: 0.5rem; width: min(100%, 740px); margin-inline: auto; }
#detailCart { min-height: 48px; }
.sum { margin: 0.2rem 0 0; display: grid; gap: 0.15rem; font-size: 0.95rem; }
.sum b { color: var(--accent); }
.price { color: var(--accent); font-size: 0.85rem; white-space: nowrap; }
.msg { color: var(--ok); font-weight: 600; margin: 0; }
.msg.bad { color: var(--error); }
#open { display: block; max-width: 44rem; margin-inline: auto; }
#dlg { max-height: 90dvh; border: 1px solid var(--line); }
#seasonPicker { max-height: 90dvh; border: 1px solid var(--line); padding: 0; overflow: hidden; }
#seasonPicker[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.season-picker-header, .season-picker-footer { padding: .8rem 1rem; }
.season-picker-header { display: flex; align-items: start; justify-content: space-between; gap: .65rem; }
#seasonPicker h2 { margin: 0; font-size: 1.15rem; }
#seasonPickerName { color: var(--muted); overflow-wrap: anywhere; }
#closeSeasonPicker { min-width: 44px; padding: 0; font-size: 1.35rem; }
#seasonPickerScroll { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 1rem .65rem; }
#pickWholeSeries { background: var(--wash); color: var(--ink); border: 1px solid var(--line); }
#pickWholeSeries[aria-pressed="true"] { border-color: var(--accent); }
.season-picker-footer { border-block-start: 1px solid var(--line); background: var(--bg); }
#seasonPickerSelection { margin: 0 0 .55rem; font-size: .9rem; font-weight: 650; overflow-wrap: anywhere; }
#seasonPicker .season summary { cursor: pointer; min-height: 44px; padding-block: .55rem; }
#seasonPicker .season-checkbox { display: flex; width: auto; padding-inline: .5rem; gap: .4rem; font-size: .85rem; }
#seasonPicker .season-content > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding-inline-end: 0; list-style: none; }
#seasonPicker .season-content > summary::-webkit-details-marker { display: none; }
#seasonPicker .season-info { grid-column: 1; }
.picker-episode-toggle { grid-column: 2; grid-row: 2; align-self: end; min-height: 28px; color: var(--accent); font-size: .85rem; }
.picker-episode-toggle::after { content: ' ◂'; }
.season-content[open] .picker-episode-toggle::after { content: ' ▾'; }
#seasonPicker .season:has(.season-checkbox input:checked) { border-color: var(--accent); background: var(--wash); }
#seasonPicker .episode-field { display: grid; gap: .2rem; font-size: .9rem; }
#seasonPickerBody { margin-block-start: .65rem; }
#dlg h2 { margin: 0; font-size: 1.35rem; }
#dlg label { display: grid; gap: .25rem; color: var(--muted); font-size: .9rem; }
#dlg label :is(input,textarea) { font-size: 1rem; }
#dlg .sum:not(:empty) { padding: .65rem .8rem; background: var(--wash); border-radius: .5rem; }
#mine .row { border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
@media (max-width: 36rem) {
  #dlg, #seasonPicker { width: 100%; max-width: 100%; margin: auto 0 0; border-radius: 1.25rem 1.25rem 0 0; }
  #dlg { padding-bottom: calc(1rem + env(safe-area-inset-bottom)); }
  .season-picker-footer { padding-bottom: calc(.8rem + env(safe-area-inset-bottom)); }
}
.wide { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 1.2rem 0; display: grid; gap: 0.6rem; justify-items: center; }
.wide .ask { width: 100%; max-width: 420px; text-align: start; display: grid; gap: 0.5rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem; color: var(--ink); }
.wide .ask p { margin: 0; }
.wide .ask button { min-height: 44px; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 10px; font: inherit; }
</style>
</head>
<body>
<header id="catalogHead">
  <div class="masthead"><div class="top"><h1>${x.title}</h1><button id="themeToggle" class="theme-toggle" type="button" hidden></button></div>
  <div class="lookup"><input id="q" type="search" placeholder="${x.search}" autocomplete="off" aria-label="${x.search}"></div>
  <p class="tariff" id="tariff" hidden></p>
  </div>
</header>
<section class="filters" id="catalogFilters">
  <div class="chips" id="kinds" role="group"></div>
  <div class="tools"><label for="sort">${x.sort}</label><select id="sort" aria-label="${x.sort}"></select><button class="chip" type="button" id="genreToggle" aria-expanded="false" aria-controls="genres">${x.genres} ▾</button></div>
  <div class="chips" id="genres" role="group" aria-label="${x.genres}" hidden></div>
</section>
<main id="grid"></main>
<main id="detailView" hidden>
  <div class="detail-toolbar"><button id="detailBack" type="button" class="chip">${x.back}</button><button id="detailThemeToggle" class="theme-toggle" type="button" hidden></button></div>
  <div id="detailBody"></div>
</main>
<div class="bar" id="bar"><button id="open" class="big" type="button"></button></div>
<div class="bar show" id="detailBar" hidden><div id="detailActions">
  <button id="detailAdd" type="button" class="big">${x.addToList}</button>
  <button id="detailCart" type="button" class="chip" hidden>${x.mine}</button>
</div></div>
<dialog id="dlg" aria-labelledby="listHeading">
  <form id="form" method="dialog">
    <h2 id="listHeading">${x.mine}</h2>
    <ul id="mine"></ul>
    <div class="sum" id="sum"></div>
    <label>${x.name}<input id="name" maxlength="80" autocomplete="name" required></label>
    <label>${x.phone}<input id="phone" maxlength="30" inputmode="tel" dir="ltr" autocomplete="tel"></label>
    <label>${x.note}<textarea id="note" maxlength="200" rows="2"></textarea></label>
    <p class="msg" id="msg" role="status"></p>
    <button type="submit" id="submit" class="big">${x.submit}</button>
    <button type="button" id="clearAll" class="big quiet">${x.clearAll}</button>
    <button type="button" id="close" class="big quiet">${x.close}</button>
  </form>
</dialog>
<dialog id="seasonPicker" aria-labelledby="seasonPickerTitle">
  <div class="season-picker-header">
    <div><h2 id="seasonPickerTitle">${x.seasonPicker}</h2><div id="seasonPickerName" dir="auto"></div></div>
    <button id="closeSeasonPicker" type="button" class="chip" aria-label="${x.close}">×</button>
  </div>
  <div id="seasonPickerScroll">
    <button id="pickWholeSeries" type="button" class="big" aria-pressed="false" hidden>${x.wholeSeries}</button>
    <div id="seasonPickerBody"></div>
  </div>
  <div class="season-picker-footer">
    <p id="seasonPickerSelection" role="status"></p>
    <button id="applySeasonPicker" type="button" class="big" disabled>${x.applySeasonPick}</button>
  </div>
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
  function parseEps(text, available) {
    var numbers = new Set();
    if (!text.trim()) return { numbers: [], error: '' };
    var last = Math.max.apply(null, available);
    var parts = norm(text).split(/[,،\\s]+/).filter(Boolean);
    if (!parts.length) return { error: T.episodeNumbersOnly };
    for (var part of parts) {
      var range = /^(\\d+)(?:[-–](\\d+))?$/.exec(part);
      if (!range) return { error: T.episodeNumbersOnly };
      var firstNumber = Number(range[1]), secondNumber = Number(range[2] ?? range[1]);
      if (Math.max(firstNumber, secondNumber) > last) return { error: T.lastAvailableEpisode + ' ' + fa(last) + ' است.' };
      for (var n = Math.min(firstNumber, secondNumber); n <= Math.max(firstNumber, secondNumber); n++) {
        if (!available.includes(n)) return { error: T.invalidEpisodes };
        numbers.add(n);
      }
    }
    return { numbers: [...numbers].sort(function (a, b) { return a - b; }), error: '' };
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
  var deviceTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  var storedTheme = store('catalogTheme');
  var themeOverride = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
  var themeButtons = [$('themeToggle'), $('detailThemeToggle')];
  function nextTheme() {
    return (themeOverride || (deviceTheme?.matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark';
  }
  function updateThemeButtons() {
    var switchToLight = nextTheme() === 'light';
    var label = switchToLight ? 'فعال کردن حالت روشن' : 'فعال کردن حالت تیره';
    themeButtons.forEach(function (button) {
      button.textContent = switchToLight ? '☀︎' : '☾';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.hidden = false;
    });
  }
  themeButtons.forEach(function (button) {
    button.onclick = function () {
      themeOverride = nextTheme();
      document.documentElement.setAttribute('data-theme', themeOverride);
      store('catalogTheme', themeOverride);
      updateThemeButtons();
    };
  });
  if (deviceTheme?.addEventListener) deviceTheme.addEventListener('change', updateThemeButtons);
  else deviceTheme?.addListener?.(updateThemeButtons);
  updateThemeButtons();
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
    var label = saved ? T.saved + ' · ' + T.receipt + ' ' + fa(wishId) : 'مرور لیست (' + fa(n) + ')';
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
    sortNew: function (a, b) { return b._year - a._year; },
    sortName: function (a, b) { return (a.f || a.t).localeCompare(b.f || b.t, 'fa'); },
    sortRating: function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); }
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
      var meta = [f.y].concat(tags).filter(Boolean).map(function (value) { return el('bdi', { dir: 'auto' }, [String(value)]); });
      var pick = el('button', { type: 'button', 'aria-pressed': String(on) }, [on ? T.picked : T.pick]);
      if (f.s > 0) pick.setAttribute('aria-haspopup', 'dialog');
      pick.onclick = function () {
        if (f.s > 0) { openSeasonPicker(f); return; }
        var selected = !chosen[f.k];
        setChoice(f, selected, null, false);
        card.className = selected ? 'film on' : 'film';
        pick.setAttribute('aria-pressed', String(selected));
        pick.textContent = selected ? T.picked : T.pick;
        updateBar();
      };
      pick.id = 'pick-' + f.k;
      var card = el('div', { 'class': 'film' + (on ? ' on' : '') }, [
        detailLink(f, { class: 'img', 'aria-label': title, tabindex: '-1' }, [poster(f, 'card-poster', true),
          f.r ? el('span', { class: 'rating', dir: 'ltr' }, ['★ ' + f.r]) : '']),
        el('div', { class: 'body' }, [detailLink(f, { class: 'title-link', id: 'title-' + f.k }, [
          el('b', { dir: 'auto' }, [title]),
        ]), subtitle ? el('small', { dir: 'auto', class: 'subtitle' }, [subtitle]) : '', el('small', { class: 'meta' }, meta), pick])]);
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
    updateBar();
  }
  function updateBar() {
    var n = Object.keys(chosen).length;
    $('bar').className = 'bar' + (n || wishId ? ' show' : '');
    syncSend();
  }
  function save() { store('pick', JSON.stringify(Object.keys(chosen))); store('sel', JSON.stringify(sel)); }
  function setChoice(f, include, selection, refreshGrid = true) {
    if (include) chosen[f.k] = f; else delete chosen[f.k];
    if (include && selection) sel[f.k] = selection; else delete sel[f.k];
    save();
    if (refreshGrid) render();
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
  var detailEntrance, routeRevision = 0;
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
      showRoute(ev.detail > 0);
    };
    return link;
  }
  function recommendation(key) {
    var f = filmByKey.get(key);
    return f && detailLink(f, { class: 'rec', 'data-recommendation': f.k }, [
      poster(f, 'rec-poster', true), el('span', { dir: 'auto' }, [f.f || f.t]),
    ]);
  }
  function showRoute(animate = false) {
    routeRevision += 1;
    detailEntrance?.cancel();
    detailEntrance = null;
    var hash = window.location?.hash || '';
    var detail = hash.startsWith('#title=');
    var key = '';
    if (detail) {
      try { key = decodeURIComponent(hash.slice(7)); } catch (e) { /* unknown title */ }
    }
    activeDetail = detail ? filmByKey.get(key) || null : null;
    var animateEntry = animate && activeDetail && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ['catalogHead', 'catalogFilters', 'grid', 'bar'].forEach(function (id) { $(id).hidden = detail; });
    $('detailView').hidden = !detail;
    $('detailBar').hidden = !activeDetail;
    if (activeDetail) renderTitle(activeDetail, { animateSections: animateEntry });
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
    if (animateEntry) {
      detailEntrance = $('detailBody').animate?.([
        { opacity: 0.65, transform: 'translateY(9px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 220, easing: '${DETAIL_EASE}' });
    }
  }
  $('detailBack').onclick = function () {
    if (window.history.state?.fromCatalog) window.history.back();
    else { window.history.replaceState(null, '', window.location.pathname + window.location.search); showRoute(); }
  };
  if (window.history) window.history.scrollRestoration = 'manual';
  window.addEventListener?.('popstate', function () { if (catalogReady) showRoute(); });

  function renderTitle(f, { retry = false, settled = false, animateSections = false } = {}) {
    var data = detailData.get(f.k);
    var add = $('detailAdd');
    function label(text, disabled) {
      add.textContent = text;
      add.disabled = disabled;
      $('detailCart').hidden = !(Object.keys(chosen).length || wishId);
    }
    var canPickSeasons = f.s > 0 || data?.seasons.some(function (season) { return season.selectable; });
    label(chosen[f.k] ? (canPickSeasons ? T.editSeasons : T.inList) : T.addToList, !!chosen[f.k] && !canPickSeasons);
    add.onclick = function () {
      if (canPickSeasons) { openSeasonPicker(f); return; }
      setChoice(f, true, null);
      label(T.inList, true);
    };
    renderDetailView({
      body: $('detailBody'), title: f, data: data, text: T, element: el, fa: fa,
      poster: function (film) { return poster(film, 'detail-poster', false); }, link: recommendation,
      controls: function (seasons) { return seasonEditor(f, seasons, label, add); },
      retry: retry ? function () { renderTitle(f); } : null,
      animateSections: animateSections,
    });
    if (data || settled) return;
    var revision = routeRevision;
    fetch('/api/detail?k=' + encodeURIComponent(f.k)).then(function (r) {
      if (!r.ok) throw new Error('bad');
      return r.json();
    }).then(function (j) {
      detailData.set(f.k, j.detail);
      if (activeDetail === f && revision === routeRevision) {
        var focusHeading = document.activeElement === $('detailTitle');
        renderTitle(f, { settled: true, animateSections: animateSections });
        if (focusHeading) $('detailTitle').focus({ preventScroll: true });
      }
    }).catch(function () {
      if (activeDetail === f && revision === routeRevision) renderTitle(f, { retry: true, settled: true });
    });
  }

  var seasonPickerRequest = 0;
  $('closeSeasonPicker').onclick = function () { $('seasonPicker').close(); };
  function openSeasonPicker(f) {
    var dialog = $('seasonPicker'), body = $('seasonPickerBody'), whole = $('pickWholeSeries');
    var apply = $('applySeasonPicker'), status = $('seasonPickerSelection');
    var request = ++seasonPickerRequest;
    $('seasonPickerName').textContent = f.t || f.f;
    $('seasonPickerScroll').scrollTop = 0;
    whole.hidden = true;
    whole.setAttribute('aria-pressed', 'false');
    apply.disabled = true;
    apply.textContent = T.applySeasonPick;
    apply.onclick = null;
    status.textContent = '';
    body.replaceChildren(el('p', { role: 'status' }, [T.loading]));
    if (!dialog.open) dialog.showModal();
    function commit(include, selection) {
      setChoice(f, include, selection);
      dialog.close();
      if (activeDetail === f) renderTitle(f);
      else $('pick-' + f.k)?.focus({ preventScroll: true });
    }
    function current() { return dialog.open && request === seasonPickerRequest; }
    fetch('/api/detail?k=' + encodeURIComponent(f.k)).then(function (r) {
      if (!r.ok) throw new Error('bad');
      return r.json();
    }).then(function (j) {
      if (!current()) return;
      var seasons = j.detail.seasons.filter(function (season) { return season.selectable; });
      whole.hidden = false;
      body.replaceChildren();
      function preview(include, selection) {
        var parts = [];
        if (include && !selection) parts.push(T.wholeSeries);
        if (selection) {
          selection.seasons.forEach(function (n) { parts.push(T.seasonN + ' ' + fa(n) + ' کامل'); });
          Object.entries(selection.episodes).forEach(function ([n, episodes]) {
            parts.push(fa(episodes.length) + ' ' + T.epWord + ' از ' + T.seasonN + ' ' + fa(n));
          });
        }
        if (parts.length > 3) {
          var count = Object.values(selection.episodes).reduce(function (total, episodes) { return total + episodes.length; }, 0);
          parts = [
            selection.seasons.length ? fa(selection.seasons.length) + ' فصل کامل' : '',
            count ? fa(count) + ' قسمت' : '',
          ].filter(Boolean);
        }
        var text = parts.join(' · ') || T.emptySeasonPick;
        if (status.textContent !== text) status.textContent = text;
        whole.setAttribute('aria-pressed', String(include && !selection));
      }
      preview(!!chosen[f.k], sel[f.k]);
      whole.onclick = function () {
        preview(true, null);
        apply.disabled = false;
        apply.onclick = function () { commit(true, null); };
      };
      if (seasons.length) {
        body.append(seasonEditor(f, seasons, function (text, disabled) {
            apply.textContent = text === T.remove && !disabled ? text : T.applySeasonPick;
            apply.disabled = disabled;
          }, apply, { commit: commit, whole: whole, preview: preview }));
      }
    }).catch(function () {
      if (!current()) return;
      var retry = el('button', { type: 'button', class: 'chip' }, [T.retry]);
      retry.onclick = function () { openSeasonPicker(f); };
      body.replaceChildren(el('p', { role: 'status' }, [T.detailError]), retry);
    });
  }

  function seasonEditor(f, seasons, label, action, { commit, whole: wholeSeries, preview } = {}) {
    var block = el('div', {});
    var rows = [];
    var current = sel[f.k];
    var dirty = false;
    var edit = el('button', { type: 'button', class: 'chip' }, [T.editSeasons]);
    block.append(edit);
    seasons.forEach(function (s) {
      var description = [];
      var choices = s.choiceEpisodes ?? s.episodes;
      if (commit) {
        if (choices?.length) description.push(fa(choices.length) + ' ' + T.epWord);
      } else {
        if (s.episodes) description.push(fa(s.episodes.length) + ' ' + T.availableEpisodes);
        else if (s.knownEpisodes) description.push(fa(s.knownEpisodes) + ' ' + T.knownEpisodes);
        if (s.average != null) description.push('★ ' + fa(s.average) + ' ' + T.average + ' · ' + fa(s.ratedEpisodes) + ' ' + T.ratingsCount);
      }
      var summary = el('summary', {}, [
        el('span', { class: 'season-name' }, [T.seasonN + ' ' + fa(s.season)]),
        description.length ? el('span', { class: 'season-info' }, [description.join(' · ')]) : '',
        commit ? el('span', { class: 'picker-episode-toggle' }, [T.episodeDisclosure]) : '',
      ]);
      var panel = el('details', { class: s.selectable ? 'season-content' : 'season' }, [summary]);
      var times = commit ? [] : Object.entries(s.runtimeByEpisode);
      var checkbox;
      if (s.selectable) {
        var whole = el('input', { type: 'checkbox', 'aria-label': T.wholeSeason + ' · ' + T.seasonN + ' ' + fa(s.season) });
        whole.checked = current ? current.seasons.includes(s.season) : !commit || !!chosen[f.k];
        var errorId = (commit ? 'picker' : 'details') + '-episode-error-' + s.season;
        var eps = choices?.length ? el('input', { type: 'text', inputmode: 'text', 'aria-label': T.episodesHint, 'aria-describedby': errorId, placeholder: T.episodesHint, dir: 'auto' }) : null;
        var errorText = el('p', { id: errorId, class: 'episode-error', 'aria-live': 'polite', hidden: '' });
        var row = { season: s.season, whole: whole, eps: eps, available: choices, panel: panel, summary: summary, errorText: errorText, rejected: false };
        if (eps) eps.value = (current?.episodes[s.season] || []).map(fa).join(' ');
        rows.push(row);
        whole.onchange = function () {
          if (whole.checked && eps) { eps.value = ''; row.rejected = false; }
          dirty = true;
          update();
        };
        if (eps) {
          eps.oninput = function () {
            var clean = eps.value.replace(/[^0-9۰-۹٠-٩،,\\s–-]/g, '');
            row.rejected = clean !== eps.value;
            if (row.rejected) eps.value = clean;
            if (eps.value.trim() || row.rejected) whole.checked = false;
            dirty = true;
            update();
          };
          panel.append(commit ? el('label', { class: 'episode-field' }, [T.episodeField, eps]) : eps, errorText);
        } else panel.append(el('p', { class: 'subtle' }, [T.noEpisodeNumbers]));
        checkbox = el('label', { class: 'season-checkbox' }, [whole, commit ? T.fullSeason : '']);
      }
      if (times.length) {
        panel.append(el('details', { class: 'episode-times' }, [
          el('summary', {}, [T.episodeTimes]),
          ...times.map(function (pair) { return el('p', {}, [T.epWord + ' ' + fa(pair[0]) + ' · ' + pair[1].replace(/^(\\d+) min$/, function (_, n) { return fa(n) + ' دقیقه'; })]); }),
        ]));
      }
      if (checkbox) block.append(el('div', { class: 'season season-selectable' }, [checkbox, panel]));
      else if (times.length) block.append(panel);
      else block.append(el('div', { class: 'season' }, [
        el('span', { class: 'season-name' }, [T.seasonN + ' ' + fa(s.season)]),
        description.length ? el('span', { class: 'season-info' }, [description.join(' · ')]) : '',
      ]));
    });
    edit.hidden = !!commit || !chosen[f.k] || !rows.length;
    edit.onclick = function () { rows[0].panel.open = true; rows[0].summary.focus(); };
    if (!rows.length) return block;
    if (wholeSeries) wholeSeries.onclick = function () {
      rows.forEach(function (row) {
        row.whole.checked = true;
        if (row.eps) row.eps.value = '';
        row.rejected = false;
        row.panel.open = false;
      });
      dirty = true;
      update();
    };

    function update() {
      var selection = { seasons: [], episodes: {} }, invalid = null;
      rows.forEach(function (row) {
        if (row.whole.checked) selection.seasons.push(row.season);
        if (!row.eps) return;
        var parsed = row.rejected ? { error: T.episodeNumbersOnly } : parseEps(row.eps.value, row.available);
        var numbers = parsed.numbers;
        row.eps.setCustomValidity(parsed.error);
        row.eps.setAttribute('aria-invalid', String(!!parsed.error));
        row.errorText.textContent = parsed.error;
        row.errorText.hidden = !parsed.error;
        if (parsed.error) invalid = invalid || row;
        else if (numbers.length && !row.whole.checked) selection.episodes[row.season] = numbers;
      });
      var include = !!(selection.seasons.length || Object.keys(selection.episodes).length);
      var next = selection.seasons.length === rows.length ? null : selection;
      preview?.(include, next);
      var before = JSON.stringify(sel[f.k] || null);
      var picked = !!chosen[f.k];
      var same = picked === include && (!include || before === JSON.stringify(next));
      if (!commit && !dirty) {
        label(picked ? T.editSeasons : T.addToList, false);
        action.onclick = function () { openSeasonPicker(f); };
        return;
      }
      var emptySelection = !include && (!picked || (commit && !dirty));
      var caption = !picked ? T.addToList : same && !invalid ? T.inList : include ? T.updatePick : T.remove;
      label(caption, !invalid && (same || emptySelection));
      action.onclick = function () {
        if (invalid) { invalid.panel.open = true; invalid.eps.reportValidity(); return; }
        if (same) return;
        if (commit) { commit(include, next); return; }
        setChoice(f, include, next);
        edit.hidden = !include;
        dirty = false;
        update();
      };
    }
    update();
    return block;
  }
  function load() {
    loadPrices();
    fetch('/api/films?lang=' + T.lang).then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); }).then(function (list) {
      films = list.map(function (f) {
        var cartoon = f.kd === 'animation' || f.kd === 'anime' ? 'کارتون انیمیشن' : '';
        f._n = norm([f.t, f.f, f.y, T[f.kd], cartoon].concat(f.a || [], f.g || []).filter(Boolean).join(' '));
        f._year = Number(norm(f.y).match(/^\\d{4}\\b/)?.[0]) || 0;
        return f;
      });
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
  ['sortNew', 'sortRating', 'sortName'].forEach(function (k) { $('sort').append(el('option', { value: k }, [T[k]])); });
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
      var x = el('button', { type: 'button', 'aria-label': T.remove + ' ' + (chosen[k].f || chosen[k].t) }, ['×']);
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

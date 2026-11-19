'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/core/db.js');
const { splitForTranslation, createTranslator, translateCached } = require('../src/core/translate.js');

const reply = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const ok = (text) => ({ responseStatus: 200, quotaFinished: false, responseData: { translatedText: text } });
const WARN = 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.';

test('split: sentences are grouped into chunks of at most 450 characters and rejoin to the text', () => {
  const sentence = `${'a'.repeat(38)}. `;
  const text = sentence.repeat(25).trim();
  const chunks = splitForTranslation(text);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 450));
  assert.equal(chunks.join(' '), text);
});

test('split: a long sentence without punctuation is split at spaces', () => {
  const text = Array.from({ length: 120 }, () => 'word').join(' ');
  const chunks = splitForTranslation(text);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 450));
  assert.equal(chunks.join(' '), text);
});

test('split: a word longer than the limit is cut rather than lost', () => {
  const chunks = splitForTranslation('x'.repeat(1000));
  assert.ok(chunks.every((c) => c.length <= 450));
  assert.equal(chunks.join(''), 'x'.repeat(1000));
});

test('translate: the request carries the text, en|fa, and the email only when given', async () => {
  const urls = [];
  const f = async (u) => { urls.push(new URL(u)); return { ok: true, status: 200, json: async () => ok('سلام') }; };
  assert.equal(await createTranslator({ fetch: f }).translate('Hello'), 'سلام');
  await createTranslator({ fetch: f, email: 'a@b.c' }).translate('Hello');
  assert.deepEqual([urls[0].searchParams.get('q'), urls[0].searchParams.get('langpair'), urls[0].searchParams.has('de')], ['Hello', 'en|fa', false]);
  assert.equal(urls[1].searchParams.get('de'), 'a@b.c');
});

test('translate: quota in every shape, network in the others', async () => {
  const kind = async (f) => { try { await createTranslator({ fetch: f }).translate('x'); return 'none'; } catch (e) { return e.kind; } };
  assert.equal(await kind(reply({ quotaFinished: true, responseStatus: 200, responseData: { translatedText: WARN } })), 'quota');
  assert.equal(await kind(reply(ok(WARN))), 'quota');
  assert.equal(await kind(reply({ responseStatus: 429, responseData: { translatedText: 'x' } })), 'quota');
  assert.equal(await kind(async () => { throw new Error('down'); }), 'network');
  assert.equal(await kind(reply({ responseStatus: 403, responseData: { translatedText: 'x' } })), 'network');
  assert.equal(await kind(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })), 'network');
});

test('translate: html entities are decoded', async () => {
  assert.equal(await createTranslator({ fetch: reply(ok('it&#39;s &quot;x&quot; &amp; &lt;y&gt;')) }).translate('x'), 'it\'s "x" & <y>');
});

test('translateCached: the same text is translated once', async () => {
  const db = openDb(); let calls = 0;
  const tr = { translate: async (s) => { calls += 1; return `fa:${s}`; } };
  assert.equal(await translateCached(db, tr, 'Hello there.'), 'fa:Hello there.');
  assert.equal(await translateCached(db, tr, 'Hello there.'), 'fa:Hello there.');
  assert.equal(calls, 1);
});

test('translateCached: quota on the 3rd chunk keeps the first two and resumes at the 3rd', async () => {
  const db = openDb();
  const text = ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)].map((s) => `${s}.`).join(' ');
  const seen = [];
  let n = 0;
  const failing = { translate: async (s) => { n += 1; if (n === 3) { const e = new Error('q'); e.kind = 'quota'; throw e; } seen.push(s[0]); return `fa${s[0]}`; } };
  await assert.rejects(translateCached(db, failing, text), { kind: 'quota' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM translations').get().c, 2);
  const again = [];
  const working = { translate: async (s) => { again.push(s[0]); return `fa${s[0]}`; } };
  assert.equal(await translateCached(db, working, text), 'faa fab fac');
  assert.deepEqual(again, ['c']);
});

test('translateCached: a failure on the first chunk stores nothing', async () => {
  const db = openDb();
  const tr = createTranslator({ fetch: reply(ok(WARN)) });
  await assert.rejects(translateCached(db, tr, 'Hello.'), { kind: 'quota' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM translations').get().c, 0);
});

test('translateCached: Persian text is returned as is, with no request', async () => {
  const db = openDb();
  const tr = { translate: async () => { throw new Error('no request expected'); } };
  assert.equal(await translateCached(db, tr, 'داستان یک مرد'), 'داستان یک مرد');
});

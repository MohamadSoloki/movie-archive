'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffWish } = require('../src/core/lists.js');

test('diffWish: films the customer newly picked are added, films they dropped are removed', () => {
  assert.deepEqual(diffWish({ have: ['a', 'b', 'c'], fromPhone: ['a', 'b'], wanted: ['b', 'd'] }), { add: ['d'], remove: ['a'] });
});

test('diffWish: a film the owner put in the list by hand is never removed, only phone films are', () => {
  assert.deepEqual(diffWish({ have: ['a', 'own'], fromPhone: ['a'], wanted: [] }), { add: [], remove: ['a'] });
});

test('diffWish: nothing changes when the list already matches; repeats count once', () => {
  assert.deepEqual(diffWish({ have: ['a', 'b'], fromPhone: ['a', 'b'], wanted: ['b', 'a', 'a'] }), { add: [], remove: [] });
  assert.deepEqual(diffWish({ have: [], fromPhone: [], wanted: ['x', 'x'] }), { add: ['x'], remove: [] });
});

test('diffWish: a film that was removed by the owner and is still wanted comes back only when it is new to the phone side', () => {
  // owner deleted "a" from the list; the customer still has it selected -> it is not re-added behind the owner's back
  assert.deepEqual(diffWish({ have: ['b'], fromPhone: ['a', 'b'], wanted: ['a', 'b'] }), { add: [], remove: [] });
});

'use strict';

// A customer sends their whole selection again: what to add to and take out of the list already made for them.
// `fromPhone` = films that came from this customer's earlier lists. Only those can be taken out; a film the owner added by hand stays,
// and a film the owner removed stays removed even if the customer still has it selected (it was already offered once).
function diffWish({ have = [], fromPhone = [], wanted = [] }) {
  const inList = new Set(have);
  const offered = new Set(fromPhone);
  const want = new Set(wanted);
  const add = [...want].filter((k) => !inList.has(k) && !offered.has(k));
  const remove = [...offered].filter((k) => inList.has(k) && !want.has(k));
  return { add, remove };
}

module.exports = { diffWish };

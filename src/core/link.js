'use strict';

// Works for imdb.com links, omdbapi.com links and a bare id. Never reads an apikey.
function extractImdbId(link) {
  const m = /\btt\d{7,10}\b/.exec(String(link));
  return m ? m[0] : null;
}

module.exports = { extractImdbId };

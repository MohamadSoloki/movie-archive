'use strict';

// Copy speed over the last few seconds (a whole-run average hides a slow drive) and the time left at that speed.
function createRate({ windowMs = 5000 } = {}) {
  const samples = [];
  return {
    // sample(timeMs, bytesSoFar, totalBytes) -> { bytesPerSec, etaSec }, both null until two samples exist
    sample(t, done, total) {
      samples.push({ t, done });
      // keep one sample at or before the window edge as the baseline
      while (samples.length > 2 && samples[1].t <= t - windowMs) samples.shift();
      const first = samples[0];
      if (samples.length < 2 || t <= first.t) return { bytesPerSec: null, etaSec: null };
      const bytesPerSec = Math.round(((done - first.done) * 1000) / (t - first.t));
      return { bytesPerSec, etaSec: bytesPerSec > 0 ? Math.ceil((total - done) / bytesPerSec) : null };
    },
  };
}

module.exports = { createRate };

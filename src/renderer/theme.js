'use strict';
// Runs in <head> before the page paints. No saved choice = follow the system; the button saves an explicit one.
(() => {
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem('theme'); } catch { return null; } };
  const saved = read();
  if (saved === 'dark' || saved === 'light') root.dataset.theme = saved;
  window.theme = {
    current: () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    toggle() {
      const next = this.current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch { /* private mode: the choice lasts until restart */ }
    },
  };
})();

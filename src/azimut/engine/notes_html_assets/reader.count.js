/*
 * Azimut reader, a page's view counter. A web folder carries it only when the page is to be
 * counted on the analyst's own GoatCounter site (engine/notes_html.py): a map page whose look
 * names one, or any page published to a site that counts with one (`<meta name="az-counter">`),
 * and the page's policy then lets in that one host. Read online, it counts the visit with
 * GoatCounter's pixel, with no cookie and none of their script. A map page then asks the site
 * how many views the page has and says it under the title; when the site does not answer within
 * a few seconds, or answers nothing to read, the line stays hidden: no dash, no word.
 */
(() => {
  'use strict';
  const WAIT_MS = 4000;
  const meta = document.querySelector('meta[name="az-counter"]');
  const line = document.querySelector('.az-mappage-views[data-counter]');
  const code = (meta && meta.content) || (line ? line.dataset.counter || '' : '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(code) || !/^https?:$/.test(location.protocol)) return;
  const site = `https://${code}.goatcounter.com`;
  const path = location.pathname || '/';
  const pixel = new Image();
  pixel.src = `${site}/count?p=${encodeURIComponent(path)}&t=${encodeURIComponent(document.title)}&rnd=${Math.random().toString(36).slice(2)}`;
  if (!line || typeof fetch !== 'function') return;
  const stop = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (stop) stop.abort(); }, WAIT_MS);
  fetch(`${site}/counter/${encodeURIComponent(path)}.json`, { signal: stop ? stop.signal : undefined, credentials: 'omit' })
    .then((answer) => (answer.ok ? answer.json() : null))
    .then((said) => {
      // GoatCounter writes the count with its own separators: "1 234", "1,234"
      const count = String((said && said.count) || '').trim();
      const digits = count.replace(/\D/g, '');
      if (!/^\d[\d\s.,'  ]*$/.test(count) || !Number(digits)) return;
      line.textContent = `${count} view${digits === '1' ? '' : 's'}`;
      line.hidden = false;
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
})();

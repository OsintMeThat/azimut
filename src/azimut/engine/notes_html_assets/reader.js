/*
 * Azimut reader: what an exported HTML report does when it is read. Inlined by
 * engine/notes_html.py beside reader.css; no library, no network, nothing kept.
 * It only adds to a page that reads whole without it. The one exception is a web
 * folder read online, whose maps it hands to reader.live.js (`online` in reader.map.js).
 */
(() => {
  'use strict';
  const doc = document;
  const root = doc.documentElement;
  root.classList.add('az-js');
  const query = (text) => (window.matchMedia ? window.matchMedia(text) : { matches: false });
  const reduced = query('(prefers-reduced-motion: reduce)');
  const wide = query('(min-width: 64rem)');
  const roomy = query('(min-width: 85rem)');
  // the story layout: each picture held still while the words after it go by
  const story = root.dataset.web === 'story';
  const motion = () => (reduced.matches ? 'auto' : 'smooth');
  const all = (selector, within = doc) => [...within.querySelectorAll(selector)];
  const words = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
  const quietly = (promise) => promise && promise.catch && promise.catch(() => {});
  let made = 0;
  const idOf = (node) => node.id || (node.id = `az-made-${(made += 1)}`);
  const byHash = (hash) => {
    const id = decodeURIComponent(String(hash || '').slice(1));
    return id ? doc.getElementById(id) : null;
  };
  function make(tag, attrs = {}, text) {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    return node;
  }
  /* what follows the reading: one pass per frame while the page scrolls, and at once on a resize */
  const watchers = [];
  let queued = false;
  const each = () => { for (const watcher of watchers) watcher(); };
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; each(); });
  }, { passive: true });
  window.addEventListener('resize', each);

  /* a thin line at the top says how far the page has been read */
  function progress() {
    const line = make('div', { class: 'az-progress', 'aria-hidden': 'true' });
    doc.body.prepend(line);
    const read = () => {
      const room = root.scrollHeight - window.innerHeight;
      line.style.setProperty('--read', room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)).toFixed(4) : '0');
    };
    watchers.push(read);
    read();
  }

  /* the contents follow the reading: a rail in the margin with room for it, else a bar at the top
     with the title, the part being read and the list a press away */
  function contents() {
    const nav = doc.querySelector('.az-contents');
    if (!nav) return;
    const list = nav.querySelector('ol');
    const marks = all('a[href^="#"]', nav).map((link) => ({ link, target: byHash(link.getAttribute('href')) })).filter((mark) => mark.target);
    const toggle = make('button', { type: 'button', class: 'az-contents-toggle', 'aria-expanded': 'false' });
    const now = make('span', { class: 'az-contents-now' });
    toggle.append(make('span', { class: 'az-bar-title' }, words(doc.querySelector('.az-title')) || doc.title), now,
      make('span', { class: 'az-contents-word' }, 'Contents'));
    if (list) toggle.setAttribute('aria-controls', idOf(list));
    nav.prepend(toggle);
    const open = (on) => {
      nav.classList.toggle('az-open', on);
      toggle.setAttribute('aria-expanded', String(on));
    };
    const barred = () => story || !roomy.matches;
    const settle = () => {
      nav.classList.toggle('az-bar', barred());
      root.classList.toggle('az-barred', barred());
      if (!barred()) open(false);
    };
    roomy.addEventListener?.('change', settle);
    settle();
    toggle.addEventListener('click', () => open(!nav.classList.contains('az-open')));
    nav.addEventListener('click', (event) => { if (event.target.closest('a')) open(false); });
    nav.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('az-open')) { open(false); toggle.focus(); }
    });
    let current = null;
    const mark = () => {
      const line = window.innerHeight * 0.28;
      let found = marks[0] || null;
      for (const item of marks) if (item.target.getBoundingClientRect().top <= line) found = item;
      if (found === current) return;
      current?.link.removeAttribute('aria-current');
      current = found;
      if (!found) return;
      found.link.setAttribute('aria-current', 'true');
      now.textContent = words(found.link);
      // the link stays in sight in a long rail, without moving the page
      if (barred() || !list) return;
      const box = list.getBoundingClientRect();
      const at = found.link.getBoundingClientRect();
      if (at.top < box.top + 32 || at.bottom > box.bottom - 32) list.scrollTop += at.top - box.top - box.height / 3;
    };
    watchers.push(mark);
    mark();
  }

  /* a picture opens large: zoomed, moved, its caption and credit kept with it */
  const lightbox = (() => {
    let box, stage, picture, caption, credit, level, opener;
    const view = { fit: 1, scale: 1, x: 0, y: 0 };
    const button = (act, text, label) => make('button', { type: 'button', 'data-act': act, title: label, 'aria-label': label }, text);

    function build() {
      box = make('dialog', { class: 'az-lightbox', 'aria-label': 'Picture' });
      const bar = make('div', { class: 'az-lb-bar' });
      level = make('span', { class: 'az-lb-level', 'aria-live': 'polite' }, '100%');
      bar.append(button('out', '−', 'Zoom out'), level, button('in', '+', 'Zoom in'), button('fit', 'Fit', 'The whole picture'), button('close', '× Close', 'Close'));
      stage = make('div', { class: 'az-lb-stage' });
      picture = make('img', { alt: '', draggable: 'false' });
      stage.append(picture);
      const foot = make('div', { class: 'az-lb-foot' });
      caption = make('div', { class: 'az-lb-caption' });
      credit = make('div', { class: 'az-lb-credit' });
      foot.append(caption, credit);
      box.append(bar, stage, foot);
      doc.body.append(box);
      bar.addEventListener('click', (event) => {
        const act = event.target.closest('button')?.getAttribute('data-act');
        if (act === 'close') close();
        else if (act) zoom({ in: 1.5, out: 1 / 1.5, fit: 0 }[act]);
      });
      box.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
      box.addEventListener('keydown', keys);
      stage.addEventListener('wheel', (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.18 : 1 / 1.18, spot(event)); }, { passive: false });
      stage.addEventListener('dblclick', (event) => zoom(view.scale > view.fit * 1.01 ? 0 : 2.5, spot(event)));
      let from = null;
      stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        from = { x: event.clientX - view.x, y: event.clientY - view.y, id: event.pointerId };
        stage.setPointerCapture?.(event.pointerId);
      });
      stage.addEventListener('pointermove', (event) => {
        if (from?.id !== event.pointerId) return;
        view.x = event.clientX - from.x;
        view.y = event.clientY - from.y;
        paint(false);
      });
      for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, () => { from = null; });
      window.addEventListener('resize', () => { if (box.open) zoom(0); });
    }

    const spot = (event) => {
      const at = stage.getBoundingClientRect();
      return { x: event.clientX - at.left, y: event.clientY - at.top };
    };
    const size = () => ({
      w: stage.clientWidth || window.innerWidth, h: stage.clientHeight || window.innerHeight,
      iw: picture.naturalWidth || 1, ih: picture.naturalHeight || 1,
    });
    /** The picture never leaves the stage: smaller than it, it stays in the middle. */
    function paint(moving) {
      const s = size();
      const w = s.iw * view.scale;
      const h = s.ih * view.scale;
      view.x = w <= s.w ? (s.w - w) / 2 : Math.min(0, Math.max(s.w - w, view.x));
      view.y = h <= s.h ? (s.h - h) / 2 : Math.min(0, Math.max(s.h - h, view.y));
      stage.classList.toggle('az-moving', moving && !reduced.matches);
      picture.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      level.textContent = `${Math.round((view.scale / view.fit) * 100)}%`;
    }
    /** Zoom by `factor` about a point of the stage, its middle by default; 0 shows the whole picture. */
    function zoom(factor, at) {
      const s = size();
      view.fit = Math.min(s.w / s.iw, s.h / s.ih, 1);
      const to = factor ? Math.min(Math.max(view.scale * factor, view.fit), Math.max(view.fit * 8, 4)) : view.fit;
      const p = at || { x: s.w / 2, y: s.h / 2 };
      view.x = p.x - ((p.x - view.x) * to) / view.scale;
      view.y = p.y - ((p.y - view.y) * to) / view.scale;
      view.scale = to;
      paint(true);
    }
    function keys(event) {
      const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
      const factors = { '+': 1.5, '=': 1.5, '-': 1 / 1.5, 0: 0 };
      if (event.key === 'Tab') {
        // Tab goes round the lightbox's own buttons, never behind it
        const stops = all('button', box);
        const at = stops.indexOf(doc.activeElement);
        stops[event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length].focus();
      } else if (event.key === 'Escape') close();
      else if (Object.hasOwn(factors, event.key)) zoom(factors[event.key]);
      else if (moves[event.key]) {
        view.x += moves[event.key][0];
        view.y += moves[event.key][1];
        paint(true);
      } else return;
      event.preventDefault();
    }
    function open(source) {
      const image = source.querySelector('img');
      if (!image) return;
      if (!box) build();
      const figure = source.closest('figure');
      opener = source;
      // a wall's frame shows a small picture and opens a larger one
      picture.src = source.dataset.large || image.currentSrc || image.src;
      picture.alt = image.alt || '';
      box.setAttribute('aria-label', image.alt || 'Picture');
      caption.replaceChildren();
      credit.replaceChildren();
      const said = figure?.querySelector('.az-caption');
      const owed = figure?.querySelector('.az-credit');
      if (said) caption.append(said.cloneNode(true));
      if (owed) credit.append(owed.cloneNode(true));
      for (const node of all('[id]', box)) node.removeAttribute('id');
      for (const node of [...all('[hidden]', caption), ...all('[hidden]', credit)]) node.removeAttribute('hidden');
      if (box.showModal) box.showModal(); else box.setAttribute('open', '');
      root.classList.add('az-locked');
      view.scale = 1;
      if (picture.complete) zoom(0); else picture.addEventListener('load', () => zoom(0), { once: true });
      box.querySelector('[data-act="close"]').focus();
    }
    function close() {
      if (box.open && box.close) box.close();
      box.removeAttribute('open');
      root.classList.remove('az-locked');
      opener?.focus();
      opener = null;
    }
    return { open, close: () => { if (box?.hasAttribute('open')) close(); } };
  })();

  /* a press on a picture opens it; a graphic one is shown first */
  function pictures() {
    doc.addEventListener('click', (event) => {
      const button = event.target.closest('button.az-zoom');
      if (!button) return;
      const veiled = button.closest('.az-graphic');
      if (veiled && !veiled.classList.contains('az-revealed')) {
        veiled.classList.add('az-revealed');
        button.setAttribute('aria-label', button.dataset.label || 'Open larger');
        return;
      }
      lightbox.open(button);
    });
    for (const figure of all('.az-graphic')) {
      const button = figure.querySelector('.az-zoom');
      if (button) {
        button.dataset.label = button.getAttribute('aria-label') || '';
        button.setAttribute('aria-label', 'Graphic picture, blurred. Press to show it');
      }
      for (const clip of all('video', figure)) clip.addEventListener('play', () => figure.classList.add('az-revealed'), { once: true });
    }
  }

  /* a pair slides: the keyboard's arrows, or a drag anywhere on it */
  function pairs() {
    for (const pair of all('.az-compare')) {
      const slider = pair.querySelector('.az-slider');
      if (!slider) continue;
      const set = () => {
        const value = Math.min(100, Math.max(0, Number(slider.value) || 0));
        pair.style.setProperty('--az-split', `${value}%`);
        slider.setAttribute('aria-valuetext', `${value}% before, ${100 - value}% after`);
      };
      const follow = (event) => {
        const at = pair.getBoundingClientRect();
        if (!at.width) return;
        slider.value = String(Math.round(((event.clientX - at.left) / at.width) * 1000) / 10);
        set();
      };
      let held = null;
      slider.addEventListener('input', set);
      pair.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        held = event.pointerId;
        pair.setPointerCapture?.(held);
        follow(event);
        slider.focus({ preventScroll: true });
        event.preventDefault();
      });
      pair.addEventListener('pointermove', (event) => { if (held === event.pointerId) follow(event); });
      for (const type of ['pointerup', 'pointercancel']) pair.addEventListener(type, () => { held = null; });
      set();
    }
  }

  /* a timecode plays its passage of the clip, and stops at its end */
  function timecodes() {
    doc.addEventListener('click', (event) => {
      const link = event.target.closest('a.az-time');
      const clip = link && doc.getElementById(link.dataset.clip || link.hash.slice(1));
      if (!clip?.play) return;
      event.preventDefault();
      const end = Number(link.dataset.end) || 0;
      reveal(clip);
      for (const other of all('a.az-playing')) other.classList.remove('az-playing');
      link.classList.add('az-playing');
      const stop = () => {
        if (end && clip.currentTime >= end) clip.pause();
      };
      clip.addEventListener('timeupdate', stop);
      clip.addEventListener('pause', () => {
        link.classList.remove('az-playing');
        clip.removeEventListener('timeupdate', stop);
      }, { once: true });
      try { clip.currentTime = Number(link.dataset.t) || 0; } catch { /* not loaded yet: it starts from the top */ }
      quietly(clip.play());
      clip.scrollIntoView?.({ block: 'center', behavior: motion() });
    });
  }

  /** Bring what `node` sits in into sight: the step that holds it. */
  function reveal(node) {
    const step = node.closest?.('.az-steps > .az-step');
    step?.parentNode.azShow?.(all(':scope > .az-step', step.parentNode).indexOf(step));
  }

  /* a table sorts by any column, filters past twelve rows, and points at a coded row; its
     settings line may ask for the filter always or never, no sorting, or its first rows only */
  const NUMBER = /^[~≈<>≥≤+-]?\s*-?[\d\s.,]*\d(?:[.,]\d+)?\s*(?:%|km|m|s|h)?$/i;
  const numeric = (text) => (NUMBER.test(text) ? Number(text.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')) : NaN);

  function tables() {
    for (const table of all('table.az-table')) {
      const body = table.querySelector(':scope > tbody');
      if (!body) continue;
      const rows = all(':scope > tr', body);
      const heads = all(':scope > thead > tr:first-child > th', table);
      const { search, sort } = table.dataset;
      const fold = Number(table.dataset.fold) || 0;
      let open = false;
      let wanted = '';
      let more = null;
      // past its first rows a long table folds, unless shown whole or filtered
      const refold = () => {
        let shown = 0;
        for (const row of all(':scope > tr', body)) row.classList.toggle('az-folded', fold > 0 && !open && !wanted && (shown += 1) > fold);
        if (more) more.textContent = open ? `Show the first ${fold} rows` : `Show all ${rows.length} rows`;
        // Chromium draws a column kept in sight out of place once rows come and go: it is laid out again
        if (table.classList.contains('az-first')) {
          table.classList.remove('az-first');
          void table.offsetWidth;
          table.classList.add('az-first');
        }
      };
      // a hash or an address in a cell may break anywhere, rather than widen the table
      for (const cell of all(':scope > tr > td', body)) if (/\S{24,}/.test(cell.textContent)) cell.classList.add('az-token');
      if (sort !== 'off') heads.forEach((head, column) => {
        // a column with no header holds the rows' labels: nothing to sort by
        if (!words(head)) return;
        const button = make('button', { type: 'button', class: 'az-sort', title: 'Sort by this column' });
        button.append(...head.childNodes);
        head.append(button);
        button.addEventListener('click', () => {
          const down = head.getAttribute('aria-sort') === 'ascending';
          for (const other of heads) other.removeAttribute('aria-sort');
          head.setAttribute('aria-sort', down ? 'descending' : 'ascending');
          const cell = (row) => words(row.children[column]);
          const counted = rows.every((row) => !cell(row) || !Number.isNaN(numeric(cell(row))));
          const order = (a, b) => (counted ? (numeric(cell(a)) || 0) - (numeric(cell(b)) || 0)
            : cell(a).localeCompare(cell(b), undefined, { numeric: true, sensitivity: 'base' }));
          body.append(...rows.slice().sort((a, b) => (down ? -order(a, b) : order(a, b))));
          refold();
        });
      });
      const wrap = table.closest('.az-table-wrap') || table;
      // a table wider than its place slides in its own frame; one that fits keeps its header stuck to the page
      const fits = () => wrap.classList.toggle('az-slides', table.scrollWidth > wrap.clientWidth + 1);
      fits();
      window.addEventListener('resize', fits);
      // the filter and the fold stand on the table's own edges: they share a box as wide as the table
      const boxed = () => {
        if (wrap.parentNode.classList?.contains('az-table-block')) return;
        const block = make('div', { class: 'az-table-block' });
        wrap.replaceWith(block);
        block.append(wrap);
      };
      if (fold && rows.length > fold) {
        more = make('button', { type: 'button', class: 'az-table-more', 'aria-expanded': 'false' });
        more.addEventListener('click', () => {
          open = !open;
          more.setAttribute('aria-expanded', open);
          refold();
        });
        boxed();
        wrap.after(more);
        table.azUnfold = () => { open = true; refold(); };
        refold();
      }
      if (search === 'never' || (search !== 'always' && rows.length <= 12)) continue;
      const tools = make('div', { class: 'az-table-tools' });
      const field = make('input', { type: 'search', class: 'az-filter', placeholder: 'Filter the rows', 'aria-label': 'Filter the rows of this table' });
      const said = make('span', { 'aria-live': 'polite' }, `${rows.length} rows`);
      tools.append(field, said);
      boxed();
      wrap.before(tools);
      const texts = rows.map((row) => words(row).toLocaleLowerCase());
      field.addEventListener('input', () => {
        wanted = field.value.trim().toLocaleLowerCase();
        let shown = 0;
        rows.forEach((row, index) => {
          row.hidden = Boolean(wanted) && !texts[index].includes(wanted);
          if (!row.hidden) shown += 1;
        });
        said.textContent = wanted ? `${shown} of ${rows.length} rows` : `${rows.length} rows`;
        if (more) more.hidden = Boolean(wanted);
        refold();
      });
      table.azFilter = field;
    }
  }

  /** The row, source or heading an address names, made ready to be seen: its step shown, a hidden row filtered back in, a row or source flashed. */
  function point(hash) {
    const target = byHash(hash);
    if (!target) return null;
    reveal(target);
    const field = target.tagName === 'TR' && target.closest('table')?.azFilter;
    if (target.hidden && field) {
      field.value = '';
      field.dispatchEvent(new Event('input'));
    }
    if (target.classList?.contains('az-folded')) target.closest('table').azUnfold();
    if (target.matches?.('tr, .az-sources li')) {
      target.classList.remove('az-flash');
      void target.offsetWidth;
      target.classList.add('az-flash');
    }
    return target;
  }

  /* a link to a part of the page goes there by itself. In the Page pane the page is a frame
     whose address is the app's, which the browser would leave for a blank page */
  const ownAddress = () => /^(?:file|https?):$/.test(location.protocol);
  function go(hash) {
    lightbox.close();
    const target = point(hash);
    if (!target) return;
    target.scrollIntoView?.({ behavior: motion(), block: target.tagName === 'TR' ? 'center' : 'start' });
    // the keyboard follows, from where the page now reads
    if (!target.matches('a[href], button, input, select, textarea, summary, video, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
    if (ownAddress() && location.hash !== hash) {
      try { history.pushState(null, '', hash); } catch { /* a page that may not change its address keeps it */ }
    }
  }

  function addresses() {
    doc.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href^="#"]');
      if (!link || event.defaultPrevented) return;
      // a new tab of a file opens the file there; of the Page pane's frame it would open the app
      if ((event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) && ownAddress()) return;
      event.preventDefault();
      go(link.getAttribute('href'));
    });
    doc.addEventListener('auxclick', (event) => {
      if (!ownAddress() && event.target.closest?.('a[href^="#"]')) event.preventDefault();
    });
    window.addEventListener('hashchange', () => point(location.hash));
    if (location.hash) point(location.hash);
  }

  /* a citation shows its source from the Sources list, on hover or focus */
  function citations() {
    let card = null;
    let shown = null;
    let timer = 0;
    const hide = () => {
      clearTimeout(timer);
      shown?.removeAttribute('aria-describedby');
      shown?.removeAttribute('aria-expanded');
      shown = null;
      card?.remove();
    };
    function show(link) {
      const number = link.dataset.src || link.hash.replace(/^#src-/, '');
      const entry = doc.getElementById(`src-${number}`);
      if (!entry) return;
      hide();
      card = make('div', { class: 'az-card', role: 'tooltip', id: 'az-card' });
      card.append(make('span', { class: 'az-card-number' }, `Source ${number}`));
      const copy = entry.cloneNode(true);
      for (const node of all('[id]', copy)) node.removeAttribute('id');
      for (const node of all('.az-back', copy)) node.remove();
      card.append(...copy.childNodes);
      doc.body.append(card);
      shown = link;
      link.setAttribute('aria-describedby', 'az-card');
      link.setAttribute('aria-expanded', 'true');
      const at = link.getBoundingClientRect();
      const own = card.getBoundingClientRect();
      const below = at.bottom + 8 + own.height < window.innerHeight || at.top < own.height + 16;
      card.style.left = `${Math.min(Math.max(8, at.left + at.width / 2 - own.width / 2), window.innerWidth - own.width - 8) + window.scrollX}px`;
      card.style.top = `${(below ? at.bottom + 8 : at.top - own.height - 8) + window.scrollY}px`;
    }
    for (const link of all('a.az-cite')) {
      link.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => show(link), 120); });
      link.addEventListener('mouseleave', hide);
      link.addEventListener('focus', () => show(link));
      link.addEventListener('blur', hide);
    }
    doc.addEventListener('keydown', (event) => { if (event.key === 'Escape' && shown) hide(); });
    window.addEventListener('scroll', () => { if (shown && !shown.matches(':focus')) hide(); }, { passive: true });
  }

  /* steps go one at a time: the buttons, the dots, the arrow keys; a step's clip plays muted */
  function steps() {
    for (const section of all('section.az-steps')) {
      const list = all(':scope > .az-step', section);
      if (list.length < 2) continue;
      // the bar comes with the page, hidden: without script the steps stay stacked
      const bar = section.querySelector(':scope > .az-steps-bar');
      const back = bar?.querySelector('.az-steps-prev');
      const next = bar?.querySelector('.az-steps-next');
      if (!back || !next) continue;
      bar.hidden = false;
      const dots = all('.az-steps-dots button', bar);
      const count = make('span', { class: 'az-steps-count', 'aria-live': 'polite' });
      next.before(count);
      let at = -1;
      function show(index) {
        index = Math.max(0, Math.min(list.length - 1, index));
        if (index === at) return;
        at = index;
        list.forEach((step, i) => {
          const on = i === index;
          step.classList.toggle('az-on', on);
          step.toggleAttribute('inert', !on);
          step.setAttribute('aria-hidden', String(!on));
          for (const clip of all('video', step)) {
            if (!on) { clip.pause?.(); continue; }
            clip.muted = true;
            quietly(clip.play?.());
          }
          if (dots[i]) {
            if (on) dots[i].setAttribute('aria-current', 'step');
            else dots[i].removeAttribute('aria-current');
          }
        });
        back.disabled = index === 0;
        next.disabled = index === list.length - 1;
        count.textContent = `${index + 1} / ${list.length}`;
        // a button just put out of reach hands the keyboard to the step's dot
        if (doc.activeElement?.disabled) dots[index]?.focus();
        const dot = dots[index];
        const row = dot?.closest('.az-steps-dots');
        if (row && row.scrollWidth > row.clientWidth) row.scrollLeft = dot.offsetLeft - row.clientWidth / 2;
      }
      back.addEventListener('click', () => show(at - 1));
      next.addEventListener('click', () => show(at + 1));
      dots.forEach((dot, index) => dot.addEventListener('click', () => show(index)));
      section.addEventListener('keydown', (event) => {
        if (event.target.closest('input, video')) return;
        const rtl = getComputedStyle(section).direction === 'rtl';
        const go = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
        if (go) show(at + go);
        else if (event.key === 'Home') show(0);
        else if (event.key === 'End') show(list.length - 1);
        else return;
        event.preventDefault();
      });
      if (!section.hasAttribute('tabindex')) section.tabIndex = -1;
      section.setAttribute('aria-roledescription', 'steps');
      section.azShow = show;
      show(0);
    }
  }

  /* a story keeps the picture of the step being read beside the words, and moves in on what it names */
  /** `x,y,w,h` as fractions of the picture, or null. */
  function zoomOf(figure) {
    const [x, y, w, h] = String(figure?.dataset.zoom || '').split(',').map(Number);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
    return { x, y, w, h };
  }
  /** The transform that fills the picture's box with its zoom rectangle, kept whole. */
  function zoomTransform(zoom) {
    if (!zoom) return 'none';
    const scale = Math.min(6, 1 / Math.max(zoom.w, zoom.h));
    const dx = (0.5 - (zoom.x + zoom.w / 2)) * 100;
    const dy = (0.5 - (zoom.y + zoom.h / 2)) * 100;
    return `scale(${scale.toFixed(4)}) translate(${dx.toFixed(3)}%, ${dy.toFixed(3)}%)`;
  }

  function stories() {
    for (const section of all('section.az-story')) {
      const figures = all('.az-story-figures > figure', section);
      const parts = all('.az-story-step', section);
      if (!figures.length || !parts.length) continue;
      const figureOf = (step) => figures.find((figure) => figure.dataset.step === step?.dataset.step) || null;
      const imageOf = (figure) => figure?.querySelector('img');
      let at = null;
      // where the reader is, quietly on each card of a story written as one: 2 / 4
      const scenes = section.classList.contains('az-scenes');
      const counts = parts.map((part, index) => (scenes ? null
        : make('span', { class: 'az-story-count', 'aria-hidden': 'true' }, `${index + 1} / ${parts.length}`)));
      function show(step) {
        if (step === at) return;
        const before = figureOf(at);
        at = step;
        const figure = figureOf(step);
        for (const part of parts) part.classList.toggle('az-on', part === step);
        if (!figure) return;
        for (const other of figures) {
          other.classList.toggle('az-on', other === figure);
          other.setAttribute('aria-hidden', String(other !== figure));
          other.toggleAttribute('inert', other !== figure);
        }
        // a map is moved by its card: where its step looks, or the whole map for its words
        if (figure.azMap) { figure.azMap.story(step?.dataset.mapStep); return; }
        const image = imageOf(figure);
        if (!image) return;
        // the same picture moves on from where the last step left it; another starts whole and moves in
        const previous = imageOf(before);
        const same = previous && before !== figure && previous.getAttribute('src') === image.getAttribute('src');
        image.style.transition = 'none';
        image.style.transform = same ? previous.style.transform : 'none';
        void image.offsetWidth;
        image.style.transition = '';
        image.style.transform = zoomTransform(zoomOf(figure));
      }
      function live(on) {
        section.classList.toggle('az-live', on);
        at = null;
        parts.forEach((part, index) => counts[index] && (on ? part.prepend(counts[index]) : counts[index].remove()));
        if (!on) {
          for (const node of [...figures, ...parts]) {
            node.classList.remove('az-on');
            node.removeAttribute('aria-hidden');
            node.removeAttribute('inert');
          }
          for (const figure of figures) if (imageOf(figure)) imageOf(figure).style.transform = '';
          return;
        }
        show(parts[0]);
        follow();
      }
      // the step being read is the last whose top has passed the line, measured as the page
      // scrolls: an observer's margins are not kept inside the Page pane's frame. A map or a
      // picture holding the screen keeps its step, whatever the window does meanwhile
      function follow() {
        if (!section.classList.contains('az-live') || doc.fullscreenElement || root.classList.contains('az-locked')) return;
        const box = section.getBoundingClientRect();
        if (!box.height || box.bottom < 0 || box.top > window.innerHeight) return;
        const line = window.innerHeight * 0.6;
        let found = parts[0];
        for (const part of parts) if (part.getBoundingClientRect().top <= line) found = part;
        show(found);
      }
      // live with motion, and with room unless the whole page is a story; anything else reads picture then words
      const can = () => !reduced.matches && (story || wide.matches);
      const settle = () => { if (can() !== section.classList.contains('az-live')) live(can()); };
      wide.addEventListener?.('change', settle);
      reduced.addEventListener?.('change', settle);
      watchers.push(follow);
      live(can());
    }
  }

  /* az:map */

  /* the story layout opens on its first picture when the cover has none of its own: the first that
     came from somewhere (it has a credit) rather than a chart, else the first; its credit kept on it */
  function hero() {
    const cover = doc.querySelector('.az-cover:not([data-cover="own"])');
    if (!story || !cover || cover.querySelector('.az-cover-figure')) return;
    const figures = all('.az-body .az-figure:is([data-kind="picture"], [data-kind="proof"]):not(.az-graphic)');
    const figure = figures.find((one) => one.querySelector('.az-credit')) || figures[0];
    const image = figure?.querySelector('.az-zoom > img');
    if (!image) return;
    const held = make('figure', { class: 'az-figure az-cover-figure', 'data-kind': 'picture', 'data-borrowed': 'true' });
    held.append(make('img', { src: image.getAttribute('src'), alt: '' }));
    const credit = figure.querySelector('.az-credit');
    if (credit) {
      const caption = make('figcaption');
      caption.append(credit.cloneNode(true));
      for (const node of all('[id]', caption)) node.removeAttribute('id');
      held.append(caption);
    }
    cover.append(held);
  }

  /** The hyphenated words of `node` matching `word` kept whole on their line. */
  function keepWhole(node, word) {
    const texts = [];
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) texts.push(text);
    for (const text of texts) {
      const parts = text.data.split(word);
      if (parts.length > 1) text.replaceWith(...parts.map((part, index) => (index % 2 ? make('span', { class: 'az-keep' }, part) : part)));
    }
  }

  /* a title never breaks right after a hyphen: "al-Mandab" stays whole on its line, and so does "M-ATV" or "0:23-0:37" in a table */
  function titles() {
    for (const heading of all('.az-title, .az-body h2, .az-body h3, .az-contents a')) keepWhole(heading, /(\S{1,24}-\S{1,24})/);
    for (const cell of all('.az-table td')) keepWhole(cell, /(\S{1,14}-\S{1,14})/);
    // an address written out breaks anywhere, rather than leave a justified line stretched before it
    for (const link of all('.az-body :is(p, li) a')) if (/^\S{28,}$/.test(words(link))) link.classList.add('az-long');
  }

  /* printed, every "How this was checked" is open */
  function printing() {
    let opened = [];
    window.addEventListener('beforeprint', () => {
      opened = all('details:not([open])');
      for (const details of opened) details.open = true;
      for (const clip of all('video')) clip.pause?.();
    });
    window.addEventListener('afterprint', () => {
      for (const details of opened) details.open = false;
      opened = [];
    });
  }

  function start() {
    for (const part of [titles, hero, progress, contents, pictures, pairs, timecodes, tables, citations, steps, ...(typeof maps === 'function' ? [maps] : []), stories, printing, addresses]) part();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

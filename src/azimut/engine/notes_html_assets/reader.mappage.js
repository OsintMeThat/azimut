  /* a map page (`data-web="map"`, a web map): spliced after the map's part only in such a page
     (engine/notes_html.py). Its first map takes the window under its title, and a panel beside it
     (behind a button on a phone) holds a search through the map's features, its layers to switch
     off and on, its steps and the note's other words; where the map looks is kept in the address
     (`#zoom/lat/lon`), so a view can be shared. Without script the page reads top to bottom */
  function mapPage() {
    if (root.dataset.web !== 'map') return;
    const page = doc.querySelector('.az-mappage');
    const figure = page?.querySelector('.az-mappage-main figure.az-map');
    const map = figure?.azMap;
    if (!map) return;
    let data = null;
    try { data = JSON.parse(figure.querySelector('script.az-map-data')?.textContent || 'null'); } catch { data = null; }
    const features = data?.features || [];
    const days = data?.days || [];
    const shownOn = (feature, day) => !day || ((!feature.from || feature.from <= day) && (!feature.until || day <= feature.until));
    page.classList.add('az-paged-page');
    map.page();
    /* the analyst's logo and handle, in the map's own corner */
    const mark = page.querySelector('.az-mappage-mark');
    if (mark) figure.querySelector('.az-map-frame')?.append(mark);

    const panel = make('aside', { class: 'az-mappage-panel', id: 'az-mappage-panel', 'aria-label': 'Layers and search' });
    const shut = make('button', { type: 'button', class: 'az-mappage-shut', 'aria-label': 'Close the panel', title: 'Close' }, '×');
    const section = (name, ...parts) => {
      const box = make('section', { class: 'az-mappage-part' });
      box.append(make('h2', { class: 'az-mappage-label' }, name), ...parts);
      return box;
    };
    panel.append(shut);

    /* the search: every word of a feature, its name, its group and layer, its day and each of its columns */
    const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const sought = new Map(features.map((feature) => {
      const card = feature.card || {};
      const parts = [feature.label, card.title, card.kicker, card.text, card.facts, card.day, feature.group, feature.layer,
        ...(card.rows || []).flatMap((row) => [row.label, row.value])];
      return [feature.id, fold(parts.filter(Boolean).join('\n'))];
    }));
    const field = make('input', { type: 'search', class: 'az-mappage-field', placeholder: 'Name, group, any word…',
      'aria-label': 'Find a feature on the map', autocomplete: 'off', spellcheck: 'false' });
    const found = make('p', { class: 'az-mappage-found', 'aria-live': 'polite' });
    const results = make('ul', { class: 'az-mappage-results' });
    panel.append(section('Find on the map', field, found, results));
    /** One result a feature, a feature followed over time once: as on the day shown, else its last state. */
    function search() {
      const words = fold(field.value).split(/\s+/).filter(Boolean);
      results.replaceChildren();
      found.textContent = '';
      if (!words.length) return;
      const day = map.where().day;
      const kept = new Map();
      for (const feature of features) {
        if (!words.every((word) => sought.get(feature.id)?.includes(word))) continue;
        const of = feature.of || feature.id;
        const held = kept.get(of);
        if (!held || (!shownOn(held, day) && (shownOn(feature, day) || String(feature.from || '') > String(held.from || '')))) kept.set(of, feature);
      }
      const hits = [...kept.values()];
      found.textContent = hits.length ? `${hits.length} found` : 'Nothing on the map matches';
      for (const feature of hits.slice(0, 50)) {
        const card = feature.card || {};
        const button = make('button', { type: 'button', class: 'az-mappage-hit' });
        const dot = make('i', { 'aria-hidden': 'true' });
        dot.style.background = feature.style?.color || 'var(--az-accent)';
        button.append(dot, make('span', { class: 'az-mappage-hit-name', dir: 'auto' }, card.title || feature.label || 'Feature'),
          make('span', { class: 'az-mappage-hit-said', dir: 'auto' }, [card.kicker || feature.layer, card.day].filter(Boolean).join(' · ')));
        button.addEventListener('click', () => reach(feature));
        const item = make('li');
        item.append(button);
        results.append(item);
      }
    }
    field.addEventListener('input', search);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
    });

    /* the layers: the legend, each of its rows a switch for what it stands for, a layer's name for all of its rows */
    const legend = figure.querySelector('.az-map-legend');
    figure.querySelector('details.az-map-key')?.setAttribute('open', '');
    const rows = legend ? all('li[data-key]', legend) : [];
    const stands = (row, feature) => row.dataset.layer === (feature.layer || '') && row.dataset.key === (feature.group || '')
      && row.dataset.kind === feature.kind;
    function apply() {
      const off = rows.filter((row) => row.classList.contains('az-key-off'));
      map.hide(features.filter((feature) => off.some((row) => stands(row, feature))).map((feature) => feature.id));
    }
    function shown(row, on) {
      row.classList.toggle('az-key-off', !on);
      row.querySelector('.az-key-switch')?.setAttribute('aria-pressed', String(on));
    }
    for (const row of rows) {
      const name = row.querySelector('.az-key-name')?.textContent || 'these';
      const button = make('button', { type: 'button', class: 'az-key-switch', 'aria-pressed': 'true', title: `Show or hide ${name} on the map` });
      button.append(...row.childNodes);
      row.append(button);
      button.addEventListener('click', () => { shown(row, row.classList.contains('az-key-off')); apply(); });
    }
    for (const head of legend ? all('.az-key-layer', legend) : []) {
      const mine = rows.filter((row) => row.dataset.layer === head.textContent);
      if (!mine.length) continue;
      const button = make('button', { type: 'button', class: 'az-key-switch az-key-all', title: `Show or hide all of ${head.textContent}` });
      button.append(...head.childNodes);
      head.append(button);
      button.addEventListener('click', () => {
        const on = mine.every((row) => row.classList.contains('az-key-off'));
        for (const row of mine) shown(row, on);
        apply();
      });
    }
    if (legend) panel.append(section('Layers', legend.closest('details.az-map-key') || legend));
    const steps = figure.querySelector('.az-map-steps-row');
    if (steps) panel.append(section('Where the map looks', steps));
    const about = page.querySelector('.az-mappage-about');
    if (about) panel.append(about);
    page.append(panel);

    /** Go to a feature found: its switch back on, a day it is on, the map moved to it, its card open. */
    function reach(feature) {
      const row = rows.find((one) => stands(one, feature) && one.classList.contains('az-key-off'));
      if (row) { shown(row, true); apply(); }
      const at = map.where();
      if (days.length && !shownOn(feature, at.day)) map.day(days.filter((day) => shownOn(feature, day)).pop() || feature.from || at.day);
      const coords = feature.kind === 'point' ? feature.coords
        : feature.at || (feature.kind === 'line' ? feature.coords?.[0]?.[Math.floor((feature.coords[0].length - 1) / 2)] : feature.coords?.[0]?.[0]?.[0]);
      if (coords) map.fly({ center: coords, zoom: Math.max(at.zoom, 14) });
      map.open(feature.id);
      sheet(false);
    }

    /* on a phone the panel is a sheet over the map, behind a button in the header */
    const menu = make('button', { type: 'button', class: 'az-mappage-menu', 'aria-controls': panel.id, 'aria-expanded': 'false' }, 'Layers');
    page.querySelector('.az-mappage-head')?.append(menu);
    function sheet(on) {
      page.classList.toggle('az-mappage-open', on);
      menu.setAttribute('aria-expanded', String(on));
      if (on) field.focus({ preventScroll: true });
    }
    menu.addEventListener('click', () => sheet(!page.classList.contains('az-mappage-open')));
    shut.addEventListener('click', () => { sheet(false); menu.focus({ preventScroll: true }); });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && page.classList.contains('az-mappage-open')) { event.stopPropagation(); sheet(false); menu.focus({ preventScroll: true }); }
    });

    /* where the map looks, in the address: read on the way in, written as it moves, never a step of the history. Its
       zoom is a tile's, as OpenStreetMap's and the app's own addresses write it: one more than the map engine's */
    const asked = /^#(\d{1,2}(?:\.\d+)?)\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)$/.exec(location.hash);
    if (asked) {
      const [zoom, lat, lon] = asked.slice(1).map(Number);
      if (zoom >= 1 && zoom <= 23 && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) map.look({ center: [lon, lat], zoom: zoom - 1 });
    }
    const first = map.where();
    let writing = 0;
    figure.addEventListener('az-moved', () => {
      clearTimeout(writing);
      writing = setTimeout(() => {
        const at = map.where();
        const still = Math.abs(at.zoom - first.zoom) < 0.01 && Math.abs(at.center[0] - first.center[0]) < 1e-5
          && Math.abs(at.center[1] - first.center[1]) < 1e-5;
        if (!ownAddress() || (still && !location.hash)) return;
        const hash = `#${(at.zoom + 1).toFixed(2)}/${at.center[1].toFixed(5)}/${at.center[0].toFixed(5)}`;
        if (location.hash === hash) return;
        try { history.replaceState(null, '', hash); } catch { /* a page that may not change its address keeps it */ }
      }, 400);
    });
  }

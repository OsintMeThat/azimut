import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import SavedPopup from './SavedPopup.svelte';

const overlay = readFileSync(new URL('./SavedOverlay.svelte', import.meta.url), 'utf8');

const capture = {
  id: 'c1',
  kind: 'capture',
  title: 'bridge, north bank',
  lat: 48.0159,
  lon: 37.8029,
  zoom: 18,
  provider: 'Esri World Imagery',
  path: 'media/a.png',
  thumbnail: 'media/.thumbs/a.jpg',
  imagery_date: '2024-03',
  fetched_at: '2026-07-20T09:12:04Z',
  notes: 'two vehicles at the gate',
};
const older = { ...capture, id: 'c2', title: 'bridge, earlier pass', imagery_date: '2021-06' };
const place = {
  id: 'p1',
  kind: 'place',
  title: 'checkpoint north',
  lat: 48.0159,
  lon: 37.8029,
  zoom: 18,
  path: null,
  thumbnail: null,
  imagery_date: null,
  fetched_at: '2026-07-18T09:12:04Z',
  notes: '',
};

const noop = () => {};
const at = (items, props = {}) =>
  render(SavedPopup, {
    props: {
      items,
      caseId: 'case-1',
      coords: (row) => `${row.lat}, ${row.lon}`,
      onopen: noop,
      onedit: noop,
      ...props,
    },
  }).body;

describe('SavedPopup', () => {
  it('says what one saved item is, with its preview and both dates', () => {
    const body = at([capture]);

    expect(body).toContain('bridge, north bank');
    expect(body).toContain('/files/case-1/media/.thumbs/a.jpg');
    expect(body).toContain('Capture');
    expect(body).toContain('Esri World Imagery');
    expect(body).toContain('z18');
    expect(body).toContain('Imagery 2024-03');
    expect(body).toContain('Saved 2026-07-20');
    expect(body).toContain('two vehicles at the gate');
  });

  it('lists a stack as a timeline of the ground, newest imagery first', () => {
    const body = at([older, place, capture]);

    expect(body).toContain('3 saved here');
    expect(body.indexOf('bridge, north bank')).toBeLessThan(body.indexOf('bridge, earlier pass'));
    // the undated place falls to the end — it dates nothing on the ground
    expect(body.indexOf('bridge, earlier pass')).toBeLessThan(body.indexOf('checkpoint north'));
  });

  it('does not tally a single item as a stack', () => {
    expect(at([capture])).not.toContain('saved here');
  });

  it('falls back to the kind glyph when there is no preview to show', () => {
    expect(at([place])).not.toContain('/files/case-1/');
    expect(at([place])).toContain('Place');
  });

  it('offers the source page only for an item that recorded one', () => {
    expect(at([capture])).not.toContain('Source');
    expect(at([{ ...capture, source_url: 'https://yandex.com/maps/' }])).toContain(
      'https://yandex.com/maps/'
    );
  });

  it('says a capture is already worked', () => {
    // a proof stands on this very point, so it is named here rather than drawn
    // as a second mark on top of the capture
    const body = at([{ ...capture, proofs: 2 }]);

    expect(body).toContain('2 proofs here');
    // the same dot the mark wears, so the card explains the mark
    expect(body).toContain('worked-dot');

    expect(at([capture])).not.toContain('proofs here');
  });

  it('holds back the links that would leave a fullscreen map', () => {
    const body = at([capture], { fullscreen: true });

    expect(body).toContain('Exit fullscreen first');
    expect(body).not.toContain('href="/files/case-1/media/a.png"');
  });
});

describe('SavedPopup, a saved comparison', () => {
  const comparison = {
    id: 's1',
    kind: 'comparison',
    title: 'Harbour reading',
    lat: 48.0159,
    lon: 37.8029,
    session: 'Harbour reading',
    path: 'media/Harbour reading.png',
    thumbnail: 'media/.thumbs/h.jpg',
    imagery_a: '2024-05-03~',
    imagery_b: '2026-09-02',
    footprint: { type: 'Polygon', coordinates: [[[37.8, 48], [37.81, 48], [37.81, 48.01], [37.8, 48]]] },
    fetched_at: '2026-09-20T09:00:00Z',
    kept: [{ path: 'media/Harbour reading 2024-05-03_2026-09-02.png', title: 'Harbour reading 2024-05-03_2026-09-02' }],
  };

  it('says it is a comparison, with both pictures and the images kept from it', () => {
    const body = at([comparison]);

    expect(body).toContain('Comparison');
    expect(body).toContain('2024-05-03~ → 2026-09-02');
    expect(body).toContain('framed');
    expect(body).toContain('1 image kept');
    expect(body).toContain('/files/case-1/media/Harbour%20reading%202024-05-03_2026-09-02.png');
    expect(body).toContain('Open in Compare');
    expect(body).not.toContain('traced area');
  });

  it('draws a stack of captures and comparisons with the capture glyph, not a pin', () => {
    expect(overlay).toContain('const kind = markKind(mark.kinds);');
  });

  it('outlines its frame in dashes, never as a guess about a place', () => {
    expect(overlay).toContain("row.kind === 'comparison'");
    expect(overlay).toContain("dash: '5 4'");
  });
});

describe('SavedOverlay popup wiring', () => {
  it('mounts the card as a component rather than building HTML by hand', () => {
    expect(overlay).toContain("import { mount, unmount } from 'svelte'");
    expect(overlay).toContain('mount(SavedPopup');
    expect(overlay).toContain('unmount(mounted)');
    expect(overlay).toContain('onedit: close(onedit)');
  });

  it('opens a card for every mark of saved work, one item or a stack', () => {
    expect(overlay).toContain('content: () => popupContent(mark)');
    // no shortcut path that flies straight there on a single-item mark. A mark of
    // located files is the one that answers its own click, by playing them in the
    // panel — there is no card for a photo to open.
    expect(overlay).toContain('isMedia(mark)\n            ? { onClick: () => onmedia?.(mark.items) }');
    expect((overlay.match(/onClick/g) ?? []).length).toBe(1);
  });

  it('asks for the width its own rows need, and leaves the look to the map', () => {
    // the card's chrome is one of the app's surfaces, dressed once in
    // lib/map/engine.css; what belongs here is how wide these rows have to be
    expect(overlay).toContain("className: 'saved-popup'");
    expect(overlay).toContain('minWidth: 296');
    expect(overlay).toContain('maxWidth: 330');
    // and never the engine's own DOM, which is not this component's to name
    expect(overlay.toLowerCase()).not.toContain('popup-content');
  });

  it('marks a worked capture instead of letting a proof stack a mark on it', () => {
    // the dot is drawn from the count the saved index carries, and the proof
    // itself is never a second mark at the same point
    expect(overlay).toContain('saved-mark-worked');
    expect(overlay).toContain('proofs > 0');
  });

  it('keys marks on the row key, so one proof at two places lights both', () => {
    expect(overlay).toContain('row.key ?? row.id');
  });
});

describe('SavedPopup relations', () => {
  const related = { ...place, relations: 2 };

  it('offers a stack of points its relations without fetching any of them', () => {
    // the saved index carries a count; five marks must not mean five requests
    const body = at([related, capture]);
    expect(body).toContain('2 relations');
    expect(body).not.toContain('Relations · 2');
  });

  it('says nothing at all about a point that has none', () => {
    expect(at([place])).not.toContain('relation');
  });

  it('marks a point enrichment proposed, so it cannot pass for analyst work', () => {
    expect(at([{ ...place, status: 'suggested' }])).toContain('suggested');
    expect(at([place])).not.toContain('suggested');
  });

  it('loads the edges from the bounded chain endpoint, not from the index', () => {
    const source = readFileSync(new URL('./SavedPopup.svelte', import.meta.url), 'utf8');
    expect(source).toContain('api.get(`/api/cases/${caseId}/entities/${row.id}/chain`)');
    expect(source).toContain("relationAction(relation.link.type) === 'relation'");
    expect(source).toContain('relationsByRow = { ...relationsByRow, [rowKey(row)]: ordinary }');
    // a single mark opens them straight away: clicking a place to see which
    // photos claim it is the whole point of the gesture
    expect(source).toContain('const only = ordered.length === 1 ? ordered[0] : null;');
    // the auto-open effect writes the state it reads, so it guards on "already
    // open" rather than fetching the row twice
    expect(source).toContain('if (!only || !relationCount(only) || relationsShown(only)) return;');
    // the toggle keeps its click inside the card, or the map closes it
    expect(source).toContain('event?.stopPropagation();');
  });

  it('syncs the other surfaces without the layer taking the card down', () => {
    // confirming a proposed relation confirms its point, which the Suggestions
    // list shows too — so the host reloads. The overlay defers rebuilding the
    // marker layer while a card is open, and the count reads the loaded list
    // meanwhile rather than the index it just invalidated.
    const source = readFileSync(new URL('./SavedPopup.svelte', import.meta.url), 'utf8');
    expect(source).toContain('await onrefresh?.()');
    expect(source).toContain('relationsByRow[rowKey(row)]?.length ?? Number(row.relations ?? 0)');
    expect(overlay).toContain('if (held && builtFor === cid) return;');
    expect(overlay).toContain('onPopupOpen: () => (popupOpen = true)');
    // the layer's teardown is not the data effect's cleanup, which Svelte runs
    // before every re-run — including one that decides to defer
    expect(overlay).toContain('function rebuild(rows, precision)');
  });

  it('never caches a failed read as "this point has no relations"', () => {
    const source = readFileSync(new URL('./SavedPopup.svelte', import.meta.url), 'utf8');
    expect(source).toContain('openRows = openRows.filter((key) => key !== rowKey(row));');
    expect(source).toContain('Could not read the relations');
  });

  it('leaves for a related entity’s own tool by closing the card first', () => {
    // every other row in this card closes it before navigating; a popup that
    // vanishes without saying it would reads as a bug
    // one closing gesture, applied to every row of the card
    expect(overlay).toContain('const close = (then) => (arg) => {');
    expect(overlay).toContain('surface.closePopup();');
    expect(overlay).toContain('onentity: close(openEntity)');
  });
});

describe('how precisely a point is pinned', () => {
  const popup = readFileSync(new URL('./SavedPopup.svelte', import.meta.url), 'utf8');

  it('reads the spread out in the meta line, in the unit that suits it', () => {
    expect(popup).toContain("`±${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`");
    expect(popup).toContain("`±${Math.round(m)} m`");
    expect(popup).toContain("if (row.footprint) return 'traced area';");
  });

  it('says nothing when nothing was stated', () => {
    expect(popup).toContain('if (!(m > 0)) return null;');
    expect(popup).toContain('{#if spread(row)}');
  });

  it('is read-only here, because the drawer owns the field', () => {
    const card = popup.slice(popup.indexOf('{#if spread(row)}'));
    expect(card.slice(0, 200)).not.toMatch(/<input|<button/);
  });
});

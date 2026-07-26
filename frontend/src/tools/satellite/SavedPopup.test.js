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

  it('opens a proof in its composer and previews its linked posts', () => {
    const proof = {
      id: 'pr1',
      key: 'pr1@48.0159,37.8029',
      kind: 'proof',
      name: 'kyiv-bridge',
      title: 'Kyiv bridge',
      lat: 48.0159,
      lon: 37.8029,
      path: 'proofs/kyiv-bridge.png',
      thumbnail: 'media/.thumbs/pr.jpg',
      fetched_at: '2026-07-21T09:12:04Z',
      posts: 3,
      linked_posts: [
        { id: 'post-1', name: 'panorama-publication', title: 'Panorama publication', target: 'x' },
        { id: 'post-2', name: 'source-follow-up', title: 'Follow-up with sources', target: 'bluesky' },
        { id: 'post-3', name: 'later-note', title: 'Later note', target: 'mastodon' },
      ],
    };

    const body = at([proof]);
    expect(body).toContain('Kyiv bridge');
    expect(body).toContain('Proof');
    expect(body).toContain('Open in Geo Proof');
    expect(body).toContain('Linked posts · 3');
    expect(body).toContain('Panorama publication');
    expect(body).toContain('Follow-up with sources');
    expect(body).not.toContain('Later note');
    expect(body).toContain('+ 1 more');

    // a post is two hops from a point: it is a chip here, never its own mark
    expect(at([{ ...proof, posts: 0, linked_posts: [] }])).not.toContain('Linked post');
  });

  it('names one linked post directly', () => {
    const body = at([{
      ...capture,
      kind: 'proof',
      linked_posts: [
        { id: 'post-1', name: 'panorama-publication', title: 'Panorama publication', target: 'x' },
      ],
    }]);

    expect(body).toContain('Linked post');
    expect(body).not.toContain('Linked posts ·');
    expect(body).toContain('Panorama publication');
  });

  it('says a capture is already worked, and offers the proofs view from there', () => {
    const body = at([{ ...capture, proofs: 2 }]);

    expect(body).toContain('2 proofs here');
    expect(body).toContain('Show proofs');
    // the same dot the mark wears, so the card explains the mark
    expect(body).toContain('worked-dot');

    expect(at([capture])).not.toContain('Show proofs');
  });

  it('holds back the links that would leave a fullscreen map', () => {
    const body = at([capture], { fullscreen: true });

    expect(body).toContain('Exit fullscreen first');
    expect(body).not.toContain('href="/files/case-1/media/a.png"');
  });
});

describe('SavedOverlay popup wiring', () => {
  it('mounts the card as a component rather than building HTML by hand', () => {
    expect(overlay).toContain("import { mount, unmount } from 'svelte'");
    expect(overlay).toContain('mount(SavedPopup');
    expect(overlay).toContain('unmount(mounted)');
    expect(overlay).toContain('onpost?.(post)');
  });

  it('opens a card for every mark, one item or a stack', () => {
    expect(overlay).toContain('marker.bindPopup(() => popupContent(mark)');
    // no shortcut path that flies straight there on a single-item mark
    expect(overlay).not.toContain("marker.on('click'");
  });

  it('dresses the Leaflet popup as one of the app\'s own surfaces', () => {
    expect(overlay).toContain('.saved-popup .leaflet-popup-content-wrapper');
    expect(overlay).toContain('background: var(--bg-1)');
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

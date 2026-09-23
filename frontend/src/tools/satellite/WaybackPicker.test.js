import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import WaybackPicker from './WaybackPicker.svelte';

const RELEASES = [
  { release: 26334, date: '2026-08-05' },
  { release: 64776, date: '2023-08-31' },
  { release: 10, date: '2014-02-20' },
];

/** A stand-in for `state/wayback.svelte.js`, in the state a case would be in. */
function props(wb = {}) {
  return {
    wb: {
      menuOpen: true,
      releases: RELEASES,
      listNote: '',
      release: 64776,
      date: '2023-08-31',
      changesOnly: true,
      changes: [64776, 10],
      changesBusy: false,
      busy: false,
      changesNote: '',
      stale: false,
      reading: false,
      visible: [RELEASES[1], RELEASES[2]],
      position: 0,
      toggleMenu: vi.fn(),
      setChangesOnly: vi.fn(),
      loadChanges: vi.fn(),
      pick: vi.fn(),
      step: vi.fn(),
      picture: (release) =>
        ({ 64776: { acquired: '2022-03-31', source: 'Maxar WV03' } })[release] ?? null,
      ...wb,
    },
  };
}

describe('the Wayback chip', () => {
  it('names the release on screen, and the newest before the list is read', () => {
    expect(render(WaybackPicker, { props: props({ menuOpen: false }) }).body).toContain('2023-08-31');
    const early = render(WaybackPicker, {
      props: props({ menuOpen: false, releases: [], date: '' }),
    });
    expect(early.body).toContain('Newest');
  });

  it('says it is waiting while Esri is being read, picker open or shut', () => {
    // the walk takes seconds and the menu can be shut while it runs, so the
    // chip is where the wait has to show
    const { body } = render(WaybackPicker, {
      props: props({ menuOpen: false, releases: [], date: '', busy: true }),
    });
    expect(body).toContain('Reading…');
    expect(body).toMatch(/class="spinner\b/);
    expect(body).toContain('aria-busy="true"');
    expect(body).not.toContain('Newest');
  });

  it('keeps the release it already names while the next answer is read', () => {
    const { body } = render(WaybackPicker, { props: props({ menuOpen: false, busy: true }) });
    expect(body).toContain('2023-08-31');
    expect(body).toMatch(/class="spinner\b/);
  });
});

describe('the picker', () => {
  it('lists what it offers and marks the release on screen', () => {
    const { body } = render(WaybackPicker, { props: props() });
    expect(body).toMatch(/class="row mono[^"]* on"[^>]*><span>2023-08-31</);
    expect(body).toContain('2014-02-20');
    // narrowed to changes, so a release that changed nothing here is not offered
    expect(body).not.toContain('>2026-08-05<');
    expect(body).toContain('2 changes at the crosshair');
  });

  it('cannot step newer from the newest it offers', () => {
    const { body } = render(WaybackPicker, { props: props() });
    expect(body).toMatch(/<button[^>]*disabled[^>]*aria-label="Newer release"/);
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*aria-label="Older release"/);
  });

  it('offers nothing while this point’s first history is coming', () => {
    // every release is not what "Changes here" was asked for, and a list about
    // to shrink to a quarter of itself is one the analyst reads and acts on
    const { body } = render(
      WaybackPicker,
      { props: props({ reading: true, changesBusy: true, changes: null, visible: RELEASES }) }
    );
    expect(body).toContain("Reading this point's history");
    expect(body).not.toContain('type="range"');
    expect(body).not.toContain('2014-02-20');
    // …and the way out of the wait stays on offer
    expect(body).toContain('Every release');
  });

  it('says a history is being read, has failed, or belongs to somewhere else', () => {
    expect(render(WaybackPicker, { props: props({ changesBusy: true }) }).body).toContain(
      "Reading this point's history"
    );
    expect(
      render(WaybackPicker, { props: props({ changesNote: 'Could not read it' }) }).body
    ).toContain('Could not read it');
    const stale = render(WaybackPicker, { props: props({ stale: true }) }).body;
    expect(stale).toContain('The map moved off this history.');
    // …and reading the new place is the analyst's call, not the map's
    expect(stale).toContain('>Read here</button>');
  });

  it('offers every release first, and the history as a choice after it', () => {
    const { body } = render(WaybackPicker, {
      props: props({ changesOnly: false, changes: null, visible: RELEASES, position: 1 }),
    });
    expect(body.indexOf('Every release')).toBeLessThan(body.indexOf('Changes here'));
    expect(body).toMatch(/class="chip-opt[^"]* on"[^>]*>Every release</);
    expect(body).toContain('>2026-08-05<');
    expect(body).not.toMatch(/changes? at the crosshair/);
  });

  it('keeps release dates apart from when the pixels were taken', () => {
    const { body } = render(WaybackPicker, { props: props() });
    expect(body).toContain('taken 2022-03-31');
    expect(body).toContain('Taken by Maxar WV03');
    expect(body).toContain('the pill under the chip dates the pixels on screen');
  });

  it('says so when the release list cannot be read', () => {
    const { body } = render(WaybackPicker, {
      props: props({ releases: [], listNote: 'Could not read the release list: offline' }),
    });
    expect(body).toContain('Could not read the release list: offline');
    expect(body).not.toContain('type="range"');
  });
});

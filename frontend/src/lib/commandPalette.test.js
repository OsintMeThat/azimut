import { describe, expect, it } from 'vitest';
import { isPaletteKey, matchRuns, paletteActions, paletteScenes, paletteSettings, paletteTools } from './commandPalette.js';

describe('the palette shortcut', () => {
  it('opens with Control or Command, including from a text field', () => {
    expect(isPaletteKey({ key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } })).toBe(true);
    expect(isPaletteKey({ key: 'k', metaKey: true })).toBe(true);
  });

  it('leaves composition, held keys and other shortcuts alone', () => {
    for (const extra of [{ isComposing: true }, { repeat: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
      expect(isPaletteKey({ key: 'k', ctrlKey: true, ...extra })).toBe(false);
    }
    expect(isPaletteKey({ key: 'k' })).toBe(false);
    expect(isPaletteKey({ key: 'n', ctrlKey: true })).toBe(false);
  });
});

describe('matched runs', () => {
  const marked = (runs) => runs.filter((run) => run.hit).map((run) => run.text);

  it('marks every term where the label holds it, whatever the case', () => {
    expect(matchRuns('Port Sudan quay', 'port QUAY')).toEqual([
      { text: 'Port', hit: true }, { text: ' Sudan ', hit: false }, { text: 'quay', hit: true },
    ]);
    expect(marked(matchRuns('Geo Proof', 'o'))).toEqual(['o', 'oo']);
  });

  it('points a folded match back at the accented letters', () => {
    expect(marked(matchRuns('Étude de Straße', 'etude strasse'))).toEqual(['Étude', 'Straße']);
  });

  it('leaves the label whole without a query or a match', () => {
    expect(matchRuns('Harbour', '  ')).toEqual([{ text: 'Harbour', hit: false }]);
    expect(matchRuns('Harbour', 'airfield')).toEqual([{ text: 'Harbour', hit: false }]);
    expect(matchRuns('', 'a')).toEqual([{ text: '', hit: false }]);
  });
});

describe('tool search', () => {
  const tools = [
    { id: 'satellite', label: 'Satellite' },
    { id: 'compare', label: 'Compare' },
    { id: 'proof', label: 'Geo Proof' },
    { id: 'settings', label: 'Settings' },
  ];

  it('finds a renamed tool by the name it had', () => {
    expect(paletteTools([...tools, { id: 'post', label: 'Post' }], 'geo report').map((row) => row.id)).toEqual(['post']);
  });

  it('finds a workspace as well as an individual tool, with folded text', () => {
    expect(paletteTools(tools, 'MÁP').map((row) => row.id)).toEqual(['satellite', 'compare']);
    expect(paletteTools(tools, 'compose proof').map((row) => row.id)).toEqual(['proof']);
    expect(paletteTools(tools, 'satellite').map((row) => row.label)).toEqual(['Satellite']);
  });

  it('includes Settings and ranks a named tool before workspace matches', () => {
    expect(paletteTools(tools, '').map((row) => row.id)).toEqual(tools.map((tool) => tool.id));
    expect(paletteTools(tools, 'settings')[0]).toMatchObject({ label: 'Settings', icon: 'settings' });
    expect(paletteTools([{ id: 'proof', label: 'Geo Proof' }, { id: 'notebook', label: 'Compose notes' }], 'compose')[0].id).toBe('notebook');
  });
});

describe('Horizon settings search', () => {
  it('finds a setting by its name or the words it goes by, only once something is typed', () => {
    expect(paletteSettings('')).toEqual([]);
    expect(paletteSettings('buildings')).toEqual([{ kind: 'setting', id: 'buildings', label: 'Buildings', detail: 'What the view shows', icon: 'horizon' }]);
    expect(paletteSettings('haze').map((row) => row.id)).toEqual(['visibility']);
    expect(paletteSettings('FOCAL').map((row) => row.label)).toEqual(['Field of view']);
    expect(paletteSettings('nothing like this')).toEqual([]);
  });
});

describe('what the palette does', () => {
  it('offers the note on the side while a case is open, by the words it goes by', () => {
    expect(paletteActions('', { caseOpen: true })).toEqual([
      { kind: 'action', id: 'note-side', label: 'Note on the side', detail: 'Notebook', icon: 'panelRight' },
    ]);
    expect(paletteActions('pin', { caseOpen: true }).map((row) => row.id)).toEqual(['note-side']);
    expect(paletteActions('SIDE note', { caseOpen: true }).map((row) => row.id)).toEqual(['note-side']);
    expect(paletteActions('satellite', { caseOpen: true })).toEqual([]);
  });

  it('offers nothing a case is needed for when none is open', () => {
    expect(paletteActions('note')).toEqual([]);
    expect(paletteActions('geolocate', { toGeolocate: 2 })).toEqual([]);
  });

  it('offers To geolocate unasked only while scenes wait, and to anyone who types it', () => {
    const ids = (query, toGeolocate) => paletteActions(query, { caseOpen: true, toGeolocate }).map((row) => row.id);
    expect(ids('', null)).toEqual(['note-side']);
    expect(ids('', 0)).toEqual(['note-side']);
    expect(ids('', 2)).toEqual(['note-side', 'to-geolocate']);
    expect(ids('geoloc', 0)).toEqual(['to-geolocate']);
    expect(ids('to-do', 0)).toEqual(['to-geolocate']);
  });

  it('counts the scenes waiting beside To geolocate', () => {
    const row = (toGeolocate) => paletteActions('geolocate', { caseOpen: true, toGeolocate })[0];
    expect(row(2)).toEqual({ kind: 'action', id: 'to-geolocate', label: 'To geolocate', detail: '2 scenes · To-do', icon: 'crosshair' });
    expect(row(1).detail).toBe('1 scene · To-do');
    expect(row(0).detail).toBe('To-do');
    expect(row(null).detail).toBe('To-do');
  });
});

describe('the scenes Go to finds', () => {
  const scene = (video, id, label, extra = {}) => ({ video, id, start: 4, end: null, label, state: 'todo', ...extra });
  const FILES = [
    { video: 'media/market.mp4', title: 'Market walk', kind: 'video', scenes: [scene('media/market.mp4', 'a', 'bridge?'), scene('media/market.mp4', 'b', 'Minaret')] },
    {
      video: 'media/harbour.png', title: 'Harbour photo', kind: 'image',
      scenes: [scene('media/harbour.png', 'c', '', { start: null, file_kind: 'image' }), scene('media/harbour.png', 'd', 'Left', { state: 'abandoned' })],
    },
  ];

  it('lists nothing until something is typed, nor without a queue', () => {
    expect(paletteScenes(FILES, '')).toEqual([]);
    expect(paletteScenes(null, 'bridge')).toEqual([]);
  });

  it('finds a scene by its label or its file, and never an abandoned one', () => {
    expect(paletteScenes(FILES, 'bridge')).toEqual([{
      kind: 'scene', id: 'media/market.mp4#a', label: 'bridge?', detail: 'Market walk', icon: 'video', video: 'media/market.mp4', draft: 'a',
    }]);
    expect(paletteScenes(FILES, 'market').map((row) => row.draft)).toEqual(['a', 'b']);
    expect(paletteScenes(FILES, 'harbour')).toEqual([{
      kind: 'scene', id: 'media/harbour.png#c', label: 'Whole picture', detail: 'Harbour photo', icon: 'image', video: 'media/harbour.png', draft: 'c',
    }]);
    expect(paletteScenes(FILES, 'left')).toEqual([]);
  });

  it('keeps to a few rows', () => {
    const many = [{ video: 'v', title: 'Long clip', kind: 'video', scenes: Array.from({ length: 12 }, (_, i) => scene('v', `s${i}`, `Spot ${i}`)) }];
    expect(paletteScenes(many, 'spot')).toHaveLength(6);
  });
});

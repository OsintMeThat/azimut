import { describe, it, expect } from 'vitest';
import {
  PAD, PANEL_H, GAP, ROW_GAP, FOOTER_H, LEGEND_LINE_H,
  layoutPanels, layoutPanelsFree, freeNormalizeDelta, panelsBottom,
  panelsBlockHeight, panelHeight, captionBand, legendLineHeight, footerBand,
  docSize, legendColumns, legendRowCount, toSpec, offsetShape, copyShapeSpec, autoLayoutRows, TWEET_GUIDES,
  autoCoords, formatCoords, resolveSourceUrls, autoSource, autoSourceUrls,
  proofCoordsText, proofSource, orderedFeatureColors, legendLines,
  dedupeBySrc, isSatelliteCapture, satPanelInput, mediaPanelInput,
} from './composer.js';

// natural is [width, height]; PANEL_H drives the per-row scale.
const landscape = (w = 1000, h = 500, extra = {}) => ({ natural: [w, h], ...extra });

describe('layoutPanels — single row (backward compatible)', () => {
  it('lays panels left→right at PANEL_H on row 0 when no row is set', () => {
    const panels = [landscape(1000, 500), landscape(500, 500)];
    const boxes = layoutPanels(panels);
    // first panel: scale 720/500 = 1.44, width 1440
    expect(boxes[0]).toMatchObject({ x: PAD, y: PAD, h: PANEL_H, row: 0 });
    expect(boxes[0].w).toBeCloseTo(1440);
    // second panel sits a GAP to the right, same row/height
    expect(boxes[1].x).toBeCloseTo(PAD + 1440 + GAP);
    expect(boxes[1].y).toBe(PAD);
    expect(boxes[1].w).toBeCloseTo(720);
  });

  it('treats an explicit row:0 identically to a missing row', () => {
    const a = layoutPanels([landscape(1000, 500), landscape(500, 500)]);
    const b = layoutPanels([landscape(1000, 500, { row: 0 }), landscape(500, 500, { row: 0 })]);
    expect(b).toEqual(a);
  });
});

describe('layoutPanels — stacked rows', () => {
  it('stacks a second row below the first with a caption band + ROW_GAP', () => {
    const panels = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    const boxes = layoutPanels(panels);
    expect(boxes[0].y).toBe(PAD);
    expect(boxes[1].y).toBe(PAD + (PANEL_H + captionBand() + ROW_GAP));
    expect(boxes[1].row).toBe(1);
  });

  it('centres a narrower row under a wider one', () => {
    // row 0: two 1000x500 panels; row 1: one 500x500 panel
    const panels = [
      landscape(1000, 500, { row: 0 }),
      landscape(1000, 500, { row: 0 }),
      landscape(500, 500, { row: 1 }),
    ];
    const boxes = layoutPanels(panels);
    const contentW = 1440 + GAP + 1440; // widest row
    const narrowW = 720;
    expect(boxes[2].x).toBeCloseTo(PAD + (contentW - narrowW) / 2);
  });

  it('normalises sparse row indices by ascending order', () => {
    // rows 0 and 5 → two stacked rows, not six
    const panels = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 5 })];
    const boxes = layoutPanels(panels);
    expect(boxes[1].y).toBe(PAD + (PANEL_H + captionBand() + ROW_GAP));
  });
});

describe('layoutPanels — per-panel scale', () => {
  it('panelHeight is PANEL_H times the panel scale (default 1)', () => {
    expect(panelHeight({ natural: [1, 1] })).toBe(PANEL_H);
    expect(panelHeight({ natural: [1, 1], scale: 0.5 })).toBe(PANEL_H * 0.5);
    expect(panelHeight({ natural: [1, 1], scale: 2 })).toBe(PANEL_H * 2);
  });

  it('scales a panel height/width by its scale and keeps baseScale at scale 1', () => {
    const boxes = layoutPanels([landscape(1000, 500, { scale: 2 })]);
    expect(boxes[0].h).toBe(PANEL_H * 2);
    expect(boxes[0].w).toBeCloseTo(1000 * ((PANEL_H * 2) / 500)); // 2880
    expect(boxes[0].scale).toBeCloseTo((PANEL_H * 2) / 500);
    expect(boxes[0].baseScale).toBeCloseTo(PANEL_H / 500);
  });

  it('bottom-aligns shorter panels within a row (shared caption baseline)', () => {
    const panels = [
      landscape(1000, 500, { row: 0, scale: 1 }),
      landscape(1000, 500, { row: 0, scale: 0.5 }),
    ];
    const boxes = layoutPanels(panels);
    expect(boxes[0].y).toBe(PAD);
    expect(boxes[1].h).toBe(PANEL_H * 0.5);
    expect(boxes[1].y).toBe(PAD + PANEL_H * 0.5); // pushed down to align bottoms
    expect(boxes[0].y + boxes[0].h).toBe(boxes[1].y + boxes[1].h);
  });

  it('stacks the next row below the tallest panel of the previous row', () => {
    const panels = [
      landscape(1000, 500, { row: 0, scale: 2 }),
      landscape(1000, 500, { row: 1, scale: 1 }),
    ];
    const boxes = layoutPanels(panels);
    expect(boxes[1].y).toBe(PAD + (PANEL_H * 2 + captionBand() + ROW_GAP));
  });
});

describe('layoutPanels — free mode', () => {
  it('renders panels without a stored position exactly where the grid would', () => {
    const panels = [landscape(1000, 500), landscape(500, 500)];
    expect(layoutPanels(panels, undefined, 'free')).toEqual(layoutPanels(panels));
  });

  it('places panels at their stored x/y, normalised so the top/left-most lands at PAD', () => {
    const panels = [
      landscape(1000, 500, { x: 100, y: 200 }),
      landscape(500, 500, { x: 400, y: 50 }),
    ];
    const boxes = layoutPanelsFree(panels);
    expect(boxes[0].x).toBe(PAD); // min x = 100 → shifted to PAD
    expect(boxes[1].y).toBe(PAD); // min y = 50 → shifted to PAD
    expect(boxes[1].x).toBe(PAD + 300); // relative offsets preserved
    expect(boxes[0].y).toBe(PAD + 150);
  });

  it('allows two panels to overlap and keeps per-panel scale sizing', () => {
    const panels = [
      landscape(1000, 500, { x: PAD, y: PAD, scale: 2 }),
      landscape(1000, 500, { x: PAD, y: PAD }),
    ];
    const boxes = layoutPanelsFree(panels);
    expect(boxes[0]).toMatchObject({ x: PAD, y: PAD, h: PANEL_H * 2 });
    expect(boxes[1]).toMatchObject({ x: PAD, y: PAD, h: PANEL_H });
    expect(boxes[0].w).toBeCloseTo(2880);
    expect(boxes[0].baseScale).toBeCloseTo(PANEL_H / 500);
  });

  it('a null stored position (persisted spec) falls back to the grid too', () => {
    const panels = [landscape(1000, 500, { x: null, y: null })];
    expect(layoutPanelsFree(panels)[0]).toMatchObject({ x: PAD, y: PAD });
  });
});

describe('freeNormalizeDelta — stored positions re-anchor at PAD', () => {
  it('is zero when positions are already anchored', () => {
    const panels = [landscape(1000, 500, { x: PAD, y: PAD })];
    expect(freeNormalizeDelta(panels)).toEqual({ dx: 0, dy: 0 });
    expect(freeNormalizeDelta([])).toEqual({ dx: 0, dy: 0 });
  });

  it('returns the shift needed after a drag past the top/left edge', () => {
    const panels = [
      landscape(1000, 500, { x: -50, y: 120 }),
      landscape(500, 500, { x: 300, y: 40 }),
    ];
    expect(freeNormalizeDelta(panels)).toEqual({ dx: PAD + 50, dy: PAD - 40 });
  });
});

describe('panelsBottom', () => {
  it('matches PAD + panelsBlockHeight in grid mode', () => {
    const panels = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    expect(panelsBottom(panels)).toBe(PAD + panelsBlockHeight(panels));
    expect(panelsBottom([])).toBe(PAD);
  });

  it('free mode: lowest panel bottom, caption band only under captioned panels', () => {
    const bare = [landscape(1000, 500, { x: PAD, y: PAD })];
    expect(panelsBottom(bare, undefined, 'free')).toBe(PAD + PANEL_H);
    const captioned = [landscape(1000, 500, { x: PAD, y: PAD, caption: 'view' })];
    expect(panelsBottom(captioned, undefined, 'free')).toBe(PAD + PANEL_H + captionBand());
  });

  it('free mode: the lowest panel wins, wherever it sits in the array', () => {
    const panels = [
      landscape(1000, 500, { x: PAD, y: 900 }),
      landscape(500, 500, { x: PAD, y: PAD }),
    ];
    expect(panelsBottom(panels, undefined, 'free')).toBe(900 + PANEL_H);
  });
});

describe('docSize — free layout', () => {
  it('sizes the document to the panel bounding box', () => {
    const panels = [
      landscape(1000, 500, { x: PAD, y: PAD }), // right edge PAD + 1440
      landscape(500, 500, { x: 2000, y: 300 }), // right edge 2720, bottom 1020
    ];
    const { width, height } = docSize(panels, [], {}, {}, [], 'free');
    expect(width).toBe(2720 + PAD);
    expect(height).toBe(1020 + FOOTER_H + PAD);
  });
});

describe('captionBand + panelsBlockHeight', () => {
  it('grows the caption band with the font size', () => {
    expect(captionBand(17)).toBe(34);
    expect(captionBand(40)).toBe(57);
  });

  it('measures the stacked panel block including caption bands and gaps', () => {
    const oneRow = [landscape()];
    const twoRows = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    expect(panelsBlockHeight(oneRow)).toBe(PANEL_H + captionBand());
    expect(panelsBlockHeight(twoRows)).toBe(2 * (PANEL_H + captionBand()) + ROW_GAP);
  });

  it('reflects a custom caption size in the block height', () => {
    const rows = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    expect(panelsBlockHeight(rows, 30)).toBe(2 * (PANEL_H + captionBand(30)) + ROW_GAP);
  });

  it('uses the tallest panel of each row when panels are scaled', () => {
    const panels = [
      landscape(1000, 500, { row: 0, scale: 2 }),
      landscape(1000, 500, { row: 0, scale: 1 }),
      landscape(1000, 500, { row: 1, scale: 0.5 }),
    ];
    const expected =
      (PANEL_H * 2 + captionBand()) + (PANEL_H * 0.5 + captionBand()) + ROW_GAP;
    expect(panelsBlockHeight(panels)).toBe(expected);
  });
});

describe('text band sizes', () => {
  it('grows the legend line height with the legend font size', () => {
    expect(legendLineHeight(17)).toBe(30);
    expect(legendLineHeight(30)).toBe(43);
  });

  it('grows the footer band with the footer font size', () => {
    expect(footerBand(13)).toBe(26);
    expect(footerBand(24)).toBe(37);
  });
});

describe('docSize', () => {
  it('sizes a single panel with no legend', () => {
    const { width, height } = docSize([landscape(1000, 500)], [], {});
    expect(width).toBe(PAD + 1440 + PAD);
    expect(height).toBe(PAD + (PANEL_H + captionBand()) + FOOTER_H + PAD);
  });

  it('accounts for custom caption / legend / footer sizes', () => {
    const panels = [landscape(1000, 500)];
    const shapes = [{ kind: 'rect', color: '#ff5252', panel: 'p1' }];
    const notes = { '#ff5252': 'road' };
    const text = { captionSize: 30, legendSize: 24, footerSize: 20 };
    const { height } = docSize(panels, shapes, notes, text);
    const expected =
      PAD + (PANEL_H + captionBand(30)) + (10 + legendLineHeight(24)) + footerBand(20) + PAD;
    expect(height).toBe(expected);
  });

  it('adds height for legend rows and grows taller with stacked panels', () => {
    const panels = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    const shapes = [{ kind: 'rect', color: '#ff5252', panel: 'p1' }];
    const notes = { '#ff5252': 'road junction' };
    const { height } = docSize(panels, shapes, notes);
    const legendH = 10 + 1 * LEGEND_LINE_H;
    expect(height).toBe(PAD + panelsBlockHeight(panels) + legendH + FOOTER_H + PAD);
  });
});

describe('orderedFeatureColors + legendLines — manual legend order', () => {
  const shapes = [
    { kind: 'rect', color: '#ff5252', panel: 'p1' },
    { kind: 'rect', color: '#40c4ff', panel: 'p1' },
    { kind: 'rect', color: '#ffd740', panel: 'p1' },
  ];

  it('falls back to first-use order when no legendOrder is given', () => {
    expect(orderedFeatureColors(shapes)).toEqual(['#ff5252', '#40c4ff', '#ffd740']);
  });

  it('respects an explicit legendOrder', () => {
    const order = ['#ffd740', '#ff5252', '#40c4ff'];
    expect(orderedFeatureColors(shapes, order)).toEqual(order);
  });

  it('drops colors no longer used and appends newly-used ones after the known order', () => {
    const order = ['#40c4ff', '#gone000']; // '#gone000' has no shape anymore
    const twoColors = shapes.slice(0, 2); // no '#ffd740' shape
    expect(orderedFeatureColors(twoColors, order)).toEqual(['#40c4ff', '#ff5252']);
  });

  it('legendLines follows legendOrder and numbers accordingly', () => {
    const notes = { '#ff5252': 'road', '#40c4ff': 'river', '#ffd740': 'bridge' };
    const order = ['#ffd740', '#40c4ff', '#ff5252'];
    const lines = legendLines(shapes, notes, order);
    expect(lines.map((l) => l.color)).toEqual(order);
    expect(lines.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.text)).toEqual(['bridge', 'river', 'road']);
  });
});

describe('docSize — legendOrder does not affect sizing', () => {
  it('produces the same height regardless of legend order', () => {
    const panels = [landscape(1000, 500)];
    const shapes = [
      { kind: 'rect', color: '#ff5252', panel: 'p1' },
      { kind: 'rect', color: '#40c4ff', panel: 'p1' },
    ];
    const notes = { '#ff5252': 'road', '#40c4ff': 'river' };
    const a = docSize(panels, shapes, notes, {}, []);
    const b = docSize(panels, shapes, notes, {}, ['#40c4ff', '#ff5252']);
    expect(b.height).toBe(a.height);
    expect(b.legend.map((l) => l.color)).toEqual(['#40c4ff', '#ff5252']);
  });
});

describe('legend columns', () => {
  it('keeps one column for narrow docs or a single feature', () => {
    expect(legendColumns(400, 3)).toBe(1);
    expect(legendColumns(2000, 1)).toBe(1);
  });

  it('splits into more columns as width and feature count allow, capped at 3', () => {
    expect(legendColumns(800, 3)).toBe(2);
    expect(legendColumns(3000, 8)).toBe(3);
  });

  it('never exceeds the feature count', () => {
    expect(legendColumns(3000, 2)).toBe(2);
  });

  it('computes stacked legend rows from the column count', () => {
    expect(legendRowCount(5, 2)).toBe(3);
    expect(legendRowCount(3, 3)).toBe(1);
    expect(legendRowCount(0, 2)).toBe(0);
  });
});

describe('toSpec — persistence of layout', () => {
  it('serialises the row index and caption size', () => {
    const proof = {
      title: 'T', coords: null, captionSize: 24, legendSize: 22, footerSize: 18,
      footer: '  Custom footer  ', notes: {},
      panels: [
        { id: 'p1', src: 'a.png', caption: '', row: 0, natural: [100, 100], meta: {} },
        { id: 'p2', src: 'b.png', caption: 'x', row: 1, natural: [100, 100], meta: {} },
      ],
      shapes: [],
    };
    const spec = toSpec(proof);
    expect(spec.captionSize).toBe(24);
    expect(spec.legendSize).toBe(22);
    expect(spec.footerSize).toBe(18);
    expect(spec.footer).toBe('Custom footer'); // trimmed
    expect(spec.panels.map((p) => p.row)).toEqual([0, 1]);
  });

  it('stores a blank footer as null so the automatic attribution shows', () => {
    const proof = { title: 'T', footer: '   ', panels: [], shapes: [] };
    expect(toSpec(proof).footer).toBeNull();
  });

  it('defaults a missing row to 0 and caption size to the base', () => {
    const proof = {
      title: 'T', panels: [{ id: 'p1', src: 'a.png', natural: [10, 10] }], shapes: [],
    };
    const spec = toSpec(proof);
    expect(spec.panels[0].row).toBe(0);
    expect(spec.captionSize).toBeGreaterThan(0);
  });

  it('serialises per-panel scale, defaulting a missing scale to 1', () => {
    const proof = {
      title: 'T',
      panels: [
        { id: 'p1', src: 'a.png', natural: [10, 10], scale: 1.5 },
        { id: 'p2', src: 'b.png', natural: [10, 10] },
      ],
      shapes: [],
    };
    expect(toSpec(proof).panels.map((p) => p.scale)).toEqual([1.5, 1]);
  });
});

describe('toSpec — layout mode + free positions', () => {
  it('defaults to the grid layout with null positions', () => {
    const proof = {
      title: 'T', panels: [{ id: 'p1', src: 'a.png', natural: [10, 10] }], shapes: [],
    };
    const spec = toSpec(proof);
    expect(spec.layout).toBe('grid');
    expect(spec.panels[0].x).toBeNull();
    expect(spec.panels[0].y).toBeNull();
  });

  it('persists the free layout and each panel position', () => {
    const proof = {
      title: 'T',
      layout: 'free',
      panels: [{ id: 'p1', src: 'a.png', natural: [10, 10], x: 120, y: 340 }],
      shapes: [],
    };
    const spec = toSpec(proof);
    expect(spec.layout).toBe('free');
    expect(spec.panels[0]).toMatchObject({ x: 120, y: 340 });
  });
});

describe('satPanelInput — satellite caption dates with the imagery date, never the fetch date', () => {
  const capture = {
    path: 'media/sat_1.png',
    attribution: '© Provider',
    lat: 48.85, lon: 2.35, zoom: 17,
    provider_label: 'Esri',
    fetched_at: '2026-07-14T10:00:00Z',
  };

  it('captions provider · coords · imagery acquisition date when known', () => {
    const input = satPanelInput({ ...capture, imagery_date: '2024-03-02' });
    expect(input.caption).toBe('Esri · 48.850000, 2.350000 · 2024-03-02');
  });

  it('omits the date part when the imagery date is unknown (no fetch-date fallback)', () => {
    expect(satPanelInput(capture).caption).toBe('Esri · 48.850000, 2.350000');
    expect(satPanelInput({ ...capture, imagery_date: null }).caption).toBe('Esri · 48.850000, 2.350000');
  });

  it('keeps the full provenance in meta (both dates, provider, coords)', () => {
    const input = satPanelInput({ ...capture, imagery_date: '2024-03-02' });
    expect(input.src).toBe('media/sat_1.png');
    expect(input.meta).toMatchObject({
      kind: 'satellite', provider: 'Esri', lat: 48.85, lon: 2.35, zoom: 17,
      attribution: '© Provider', date: '2026-07-14', imagery_date: '2024-03-02',
    });
  });
});

describe('mediaPanelInput — media panel carries its traced source', () => {
  it('resolves the source link through the derivation chain, no caption', () => {
    const video = { path: 'media/v.mp4', source: { type: 'download', webpage_url: 'https://x.com/a/1' } };
    const frame = { path: 'media/f.png', source: { type: 'inspect', op: 'frame', from: 'media/v.mp4' } };
    const input = mediaPanelInput(frame, [video, frame]);
    expect(input.caption).toBe('');
    expect(input.meta).toMatchObject({
      kind: 'media', source_url: 'https://x.com/a/1', source_urls: ['https://x.com/a/1'],
    });
  });
});

describe('autoLayoutRows — magic tweet fit', () => {
  const sq = (extra) => landscape(500, 500, extra);

  it('leaves 0 or 1 panels in a single row', () => {
    expect(autoLayoutRows([])).toEqual([]);
    expect(autoLayoutRows([sq()])).toEqual([0]);
  });

  it('returns one contiguous, non-decreasing row index per panel', () => {
    const rows = autoLayoutRows([sq(), sq(), sq(), sq()]);
    expect(rows).toHaveLength(4);
    for (let i = 1; i < rows.length; i++) {
      const step = rows[i] - rows[i - 1];
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(1); // rows only ever advance by one
    }
  });

  it('breaks a wide strip of square panels into multiple rows for 16:9', () => {
    const rows = autoLayoutRows([sq(), sq(), sq(), sq()], [], {}, {}, TWEET_GUIDES['16:9']);
    expect(Math.max(...rows)).toBeGreaterThan(0);
  });

  it('packs at least as tall for a 4:5 target as for a 16:9 target', () => {
    const panels = [sq(), sq(), sq(), sq(), sq(), sq()];
    const wide = autoLayoutRows(panels, [], {}, {}, TWEET_GUIDES['16:9']);
    const tall = autoLayoutRows(panels, [], {}, {}, TWEET_GUIDES['4:5']);
    expect(Math.max(...tall)).toBeGreaterThanOrEqual(Math.max(...wide));
  });
});

describe('copyShapeSpec — clipboard copy of any shape kind', () => {
  it('strips the id from the copy', () => {
    const out = copyShapeSpec({ id: 's1', kind: 'rect', panel: 'p1', color: '#fff', x: 1, y: 2, w: 3, h: 4 });
    expect(out).not.toHaveProperty('id');
    expect(out).toEqual({ kind: 'rect', panel: 'p1', color: '#fff', x: 1, y: 2, w: 3, h: 4 });
  });

  // The regression: line/arrow/curve keep their geometry in a `points` array, so
  // the copy must carry the full array (a shallow spread once left it proxied and
  // the browser refused to clone it, silently breaking copy for those kinds).
  it('copies the whole points array of line / arrow / curve kinds', () => {
    for (const kind of ['line', 'arrow', 'curve']) {
      const out = copyShapeSpec({ id: 's', kind, panel: 'p1', color: '#fff', points: [0, 0, 10, 20, 30, 40] });
      expect(out).toEqual({ kind, panel: 'p1', color: '#fff', points: [0, 0, 10, 20, 30, 40] });
    }
  });

  it('detaches deeply — mutating the source leaves the copy untouched', () => {
    const src = { id: 's', kind: 'arrow', panel: 'p1', color: '#fff', points: [0, 0, 5, 5] };
    const out = copyShapeSpec(src);
    src.points[0] = 999;
    src.color = '#000';
    expect(out.points[0]).toBe(0);
    expect(out.color).toBe('#fff');
  });
});

describe('offsetShape — copy / paste / duplicate', () => {
  it('nudges x/y kinds (box, ellipse, text) down-right and drops the id', () => {
    const rect = { id: 's1', kind: 'rect', panel: 'p1', color: '#fff', x: 10, y: 20, w: 5, h: 5 };
    const out = offsetShape(rect, 26);
    expect(out).not.toHaveProperty('id');
    expect(out).toMatchObject({ x: 36, y: 46, w: 5, h: 5, panel: 'p1' });
  });

  it('shifts every vertex of points-based kinds (line/arrow/curve)', () => {
    const line = { id: 's2', kind: 'line', panel: 'p1', color: '#fff', points: [0, 0, 100, 40] };
    const out = offsetShape(line, 10);
    expect(out.points).toEqual([10, 10, 110, 50]);
  });

  it('deep-clones so the source is untouched', () => {
    const src = { id: 's3', kind: 'curve', panel: 'p1', points: [1, 2, 3, 4] };
    const out = offsetShape(src, 5);
    out.points[0] = 999;
    expect(src.points[0]).toBe(1);
  });
});

describe('coordinates — auto-derive + fallback', () => {
  const geo = (lat, lon) => ({ meta: { kind: 'satellite', lat, lon } });
  const plain = () => ({ meta: { kind: 'media' } });

  it('takes the first panel that carries geo (add order)', () => {
    expect(autoCoords([plain(), geo(1.5, 2.5), geo(9, 9)])).toEqual({ lat: 1.5, lon: 2.5 });
  });

  it('falls back to the next geo panel when the first is removed', () => {
    const panels = [geo(1, 1), geo(2, 2)];
    expect(autoCoords(panels)).toEqual({ lat: 1, lon: 1 });
    expect(autoCoords(panels.slice(1))).toEqual({ lat: 2, lon: 2 }); // first deleted
  });

  it('is null with no geo panel, and formats to 6 decimals', () => {
    expect(autoCoords([plain()])).toBeNull();
    expect(formatCoords(null)).toBe('');
    expect(formatCoords({ lat: 12.3, lon: -4 })).toBe('12.300000, -4.000000');
  });

  it('prefers a manual override over the auto value', () => {
    expect(proofCoordsText({ panels: [geo(1, 1)] })).toBe('1.000000, 1.000000');
    expect(proofCoordsText({ panels: [geo(1, 1)], coordsText: '  48.8, 2.3 ' })).toBe('48.8, 2.3');
  });
});

describe('source — always a link, traced through the derivation chain', () => {
  const downloaded = (path, url) => ({ path, source: { type: 'download', url, webpage_url: url } });
  const uploaded = (path) => ({ path, source: { type: 'upload', original_name: 'clip.mp4' } });
  const frameOf = (path, from) => ({ path, source: { type: 'inspect', op: 'frame', from } });
  const collageOf = (path, sources) => ({ path, source: { type: 'inspect', op: 'collage', from: '', sources } });
  const byPath = (...items) => new Map(items.map((i) => [i.path, i]));

  it('returns the URL of a directly downloaded item', () => {
    const item = downloaded('media/v.mp4', 'https://x.com/a/1');
    expect(resolveSourceUrls(item, byPath(item))).toEqual(['https://x.com/a/1']);
  });

  it('treats a disk upload (no URL) as having no source', () => {
    const item = uploaded('media/u.mp4');
    expect(resolveSourceUrls(item, byPath(item))).toEqual([]);
  });

  it('follows a frame back to the downloaded video it came from', () => {
    const video = downloaded('media/v.mp4', 'https://x.com/a/1');
    const frame = frameOf('media/f.png', 'media/v.mp4');
    expect(resolveSourceUrls(frame, byPath(video, frame))).toEqual(['https://x.com/a/1']);
  });

  it('unions the distinct sources of a collage built from two videos', () => {
    const v1 = downloaded('media/v1.mp4', 'https://x.com/a/1');
    const v2 = downloaded('media/v2.mp4', 'https://t.me/b/2');
    const collage = collageOf('media/c.png', ['media/v1.mp4', 'media/v2.mp4']);
    expect(resolveSourceUrls(collage, byPath(v1, v2, collage)))
      .toEqual(['https://x.com/a/1', 'https://t.me/b/2']);
  });

  it('aggregates distinct panel source links, ignoring satellite imagery', () => {
    const panels = [
      { meta: { kind: 'satellite', attribution: '© Provider' } },
      { meta: { kind: 'media', source_urls: ['https://x.com/a/1'] } },
      { meta: { kind: 'media', source_urls: ['https://x.com/a/1'] } }, // duplicate collapses
      { meta: { kind: 'media', source_url: 'https://t.me/b/2' } },
    ];
    expect(autoSourceUrls(panels)).toEqual(['https://x.com/a/1', 'https://t.me/b/2']);
    expect(autoSource(panels)).toBe('https://x.com/a/1  ·  https://t.me/b/2');
  });

  it('prefers a manual source override over the auto value', () => {
    const panels = [{ meta: { kind: 'media', source_urls: ['https://x.com/a/1'] } }];
    expect(proofSource({ panels })).toBe('https://x.com/a/1');
    expect(proofSource({ panels, source: ' https://manual ' })).toBe('https://manual');
  });
});

describe('toSpec — coordinates + source persistence', () => {
  it('stores auto coords and null overrides when nothing is manual', () => {
    const proof = {
      title: 'T',
      panels: [{ id: 'p1', src: 'a.png', natural: [10, 10], meta: { lat: 3, lon: 4 } }],
      shapes: [],
    };
    const spec = toSpec(proof);
    expect(spec.coords).toEqual({ lat: 3, lon: 4 });
    expect(spec.coordsText).toBeNull();
    expect(spec.source).toBeNull();
  });

  it('persists manual coordinate + source overrides (trimmed)', () => {
    const spec = toSpec({ title: 'T', panels: [], shapes: [], coordsText: ' 1, 2 ', source: ' http://s ' });
    expect(spec.coordsText).toBe('1, 2');
    expect(spec.source).toBe('http://s');
  });
});

describe('tweet guides', () => {
  it('exposes landscape and portrait crop aspects', () => {
    expect(TWEET_GUIDES['16:9']).toBeCloseTo(16 / 9);
    expect(TWEET_GUIDES['4:5']).toBeCloseTo(0.8);
  });
});

describe('dedupeBySrc — picker items collapse on shared src', () => {
  // A satellite capture is registered as a media image too, so /satellite and
  // /media surface the same path. Without this collapse the keyed picker each
  // block throws `each_key_duplicate` and "Add panel" silently does nothing.
  it('drops later items that repeat an earlier src', () => {
    const items = [
      { src: 'media/sat_1.png', kind: 'satellite' },
      { src: 'media/photo.jpg', kind: 'media' },
      { src: 'media/sat_1.png', kind: 'media' }, // same file, from the media list
    ];
    const out = dedupeBySrc(items);
    expect(out.map((i) => i.src)).toEqual(['media/sat_1.png', 'media/photo.jpg']);
  });

  it('keeps the first occurrence, so the richer satellite entry wins over media', () => {
    const items = [
      { src: 'media/sat_1.png', kind: 'satellite', meta: { lat: 1 } },
      { src: 'media/sat_1.png', kind: 'media', meta: {} },
    ];
    const out = dedupeBySrc(items);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('satellite');
  });

  it('produces a duplicate-free set of keys (the picker each-key invariant)', () => {
    const items = [
      { src: 'a' }, { src: 'b' }, { src: 'a' }, { src: 'c' }, { src: 'b' },
    ];
    const keys = dedupeBySrc(items).map((i) => i.src);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('leaves an already-unique list untouched', () => {
    const items = [{ src: 'x' }, { src: 'y' }, { src: 'z' }];
    expect(dedupeBySrc(items)).toEqual(items);
  });
});

describe('isSatelliteCapture — a capture is a media image flagged by its source', () => {
  it('is true for a media item whose source.type is satellite', () => {
    expect(isSatelliteCapture({ kind: 'image', source: { type: 'satellite' } })).toBe(true);
  });

  it('is false for an ordinary image, and tolerates a missing source', () => {
    expect(isSatelliteCapture({ kind: 'image', source: { type: 'download' } })).toBe(false);
    expect(isSatelliteCapture({ kind: 'image' })).toBe(false);
    expect(isSatelliteCapture({})).toBe(false);
  });

  it('lets the picker drop captures from the media half so nothing double-lists', () => {
    const media = [
      { path: 'media/sat_1.png', kind: 'image', source: { type: 'satellite' } },
      { path: 'media/photo.jpg', kind: 'image', source: { type: 'download' } },
    ];
    const kept = media.filter((m) => m.kind === 'image' && !isSatelliteCapture(m));
    expect(kept.map((m) => m.path)).toEqual(['media/photo.jpg']);
  });
});

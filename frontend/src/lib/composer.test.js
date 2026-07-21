import { describe, it, expect } from 'vitest';
import {
  PAD, PANEL_H, GAP, ROW_GAP, FOOTER_H, LEGEND_LINE_H,
  layoutPanels, layoutPanelsFree, freeNormalizeDelta, panelsBottom,
  panelsBlockHeight, panelHeight, captionBand, legendLineHeight, footerBand,
  docSize, legendColumns, legendRowCount, toSpec, offsetShape, copyShapeSpec, autoLayoutRows, TWEET_GUIDES,
  autoCoords, formatCoords, resolveSourceUrls, autoSource, autoSourceUrls,
  proofCoordsText, proofSource, orderedFeatureColors, legendLines,
  dedupeBySrc, isSatelliteCapture, satPanelInput, mediaPanelInput,
  SIG_MARGIN, SIG_SCALE, newSignature, signatureBox, signatureOffset, signaturePairPositions,
  proofSlug, uniqueProofTitle, proofTitleFromCase, DEFAULT_PROOF_TITLE,
  filterProofPanelItems, hasProofCanvasContent,
  remapPanelXY, panelHitTest, groupNeighborIndex, hasGroupNeighbor,
  denseRowValues, clampPanelScale, trimClosingDuplicate, smoothFreehandPoints,
  freehandShape, canReassignLegendNote,
  savedProofEntities, savedProofSlugs, savedProofTitles, savedProofTitle,
  BG, ANNO_COLORS, MAX_ANNO_COLORS, normSpace, isLightColor, textColors,
  normalizePreferredColors, replacePreferredColor,
  TEXT_MAIN, TEXT_MAIN_LIGHT, templateFromProof, applyProofStyle, normalizeProofStyle,
  anchoredPos, anchoredOffset, newSignatureText, SIG_TEXT_SIZE,
  orientFirstPanels, proofExportOptions,
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
    const panels = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 1, caption: 'b' })];
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
    const panels = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 5, caption: 'b' })];
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
      landscape(1000, 500, { row: 0, scale: 2, caption: 'a' }),
      landscape(1000, 500, { row: 1, scale: 1, caption: 'b' }),
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
    const oneRow = [landscape(1000, 500, { caption: 'c' })];
    const twoRows = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 1, caption: 'b' })];
    expect(panelsBlockHeight(oneRow)).toBe(PANEL_H + captionBand());
    expect(panelsBlockHeight(twoRows)).toBe(2 * (PANEL_H + captionBand()) + ROW_GAP);
  });

  it('reflects a custom caption size in the block height', () => {
    const rows = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 1, caption: 'b' })];
    expect(panelsBlockHeight(rows, 30)).toBe(2 * (PANEL_H + captionBand(30)) + ROW_GAP);
  });

  it('uses the tallest panel of each row when panels are scaled', () => {
    const panels = [
      landscape(1000, 500, { row: 0, scale: 2, caption: 'a' }),
      landscape(1000, 500, { row: 0, scale: 1 }),
      landscape(1000, 500, { row: 1, scale: 0.5, caption: 'b' }),
    ];
    const expected =
      (PANEL_H * 2 + captionBand()) + (PANEL_H * 0.5 + captionBand()) + ROW_GAP;
    expect(panelsBlockHeight(panels)).toBe(expected);
  });

  it('collapses the caption band on a row with no caption text', () => {
    // caption-less panels leave no empty strip: the block is just the panels
    expect(panelsBlockHeight([landscape()])).toBe(PANEL_H);
    const twoRows = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    expect(panelsBlockHeight(twoRows)).toBe(2 * PANEL_H + ROW_GAP);
    // only the captioned row keeps its band
    const mixed = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 1 })];
    expect(panelsBlockHeight(mixed)).toBe(2 * PANEL_H + captionBand() + ROW_GAP);
  });

  it('stacks caption-less rows tighter (no band between them)', () => {
    const panels = [landscape(1000, 500, { row: 0 }), landscape(1000, 500, { row: 1 })];
    const boxes = layoutPanels(panels);
    expect(boxes[1].y).toBe(PAD + PANEL_H + ROW_GAP);
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
    const { width, height } = docSize([landscape(1000, 500, { caption: 'c' })], [], {});
    expect(width).toBe(PAD + 1440 + PAD);
    expect(height).toBe(PAD + (PANEL_H + captionBand()) + FOOTER_H + PAD);
  });

  it('accounts for custom caption / legend / footer sizes', () => {
    const panels = [landscape(1000, 500, { caption: 'c' })];
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
  it('persists the selected house-style ID without putting it in the style payload', () => {
    const spec = toSpec({ title: 'T', templateId: 'dark-house', panels: [], shapes: [] });
    expect(spec.templateId).toBe('dark-house');
    expect(templateFromProof({ templateId: 'dark-house', panels: [], shapes: [] }))
      .not.toHaveProperty('templateId');
  });

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

  it.each([18, 32])('keeps %i panels on the bounded layout path', (count) => {
    const rows = autoLayoutRows(Array.from({ length: count }, () => sq()));
    expect(rows).toHaveLength(count);
    expect(rows[0]).toBe(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(0);
      expect(rows[i] - rows[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('uses active spacing when choosing row breaks', () => {
    const panels = [landscape(1658, 500), landscape(569, 500), landscape(880, 500)];
    const tight = autoLayoutRows(panels, [], {}, {}, TWEET_GUIDES['16:9'], {
      pad: 20, gap: 0, rowGap: 0,
    });
    const wide = autoLayoutRows(panels, [], {}, {}, TWEET_GUIDES['16:9'], {
      pad: 20, gap: 200, rowGap: 200,
    });
    expect(tight).toEqual([0, 1, 1]);
    expect(wide).toEqual([0, 0, 1]);
  });
});

describe('copyShapeSpec — clipboard copy of any shape kind', () => {
  it('strips the id from the copy', () => {
    const out = copyShapeSpec({ id: 's1', kind: 'rect', panel: 'p1', color: '#fff', x: 1, y: 2, w: 3, h: 4 });
    expect(out).not.toHaveProperty('id');
    expect(out).toEqual({ kind: 'rect', panel: 'p1', color: '#fff', x: 1, y: 2, w: 3, h: 4 });
  });

  // The regression: line/arrow/curve/freehand keep their geometry in a `points` array, so
  // the copy must carry the full array (a shallow spread once left it proxied and
  // the browser refused to clone it, silently breaking copy for those kinds).
  it('copies the whole points array of line / arrow / curve / freehand kinds', () => {
    for (const kind of ['line', 'arrow', 'curve', 'freehand']) {
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

  it('shifts every vertex of points-based kinds', () => {
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

describe('freehand strokes', () => {
  it('dampens pointer jitter while preserving both endpoints', () => {
    expect(smoothFreehandPoints([0, 0, 5, 10, 10, 0], 0)).toEqual([
      0, 0, 5, 5, 10, 0,
    ]);
  });

  it('drops samples that are too close to matter on screen', () => {
    expect(smoothFreehandPoints([0, 0, 0.2, 0.1, 0.4, -0.1, 10, 0], 2)).toEqual([
      0, 0, 10, 0,
    ]);
  });

  it('builds a lightly tensioned stroke and rejects accidental tiny drags', () => {
    expect(freehandShape([0, 0, 1, 1], { minDistance: 0, minLength: 5 })).toBeNull();
    expect(freehandShape([0, 0, 5, 10, 10, 0], { minDistance: 0, minLength: 5 })).toEqual({
      kind: 'freehand',
      points: [0, 0, 5, 5, 10, 0],
      tension: 0.25,
    });
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

describe('coordinate format threading — the reader’s format reaches captions, not provenance', () => {
  const capture = {
    path: 'media/sat_1.png',
    attribution: '© Provider',
    lat: 48.85, lon: 2.35, zoom: 17,
    provider_label: 'Esri',
    fetched_at: '2026-07-14T10:00:00Z',
    imagery_date: '2024-03-02',
  };

  it('renders a satellite caption in the chosen format', () => {
    expect(satPanelInput(capture, 'dms').caption).toBe(
      'Esri · 48°51\'00.00"N 2°21\'00.00"E · 2024-03-02'
    );
    expect(satPanelInput(capture, 'mgrs').caption).toBe('Esri · 31U DQ 52314 10984 · 2024-03-02');
  });

  it('keeps decimal degrees in the panel meta whatever the caption says', () => {
    // provenance stays machine-readable: an MGRS caption must not move the
    // numbers a later reader (or re-export) depends on
    for (const format of ['dd', 'dms', 'mgrs']) {
      expect(satPanelInput(capture, format).meta).toMatchObject({ lat: 48.85, lon: 2.35 });
    }
  });

  it('defaults to decimal degrees when no format is passed', () => {
    expect(satPanelInput(capture).caption).toBe('Esri · 48.850000, 2.350000 · 2024-03-02');
    expect(formatCoords({ lat: 12.3, lon: -4 })).toBe('12.300000, -4.000000');
  });

  it('formats a proof’s auto coordinates in the chosen format', () => {
    const panels = [{ meta: { kind: 'satellite', lat: 48.85, lon: 2.35 } }];
    expect(proofCoordsText({ panels }, 'dms')).toBe('48°51\'00.00"N 2°21\'00.00"E');
    expect(proofCoordsText({ panels }, 'mgrs')).toBe('31U DQ 52314 10984');
  });

  it('never reformats a manual override — that text is the analyst’s', () => {
    const spec = { panels: [{ meta: { kind: 'satellite', lat: 48.85, lon: 2.35 } }], coordsText: 'as given' };
    expect(proofCoordsText(spec, 'mgrs')).toBe('as given');
  });
});

describe('signatureBox — anchoring', () => {
  const natural = [200, 100]; // 2:1 logo
  const sig = (extra = {}) => ({ ...newSignature(), ...extra });

  it('sizes the logo inside a proof-relative footprint, keeping its aspect', () => {
    const box = signatureBox(sig({ scale: 0.1 }), 1000, 800, natural);
    expect(box.w).toBe(100);
    expect(box.h).toBe(50); // 2:1 preserved
  });

  it('caps a tall PNG inside the same standard footprint', () => {
    const box = signatureBox(sig({ scale: 0.1 }), 1000, 800, [100, 400]);
    expect(box.w).toBe(20);
    expect(box.h).toBe(80);
  });

  it('hangs off each of the four corners, inset by the margin', () => {
    const at = (anchor) => signatureBox(sig({ anchor, scale: 0.1 }), 1000, 800, natural);
    expect(at('tl')).toMatchObject({ x: SIG_MARGIN, y: SIG_MARGIN });
    expect(at('tr')).toMatchObject({ x: 1000 - SIG_MARGIN - 100, y: SIG_MARGIN });
    expect(at('bl')).toMatchObject({ x: SIG_MARGIN, y: 800 - SIG_MARGIN - 50 });
    expect(at('br')).toMatchObject({ x: 1000 - SIG_MARGIN - 100, y: 800 - SIG_MARGIN - 50 });
  });

  it('applies the drag nudge on top of the anchor', () => {
    const box = signatureBox(sig({ anchor: 'tl', scale: 0.1, dx: 30, dy: 12 }), 1000, 800, natural);
    expect(box).toMatchObject({ x: SIG_MARGIN + 30, y: SIG_MARGIN + 12 });
  });

  it('keeps the same corner as the document grows — the point of anchoring', () => {
    const small = signatureBox(sig({ anchor: 'br', scale: 0.1 }), 1000, 800, natural);
    const grown = signatureBox(sig({ anchor: 'br', scale: 0.1 }), 2000, 1600, natural);
    expect(small.x + small.w).toBe(1000 - SIG_MARGIN);
    expect(grown.x + grown.w).toBe(2000 - SIG_MARGIN); // still hugging the edge
  });

  it('clamps a nudge that would push the logo off the export', () => {
    const box = signatureBox(sig({ anchor: 'tl', scale: 0.1, dx: -500, dy: -500 }), 1000, 800, natural);
    expect(box).toMatchObject({ x: 0, y: 0 });
    const far = signatureBox(sig({ anchor: 'tl', scale: 0.1, dx: 5000, dy: 5000 }), 1000, 800, natural);
    expect(far).toMatchObject({ x: 900, y: 750 }); // flush against the far edge
  });

  it('defaults to bottom-right at the default scale', () => {
    const box = signatureBox(newSignature(), 1000, 800, natural);
    expect(SIG_SCALE).toBe(0.08);
    expect(box.w).toBe(1000 * SIG_SCALE);
    expect(box.x + box.w).toBe(1000 - SIG_MARGIN);
  });
});

describe('signatureOffset — a drag round-trips through the anchor', () => {
  const natural = [200, 100];

  it('returns the dx/dy that reproduces a dropped position', () => {
    for (const anchor of ['tl', 'tr', 'bl', 'br']) {
      const sig = { ...newSignature(), anchor, scale: 0.1 };
      const { dx, dy } = signatureOffset(sig, 1000, 800, natural, 300, 250);
      const box = signatureBox({ ...sig, dx, dy }, 1000, 800, natural);
      expect(box).toMatchObject({ x: 300, y: 250 });
    }
  });

  it('keeps a free placement at the same relative position on another proof size', () => {
    const sig = { ...newSignature(), anchor: 'tl', scale: 0.1 };
    const placement = signatureOffset(sig, 1000, 800, natural, 300, 250);
    const grown = signatureBox({ ...sig, ...placement }, 2000, 1600, natural);
    expect(grown).toMatchObject({ x: 600, y: 500 });
  });
});

describe('signaturePairPositions — untouched branding never overlaps', () => {
  it('centres the account handle below the logo', () => {
    const signature = newSignature();
    const handle = newSignatureText();
    const logo = signatureBox(signature, 1000, 800, [200, 100]);
    const pair = signaturePairPositions(signature, handle, 1000, 800, logo, 120, 28);
    expect(pair.handle.y).toBeGreaterThan(pair.logo.y + pair.logo.h);
    expect(pair.logo.x + pair.logo.w / 2).toBeCloseTo(pair.handle.x + 60);
  });

  it('stops grouping after either item is moved', () => {
    const signature = { ...newSignature(), xRatio: 0.5, yRatio: 0.5 };
    const logo = signatureBox(signature, 1000, 800, [200, 100]);
    expect(signaturePairPositions(signature, newSignatureText(), 1000, 800, logo, 120, 28))
      .toBeNull();
  });
});

describe('orientFirstPanels — template direction', () => {
  it('places the first pair side by side or in two rows', () => {
    const horizontal = [{ row: 3 }, { row: 4 }, { row: 4 }];
    orientFirstPanels(horizontal, 'horizontal');
    expect(horizontal.map((p) => p.row)).toEqual([0, 0, 4]);

    const vertical = [{ row: 3 }, { row: 4 }, { row: 4 }];
    orientFirstPanels(vertical, 'vertical');
    expect(vertical.map((p) => p.row)).toEqual([0, 1, 4]);
  });
});

describe('proofSlug — mirrors the backend _slug', () => {
  it('lowercases, hyphenates runs of non-alphanumerics, trims edges', () => {
    expect(proofSlug('Untitled proof')).toBe('untitled-proof');
    expect(proofSlug('  Rooftop! @ 12:30  ')).toBe('rooftop-12-30');
    expect(proofSlug('Café déjà')).toBe('caf-d-j');
  });

  it('falls back to "proof" when nothing survives, and caps at 80 chars', () => {
    expect(proofSlug('')).toBe('proof');
    expect(proofSlug('!!!')).toBe('proof');
    expect(proofSlug(null)).toBe('proof');
    expect(proofSlug('a'.repeat(200))).toHaveLength(80);
  });
});

describe('uniqueProofTitle — a fresh proof reads apart from the case', () => {
  it('returns the base when no proof carries it', () => {
    expect(uniqueProofTitle(DEFAULT_PROOF_TITLE, new Set())).toBe('Untitled proof');
    expect(uniqueProofTitle(DEFAULT_PROOF_TITLE, ['Rooftop'])).toBe('Untitled proof');
  });

  it('numbers past the base and any run already taken', () => {
    expect(uniqueProofTitle(DEFAULT_PROOF_TITLE, new Set(['Untitled proof']))).toBe('Untitled proof 2');
    const taken = ['Untitled proof', 'Untitled proof 2', 'Untitled proof 3'];
    expect(uniqueProofTitle(DEFAULT_PROOF_TITLE, taken)).toBe('Untitled proof 4');
  });

  it('the numbered title still slugs to a distinct filename', () => {
    expect(proofSlug(uniqueProofTitle(DEFAULT_PROOF_TITLE, ['Untitled proof']))).toBe('untitled-proof-2');
  });
});

describe('proofTitleFromCase — new-proof name', () => {
  it('uses the trimmed case name and keeps it unique among saved proofs', () => {
    expect(proofTitleFromCase('  Harbour review  ', [])).toBe('Harbour review');
    expect(proofTitleFromCase('Harbour review', ['Harbour review'])).toBe('Harbour review 2');
  });

  it('falls back to the normal untitled name when no case name is available', () => {
    expect(proofTitleFromCase('', [])).toBe(DEFAULT_PROOF_TITLE);
    expect(proofTitleFromCase(null, [DEFAULT_PROOF_TITLE])).toBe('Untitled proof 2');
  });
});

describe('filterProofPanelItems — new-proof panel selector', () => {
  const items = [
    {
      src: 'media/satellite-city.png',
      label: '48.85, 2.35 · z17',
      kind: 'satellite',
      meta: { provider: 'Esri World Imagery', imagery_date: '2026-07-01' },
    },
    { src: 'media/storefront.jpg', label: 'Storefront.jpg', kind: 'media', meta: {} },
    { src: 'media/roof.png', label: 'Red roof.png', kind: 'media', meta: {} },
  ];

  it('filters satellite captures independently from other images', () => {
    expect(filterProofPanelItems(items, '', 'satellite').map((item) => item.src))
      .toEqual(['media/satellite-city.png']);
    expect(filterProofPanelItems(items, '', 'media').map((item) => item.src))
      .toEqual(['media/storefront.jpg', 'media/roof.png']);
  });

  it('searches the active category by label, path, and satellite metadata', () => {
    expect(filterProofPanelItems(items, 'roof', 'media').map((item) => item.src))
      .toEqual(['media/roof.png']);
    expect(filterProofPanelItems(items, 'esri', 'satellite').map((item) => item.src))
      .toEqual(['media/satellite-city.png']);
    expect(filterProofPanelItems(items, 'storefront', 'satellite')).toEqual([]);
  });
});

describe('hasProofCanvasContent — empty template-only proof', () => {
  it('keeps template decoration hidden until a panel exists', () => {
    expect(hasProofCanvasContent({ panels: [], signature: { anchor: 'br' }, footer: 'Source' }))
      .toBe(false);
    expect(hasProofCanvasContent({ panels: [{ src: 'media/a.png' }], signature: null }))
      .toBe(true);
  });
});

describe('remapPanelXY — moving a shape between panels', () => {
  it('is identity when the two boxes coincide', () => {
    const box = { x: 100, y: 40, scale: 2 };
    expect(remapPanelXY(10, 5, box, box)).toEqual({ x: 10, y: 5 });
  });

  it('maps a natural point through doc space into the target scale', () => {
    const from = { x: 100, y: 40, scale: 2 };
    const to = { x: 0, y: 0, scale: 4 };
    // doc point (100 + 10*2, 40 + 5*2) = (120, 50); target natural divides by 4
    expect(remapPanelXY(10, 5, from, to)).toEqual({ x: 30, y: 12.5 });
  });
});

describe('panelHitTest — topmost panel under a point', () => {
  const boxes = [
    { x: 0, y: 0, w: 100, h: 100, scale: 2 }, // front (drawn first = z-top)
    { x: 50, y: 50, w: 100, h: 100, scale: 1 }, // back
  ];

  it('returns null when the point misses every box', () => {
    expect(panelHitTest(boxes, { x: 500, y: 500 })).toBeNull();
  });

  it('returns the front box on overlap, with natural coords', () => {
    const hit = panelHitTest(boxes, { x: 60, y: 60 });
    expect(hit.index).toBe(0);
    expect(hit.nx).toBe(30); // (60-0)/2
    expect(hit.ny).toBe(30);
  });

  it('falls through to a lower box when the front one misses', () => {
    const hit = panelHitTest(boxes, { x: 120, y: 120 });
    expect(hit.index).toBe(1);
    expect(hit.nx).toBe(70); // (120-50)/1
  });

  it('counts the box edges as inside', () => {
    expect(panelHitTest(boxes, { x: 0, y: 0 }).index).toBe(0);
    expect(panelHitTest(boxes, { x: 100, y: 100 }).index).toBe(0);
  });
});

describe('groupNeighborIndex / hasGroupNeighbor — reorder within a group', () => {
  // rows [0, 1, 0, 0]: indices 0, 2, 3 share row 0
  const panels = [{ row: 0 }, { row: 1 }, { row: 0 }, { row: 0 }];
  const rowOf = (p) => p.row ?? 0;

  it('skips other groups to find the nearest same-group neighbour', () => {
    expect(groupNeighborIndex(panels, 0, 1, rowOf)).toBe(2); // index 1 is row 1
    expect(groupNeighborIndex(panels, 2, -1, rowOf)).toBe(0);
    expect(groupNeighborIndex(panels, 2, 1, rowOf)).toBe(3);
  });

  it('returns -1 at the group edge', () => {
    expect(groupNeighborIndex(panels, 0, -1, rowOf)).toBe(-1);
    expect(groupNeighborIndex(panels, 1, 1, rowOf)).toBe(-1); // lone row 1
    expect(groupNeighborIndex(panels, 3, 1, rowOf)).toBe(-1);
  });

  it('hasGroupNeighbor agrees on whether a move is possible', () => {
    expect(hasGroupNeighbor(panels, 0, -1, rowOf)).toBe(false);
    expect(hasGroupNeighbor(panels, 0, 1, rowOf)).toBe(true);
    expect(hasGroupNeighbor(panels, 1, 1, rowOf)).toBe(false);
    expect(hasGroupNeighbor(panels, 3, -1, rowOf)).toBe(true);
  });

  it('works for shapes keyed by their panel too', () => {
    const shapes = [{ panel: 'a' }, { panel: 'b' }, { panel: 'a' }];
    expect(groupNeighborIndex(shapes, 0, 1, (s) => s.panel)).toBe(2);
    expect(hasGroupNeighbor(shapes, 1, -1, (s) => s.panel)).toBe(false);
  });
});

describe('denseRowValues — collapse sparse rows to 0..n-1', () => {
  it('renumbers gaps left by an emptied row', () => {
    const panels = [{ row: 0 }, { row: 2 }, { row: 2 }, { row: 5 }];
    expect(denseRowValues(panels)).toEqual([0, 1, 1, 2]);
  });

  it('treats a missing row as 0', () => {
    expect(denseRowValues([{}, { row: 3 }])).toEqual([0, 1]);
  });
});

describe('clampPanelScale', () => {
  it('adds the delta and clamps to the range', () => {
    expect(clampPanelScale(1, 0.5, 0.25, 2.5)).toBe(1.5);
    expect(clampPanelScale(2.4, 0.5, 0.25, 2.5)).toBe(2.5);
    expect(clampPanelScale(0.3, -0.5, 0.25, 2.5)).toBe(0.25);
  });

  it('rounds to whole percent and defaults a missing scale to 1', () => {
    expect(clampPanelScale(1, 0.024, 0.25, 2.5)).toBe(1.02);
    expect(clampPanelScale(undefined, 0.5, 0.25, 2.5)).toBe(1.5);
  });
});

describe('trimClosingDuplicate — drop the double-click tail', () => {
  it('trims the last vertex when it lands on the previous one', () => {
    expect(trimClosingDuplicate([0, 0, 10, 10, 10, 11])).toEqual([0, 0, 10, 10]);
  });

  it('keeps a genuine final vertex', () => {
    const pts = [0, 0, 10, 10, 40, 40];
    expect(trimClosingDuplicate(pts)).toEqual(pts);
  });

  it('returns a copy, never mutating the input', () => {
    const pts = [0, 0, 10, 10, 10, 10];
    const out = trimClosingDuplicate(pts);
    expect(pts).toHaveLength(6);
    expect(out).toHaveLength(4);
  });

  it('leaves a genuine two-point line alone', () => {
    expect(trimClosingDuplicate([0, 0, 40, 40])).toEqual([0, 0, 40, 40]);
  });
});

describe('canReassignLegendNote — move a note with a recolored shape', () => {
  it('moves the note when the new color is free and no other shape keeps the old', () => {
    const moving = { color: 'red' };
    const notes = { red: 'the roof' };
    expect(canReassignLegendNote(notes, 'red', 'blue', [moving], moving)).toBe(true);
  });

  it('keeps the note when another shape still uses the old color', () => {
    const moving = { color: 'red' };
    const other = { color: 'red' };
    const notes = { red: 'the roof' };
    expect(canReassignLegendNote(notes, 'red', 'blue', [moving, other], moving)).toBe(false);
  });

  it('does not clobber an existing note on the new color', () => {
    const moving = { color: 'red' };
    const notes = { red: 'the roof', blue: 'the car' };
    expect(canReassignLegendNote(notes, 'red', 'blue', [moving], moving)).toBe(false);
  });

  it('is false when the old color had no note', () => {
    const moving = { color: 'red' };
    expect(canReassignLegendNote({}, 'red', 'blue', [moving], moving)).toBe(false);
  });
});

describe('saved-proof case queries', () => {
  const entities = [
    { label: 'Rooftop', attrs: { spec: 'proofs/rooftop.json' } },
    { label: 'Bridge', attrs: { spec: 'proofs/bridge.json' } },
    { label: 'A place', attrs: { spec: 'places/x.json' } }, // not a proof
    { label: 'No spec' },
  ];

  it('picks only entities filed as proofs/*.json', () => {
    expect(savedProofEntities(entities).map((e) => e.label)).toEqual(['Rooftop', 'Bridge']);
    expect(savedProofEntities(undefined)).toEqual([]);
  });

  it('lists the slugs (filename without proofs/ and .json)', () => {
    expect(savedProofSlugs(entities)).toEqual(new Set(['rooftop', 'bridge']));
  });

  it('lists the titles', () => {
    expect(savedProofTitles(entities)).toEqual(new Set(['Rooftop', 'Bridge']));
  });

  it('resolves a title by slug, falling back to the slug itself', () => {
    expect(savedProofTitle(entities, 'bridge')).toBe('Bridge');
    expect(savedProofTitle(entities, 'unknown')).toBe('unknown');
  });
});

describe('isLightColor + textColors — text tracks the proof background', () => {
  it('reads dark backgrounds as dark and pale ones as light', () => {
    expect(isLightColor('#0d1117')).toBe(false);
    expect(isLightColor('#000000')).toBe(false);
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#f4f1ea')).toBe(true);
    expect(isLightColor('#fff')).toBe(true); // 3-digit shorthand
  });

  it('is tolerant of a missing or malformed colour (treats it as dark)', () => {
    expect(isLightColor('')).toBe(false);
    expect(isLightColor('nope')).toBe(false);
    expect(isLightColor(null)).toBe(false);
  });

  it('gives light text on the default dark bg and dark text on a light bg', () => {
    expect(textColors(BG).main).toBe(TEXT_MAIN);
    expect(textColors('#ffffff').main).toBe(TEXT_MAIN_LIGHT);
  });
});

describe('normSpace — panel spacing with shipped-default fallbacks', () => {
  it('fills every field from the defaults when nothing is given', () => {
    expect(normSpace()).toEqual({ pad: PAD, gap: GAP, rowGap: ROW_GAP });
    expect(normSpace(null)).toEqual({ pad: PAD, gap: GAP, rowGap: ROW_GAP });
  });

  it('keeps the values it is given, defaulting only the missing ones', () => {
    expect(normSpace({ gap: 40 })).toEqual({ pad: PAD, gap: 40, rowGap: ROW_GAP });
    expect(normSpace({ pad: 0, gap: 0, rowGap: 0 })).toEqual({ pad: 0, gap: 0, rowGap: 0 });
  });

  it('clamps unsafe values and replaces non-finite values', () => {
    expect(normSpace({ pad: -1, gap: 1e308, rowGap: NaN }))
      .toEqual({ pad: 0, gap: 200, rowGap: ROW_GAP });
    expect(normSpace({ pad: Infinity, gap: '20', rowGap: {} }))
      .toEqual({ pad: PAD, gap: GAP, rowGap: ROW_GAP });
  });
});

describe('layout — parametric margins (bg/space templates)', () => {
  it('a wider gap pushes the second panel further right', () => {
    const panels = [landscape(1000, 500), landscape(500, 500)];
    const boxes = layoutPanels(panels, undefined, 'grid', { gap: 100 });
    expect(boxes[1].x).toBeCloseTo(PAD + 1440 + 100);
  });

  it('a custom outer padding moves the origin of the first panel', () => {
    const boxes = layoutPanels([landscape(1000, 500)], undefined, 'grid', { pad: 60 });
    expect(boxes[0]).toMatchObject({ x: 60, y: 60 });
  });

  it('a custom rowGap changes where the next row stacks', () => {
    const panels = [landscape(1000, 500, { row: 0, caption: 'a' }), landscape(1000, 500, { row: 1, caption: 'b' })];
    const boxes = layoutPanels(panels, undefined, 'grid', { rowGap: 80 });
    expect(boxes[1].y).toBe(PAD + PANEL_H + captionBand() + 80);
  });

  it('docSize grows with a bigger padding', () => {
    const tight = docSize([landscape(1000, 500)], [], {}, {}, [], 'grid', { pad: 20 });
    const roomy = docSize([landscape(1000, 500)], [], {}, {}, [], 'grid', { pad: 60 });
    expect(roomy.width).toBe(tight.width + 2 * (60 - 20));
    expect(roomy.height).toBe(tight.height + 2 * (60 - 20));
  });

  it('defaults leave the layout identical to the shipped constants', () => {
    const panels = [landscape(1000, 500), landscape(500, 500, { row: 0 })];
    expect(layoutPanels(panels, undefined, 'grid', normSpace())).toEqual(layoutPanels(panels));
  });
});

describe('toSpec — background + spacing persistence', () => {
  it('defaults a fresh proof to the shipped bg and spacing', () => {
    const spec = toSpec({ title: 'T', panels: [], shapes: [] });
    expect(spec.bg).toBe(BG);
    expect(spec.space).toEqual({ pad: PAD, gap: GAP, rowGap: ROW_GAP });
  });

  it('persists a custom background and partial spacing (missing fields filled)', () => {
    const spec = toSpec({ title: 'T', panels: [], shapes: [], bg: '#ffffff', space: { gap: 50 } });
    expect(spec.bg).toBe('#ffffff');
    expect(spec.space).toEqual({ pad: PAD, gap: 50, rowGap: ROW_GAP });
  });

  it('persists a custom drawing palette and defaults older proofs', () => {
    const custom = toSpec({ title: 'T', panels: [], shapes: [], palette: ['#123456'] });
    const older = toSpec({ title: 'T', panels: [], shapes: [] });
    expect(custom.palette).toEqual(['#123456']);
    expect(older.palette).toEqual(ANNO_COLORS);
  });
});

describe('preferred drawing colours', () => {
  it('uses the seven shipped colours for a missing or empty palette', () => {
    expect(normalizePreferredColors()).toEqual(ANNO_COLORS);
    expect(normalizePreferredColors([])).toEqual(ANNO_COLORS);
    expect(ANNO_COLORS).toHaveLength(MAX_ANNO_COLORS);
  });

  it('deduplicates colours and caps the palette at seven', () => {
    expect(normalizePreferredColors([
      '#111111', '#111111', '#222222', '#333333', '#444444',
      '#555555', '#666666', '#777777', '#888888', 'invalid',
    ])).toEqual([
      '#111111', '#222222', '#333333', '#444444',
      '#555555', '#666666', '#777777',
    ]);
  });

  it('replaces the selected palette slot', () => {
    expect(replacePreferredColor(ANNO_COLORS, 2, '#123456')).toEqual([
      ANNO_COLORS[0], ANNO_COLORS[1], '#123456', ...ANNO_COLORS.slice(3),
    ]);
  });

  it('swaps slots when the replacement colour is already in the palette', () => {
    expect(replacePreferredColor(ANNO_COLORS, 2, ANNO_COLORS[0])).toEqual([
      ANNO_COLORS[2], ANNO_COLORS[1], ANNO_COLORS[0], ...ANNO_COLORS.slice(3),
    ]);
  });
});

describe('templateFromProof — a content-free house style', () => {
  const proof = {
    title: 'Rooftop match',
    bg: '#101418',
    space: { pad: 30, gap: 40, rowGap: 24 },
    layout: 'free',
    captionSize: 24, legendSize: 22, footerSize: 16,
    footer: 'By the desk',
    footerEnabled: false,
    footerColor: '#aabbcc',
    captionsEnabled: false,
    signature: { anchor: 'br', dx: 5, dy: 0, scale: 0.12, opacity: 0.9 },
    signatureText: { text: '@desk', anchor: 'tr', dx: 0, dy: 0, size: 44, color: '#ffffff', opacity: 1 },
    palette: ['#123456', '#ff5252', '#40c4ff'],
    notes: { '#ff5252': 'Match', '#40c4ff': 'Reference' },
    legendOrder: ['#40c4ff', '#ff5252'],
    coordsText: '48.85, 2.35',
    source: 'https://x.com/a/1',
    panels: [{ id: 'p1', src: 'a.png', natural: [10, 10] }],
    shapes: [{ id: 's1', kind: 'rect', color: '#ff5252', panel: 'p1' }],
  };

  it('keeps only the style, never the content', () => {
    const t = templateFromProof(proof);
    expect(t).toEqual({
      bg: '#101418',
      space: { pad: 30, gap: 40, rowGap: 24 },
      layout: 'free',
      captionSize: 24, legendSize: 22, footerSize: 16,
      footer: 'By the desk',
      footerEnabled: false,
      footerColor: '#aabbcc',
      footerAlign: 'left',
      captionsEnabled: false,
      panelDirection: 'horizontal',
      signature: { anchor: 'br', dx: 5, dy: 0, scale: 0.12, opacity: 0.9 },
      signatureText: { anchor: 'tr', dx: 0, dy: 0, size: 44, color: '#ffffff', opacity: 1 },
      palette: ['#123456', '#ff5252', '#40c4ff'],
    });
    expect(t).not.toHaveProperty('panels');
    expect(t).not.toHaveProperty('shapes');
    expect(t).not.toHaveProperty('title');
    expect(t).not.toHaveProperty('coordsText');
    expect(t).not.toHaveProperty('source');
    expect(t).not.toHaveProperty('notes');
    expect(t).not.toHaveProperty('legendOrder');
  });

  it('detaches — mutating the template leaves the proof untouched', () => {
    const t = templateFromProof(proof);
    t.palette[0] = '#abcdef';
    t.signature.dx = 999;
    t.signatureText.size = 99;
    expect(proof.palette[0]).toBe('#123456');
    expect(proof.signature.dx).toBe(5);
    expect(proof.signatureText.size).toBe(44);
  });

  it('fills shipped defaults for a bare proof', () => {
    const t = templateFromProof({ panels: [], shapes: [] });
    expect(t.bg).toBe(BG);
    expect(t.space).toEqual({ pad: PAD, gap: GAP, rowGap: ROW_GAP });
    expect(t.layout).toBe('grid');
    expect(t.signature).toBeNull();
    expect(t.signatureText).toBeNull();
    expect(t.footerEnabled).toBe(true);
    expect(t.footerColor).toBeNull();
    expect(t.footerAlign).toBe('left');
    expect(t.panelDirection).toBe('horizontal');
    expect(t.captionsEnabled).toBe(true);
    expect(t.palette).toEqual(ANNO_COLORS);
  });
});

describe('normalizeProofStyle — renderer boundary', () => {
  it('normalizes malformed nested values, enums, colors and numbers', () => {
    const style = normalizeProofStyle({
      bg: 'red', space: { pad: -10, gap: Infinity, rowGap: 1e308 },
      layout: 'stacked', captionSize: NaN, legendSize: -1, footerSize: 1e308,
      footer: 'x'.repeat(250), footerColor: 'white', footerAlign: 'center',
      signature: { anchor: 'middle', dx: Infinity, scale: 99, opacity: -1 },
      signatureText: [], palette: ['bad'],
    });
    expect(style).toMatchObject({
      bg: BG,
      space: { pad: 0, gap: GAP, rowGap: 200 },
      layout: 'grid',
      captionSize: 20,
      legendSize: 8,
      footerSize: 80,
      footerColor: null,
      footerAlign: 'left',
      signature: { anchor: 'br', dx: 0, scale: 0.6, opacity: 0 },
      signatureText: null,
      palette: ANNO_COLORS,
    });
    expect(style.footer).toHaveLength(200);
  });

  it('keeps document-relative branding coordinates within the document range', () => {
    const style = normalizeProofStyle({
      signature: { anchor: 'tl', xRatio: 1.5, yRatio: -0.5 },
      signatureText: { anchor: 'br', xRatio: 0.25, yRatio: 0.75 },
    });
    expect(style.signature).toMatchObject({ xRatio: 1, yRatio: 0 });
    expect(style.signatureText).toMatchObject({ xRatio: 0.25, yRatio: 0.75 });
  });
});

describe('proofExportOptions — canvas allocation guard', () => {
  it('returns the existing export ratio for an ordinary proof', () => {
    expect(proofExportOptions(1800, 900)).toEqual({
      pixelRatio: 1, outputWidth: 1800, outputHeight: 900,
    });
  });

  it('rejects invalid, over-dimension and over-pixel exports', () => {
    expect(() => proofExportOptions(Infinity, 900)).toThrow(/dimensions are invalid/i);
    expect(() => proofExportOptions(30_000, 100)).toThrow(/too large to export/i);
    expect(() => proofExportOptions(12_000, 12_000)).toThrow(/too large to export/i);
  });
});

describe('applyProofStyle — restyle without touching content', () => {
  const style = {
    bg: '#ffffff',
    space: { pad: 40, gap: 40, rowGap: 40 },
    layout: 'free',
    captionSize: 26, legendSize: 26, footerSize: 18,
    footer: 'House line',
    signature: { anchor: 'tl', dx: 0, dy: 0, scale: 0.1, opacity: 1 },
    palette: ['#123456', '#abcdef'],
  };

  it('applies every style field but leaves panels/shapes/title/coords alone', () => {
    const proof = {
      title: 'Keep me', coordsText: '1, 2', source: 'http://s',
      panels: [{ id: 'p1', src: 'a.png' }], shapes: [{ id: 's1' }],
      notes: { '#ff5252': 'Keep this legend' }, legendOrder: ['#ff5252'],
    };
    applyProofStyle(proof, style);
    expect(proof.bg).toBe('#ffffff');
    expect(proof.space).toEqual({ pad: 40, gap: 40, rowGap: 40 });
    expect(proof.layout).toBe('free');
    expect(proof.footer).toBe('House line');
    expect(proof.signature).toMatchObject({ anchor: 'tl' });
    // content untouched
    expect(proof.title).toBe('Keep me');
    expect(proof.coordsText).toBe('1, 2');
    expect(proof.panels).toHaveLength(1);
    expect(proof.shapes).toHaveLength(1);
    expect(proof.palette).toEqual(['#123456', '#abcdef']);
    expect(proof.notes).toEqual({ '#ff5252': 'Keep this legend' });
    expect(proof.legendOrder).toEqual(['#ff5252']);
  });

  it('replaces the preferred palette without changing legend content', () => {
    const proof = {
      palette: [...ANNO_COLORS],
      notes: { '#ff5252': 'My own label' },
      legendOrder: ['#ff5252'],
    };
    applyProofStyle(proof, style);
    expect(proof.palette).toEqual(['#123456', '#abcdef']);
    expect(proof.notes).toEqual({ '#ff5252': 'My own label' });
    expect(proof.legendOrder).toEqual(['#ff5252']);
  });

  it('detaches the applied signature and space objects', () => {
    const proof = { notes: {}, legendOrder: [] };
    applyProofStyle(proof, style);
    proof.signature.dx = 99;
    proof.space.pad = 99;
    expect(style.signature.dx).toBe(0);
    expect(style.space.pad).toBe(40);
  });

  it('a round-trip through a template reproduces the same style', () => {
    const original = {
      bg: '#101418', space: { pad: 30, gap: 40, rowGap: 24 }, layout: 'free',
      captionSize: 24, legendSize: 22, footerSize: 16, footer: 'By the desk',
      footerEnabled: false, footerColor: '#aabbcc',
      signature: { anchor: 'br', dx: 5, dy: 0, scale: 0.12, opacity: 0.9 },
      signatureText: { text: '@desk', anchor: 'tr', dx: 2, dy: 3, size: 44, color: '#fff', opacity: 1 },
      palette: ['#123456', '#abcdef'],
      notes: { '#ff5252': 'Match' }, legendOrder: ['#ff5252'],
      panels: [], shapes: [],
    };
    const target = { notes: {}, legendOrder: [], panels: [], shapes: [] };
    applyProofStyle(target, templateFromProof(original));
    expect(templateFromProof(target)).toEqual(templateFromProof(original));
  });

  it('applies the footer switch/colour and the text signature', () => {
    const proof = { notes: {}, legendOrder: [], panels: [], shapes: [] };
    applyProofStyle(proof, {
      footerEnabled: false,
      footerColor: '#123456',
      footerAlign: 'right',
      signatureText: { text: '@name', anchor: 'tl', dx: 0, dy: 0, size: 50, color: '#fff', opacity: 1 },
    });
    expect(proof.footerEnabled).toBe(false);
    expect(proof.footerColor).toBe('#123456');
    expect(proof.footerAlign).toBe('right');
    expect(proof.signatureText).toMatchObject({ anchor: 'tl' });
    expect(proof.signatureText).not.toHaveProperty('text');
    // a style without a text signature clears any existing one
    applyProofStyle(proof, { signatureText: null });
    expect(proof.signatureText).toBeNull();
  });

  it('adds logo and account-handle slots only when both the template and Settings provide them', () => {
    const proof = { notes: {}, legendOrder: [] };
    const signed = {
      signature: { anchor: 'br', dx: 0, dy: 0, scale: 0.12, opacity: 1 },
      signatureText: { anchor: 'tl', dx: 0, dy: 0, size: 50, color: '#fff', opacity: 1 },
    };
    applyProofStyle(proof, signed, { logo: false, handle: false });
    expect(proof.signature).toBeNull();
    expect(proof.signatureText).toBeNull();

    applyProofStyle(proof, signed, { logo: true, handle: true });
    expect(proof.signature).toMatchObject({ anchor: 'br' });
    expect(proof.signatureText).toMatchObject({ anchor: 'tl' });
  });

  it('applies the template direction to the first two existing panels', () => {
    const proof = { panels: [{ row: 0 }, { row: 0 }], notes: {}, legendOrder: [] };
    applyProofStyle(proof, { panelDirection: 'vertical' });
    expect(proof.panelDirection).toBe('vertical');
    expect(proof.panels.map((p) => p.row)).toEqual([0, 1]);
  });

  it('apply-then-discard restores the visual style the proof had before', () => {
    // The composer's "Discard template" path: snapshot the look, apply a
    // template over it, then re-apply the snapshot to walk the style back.
    const proof = {
      bg: '#0d1117', space: { pad: 40, gap: 24, rowGap: 24 }, layout: 'grid',
      captionSize: 20, legendSize: 18, footerSize: 14, footer: '',
      footerEnabled: true, footerColor: null,
      signature: null, signatureText: null, palette: [...ANNO_COLORS], notes: {}, legendOrder: [],
      panels: [], shapes: [],
    };
    const before = templateFromProof(proof);
    applyProofStyle(proof, {
      bg: '#ffffff', space: { pad: 0, gap: 0, rowGap: 0 }, layout: 'free',
      palette: ['#123456'],
      footerEnabled: false, signature: { anchor: 'br', dx: 0, dy: 0, scale: 0.2, opacity: 1 },
    });
    expect(proof.footerEnabled).toBe(false);
    applyProofStyle(proof, before); // discard
    expect(templateFromProof(proof)).toEqual(before);
  });
});

describe('toSpec — footer switch/colour + text signature', () => {
  it('defaults a fresh proof to footer-on, auto colour, no text signature', () => {
    const spec = toSpec({ title: 'T', panels: [], shapes: [] });
    expect(spec.footerEnabled).toBe(true);
    expect(spec.footerColor).toBeNull();
    expect(spec.footerAlign).toBe('left');
    expect(spec.panelDirection).toBe('horizontal');
    expect(spec.signatureText).toBeNull();
  });

  it('persists a disabled footer, a footer colour and a text signature', () => {
    const spec = toSpec({
      title: 'T', panels: [], shapes: [],
      footerEnabled: false, footerColor: '#334455', footerAlign: 'right', panelDirection: 'vertical',
      signatureText: { text: '@n', anchor: 'br', dx: 1, dy: 2, size: 44, color: '#fff', opacity: 0.8 },
    });
    expect(spec.footerEnabled).toBe(false);
    expect(spec.footerColor).toBe('#334455');
    expect(spec.footerAlign).toBe('right');
    expect(spec.panelDirection).toBe('vertical');
    expect(spec.signatureText).toMatchObject({ anchor: 'br' });
    expect(spec.signatureText).not.toHaveProperty('text');
  });
});

describe('docSize — footer can be switched off', () => {
  it('reclaims the footer band height when the footer is disabled', () => {
    const panels = [landscape(1000, 500)];
    const on = docSize(panels, [], {}, { footerEnabled: true });
    const off = docSize(panels, [], {}, { footerEnabled: false });
    expect(on.height - off.height).toBe(FOOTER_H);
  });

  it('footer off + no captions + no margins reduces to just the panels', () => {
    const panels = [landscape(1000, 500), landscape(500, 500)];
    const { width, height } = docSize(
      panels, [], {}, { footerEnabled: false }, [], 'grid', { pad: 0, gap: 0, rowGap: 0 }
    );
    expect(height).toBe(PANEL_H); // no caption band, no footer, no padding
    expect(width).toBe(1440 + 720); // the two panels, no gap
  });
});

describe('anchoredPos / anchoredOffset — the text-signature placement', () => {
  it('hangs a box off each corner inset by the margin', () => {
    expect(anchoredPos({ anchor: 'tl' }, 1000, 800, 100, 40)).toEqual({ x: SIG_MARGIN, y: SIG_MARGIN });
    expect(anchoredPos({ anchor: 'br' }, 1000, 800, 100, 40))
      .toEqual({ x: 1000 - SIG_MARGIN - 100, y: 800 - SIG_MARGIN - 40 });
  });

  it('applies a nudge and clamps inside the document', () => {
    expect(anchoredPos({ anchor: 'tl', dx: 20, dy: 10 }, 1000, 800, 100, 40)).toEqual({ x: SIG_MARGIN + 20, y: SIG_MARGIN + 10 });
    expect(anchoredPos({ anchor: 'tl', dx: -9999, dy: -9999 }, 1000, 800, 100, 40)).toEqual({ x: 0, y: 0 });
  });

  it('anchoredOffset reproduces a dropped position (round-trip)', () => {
    for (const anchor of ['tl', 'tr', 'bl', 'br']) {
      const off = anchoredOffset({ anchor }, 1000, 800, 120, 44, 300, 250);
      const pos = anchoredPos({ anchor, ...off }, 1000, 800, 120, 44);
      expect(pos).toEqual({ x: 300, y: 250 });
    }
  });

  it('keeps a free account-handle placement relative to a resized proof', () => {
    const placement = anchoredOffset({ anchor: 'tl' }, 1000, 800, 100, 40, 300, 250);
    const grown = anchoredPos({ anchor: 'tl', ...placement }, 2000, 1600, 200, 80);
    expect(grown.x).toBeCloseTo(600);
    expect(grown.y).toBeCloseTo(500);
  });

  it('newSignatureText is a bottom-right handle at the default size', () => {
    const s = newSignatureText();
    expect(SIG_TEXT_SIZE).toBe(28);
    expect(s).toMatchObject({ anchor: 'br', size: SIG_TEXT_SIZE, opacity: 1 });
    expect(s).not.toHaveProperty('text');
  });
});

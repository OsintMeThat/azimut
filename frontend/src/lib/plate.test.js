import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FAMILY_ORDER, EDGE_KINDS } from './graph.js';
import {
  PLATE,
  PLATE_COLOURS,
  PLATE_FONT,
  escapeXml,
  familyColour,
  fitText,
  plateDocument,
  plateFilename,
  plateHeader,
  plateLegend,
  svgText,
} from './plate.js';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** The declarations under `:root[data-theme='light']`, as `{ token: value }`.
 *  Comments are stripped first: they sit after the semicolon and would otherwise be
 *  read as the head of the next declaration. */
function lightTokens() {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = plain.slice(plain.indexOf(":root[data-theme='light']"));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  const tokens = {};
  for (const line of body.split(';')) {
    const [name, value] = line.split(':');
    if (name?.trim().startsWith('--')) tokens[name.trim()] = (value ?? '').trim();
  }
  return tokens;
}

const meta = {
  caseName: 'Bakhmut convoy',
  surface: 'Graph',
  view: 'Rooftop match',
  lens: 'All connections',
  question: 'AB-123 · Type: Vehicle',
  window: '23 Aug – 1 Oct 2026',
  clock: 'Asia/Tokyo',
  at: '2026-08-13T20:10:31Z',
};

describe('the exported palette', () => {
  it('is the daylight one, and does not drift from app.css', () => {
    const light = lightTokens();
    expect(PLATE_COLOURS.paper).toBe(light['--bg-1']);
    expect(PLATE_COLOURS.ink).toBe(light['--text-1']);
    expect(PLATE_COLOURS.label).toBe(light['--text-2']);
    expect(PLATE_COLOURS.hint).toBe(light['--text-3']);
    expect(PLATE_COLOURS.accent).toBe(light['--accent']);
    for (const family of FAMILY_ORDER) {
      expect(PLATE_COLOURS.family[family]).toBe(light[`--graph-${family}`]);
    }
  });

  it('names every family the graph can draw', () => {
    expect(Object.keys(PLATE_COLOURS.family).sort()).toEqual([...FAMILY_ORDER].sort());
    expect(familyColour('nonsense')).toBe(PLATE_COLOURS.family.document);
  });

  it('ships no CSS variable and no app-only font into a file', () => {
    const { svg } = plateDocument({
      meta,
      families: [{ family: 'actor', count: 3 }],
      strokes: EDGE_KINDS.slice(0, 2),
      drawing: { width: 900, height: 400, body: '<g />' },
    });
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toMatch(/Oxanium/);
    expect(PLATE_FONT).not.toMatch(/Oxanium/);
  });
});

describe('the plate header', () => {
  it('states the reading, the case and the clock it was read on', () => {
    const { svg, height } = plateHeader(meta, 900);
    expect(svg).toContain('Rooftop match');
    expect(svg).toContain('Bakhmut convoy · Graph · All connections');
    expect(svg).toContain('Question: AB-123 · Type: Vehicle');
    expect(svg).toContain('Fact time 23 Aug – 1 Oct 2026 · Clock Asia/Tokyo');
    expect(svg).toContain('Exported 2026-08-13 20:10 UTC');
    expect(height).toBeGreaterThan(PLATE.pad);
  });

  it('falls back to the surface when no view is open, and never to a blank title', () => {
    const { svg } = plateHeader({ title: 'Graph · All connections', caseName: 'Case' }, 900);
    expect(svg).toContain('Graph · All connections');
    expect(plateHeader({}, 900).svg).toContain('Untitled reading');
  });

  it('cuts a long title to the room the stamp leaves it', () => {
    // A view can be named with 80 characters and the stamp keeps the right edge of the
    // same line, so on a small plate the title is what has to give way.
    const long = 'Rooftop match against every convoy sighting on the western approach';
    const tight = plateHeader({ ...meta, view: long }, PLATE.minWidth).svg;

    expect(tight).not.toContain(long);
    expect(tight).toContain('…');
    expect(tight).toContain('Exported 2026-08-13 20:10 UTC');
    // Given the room, nothing is cut.
    expect(plateHeader({ ...meta, view: long }, 2000).svg).toContain(long);
  });

  it('states what the drawing holds when the surface has counted it', () => {
    const { svg } = plateHeader({ ...meta, tally: '182 nodes · 240 links' }, 900);
    expect(svg).toContain('182 nodes · 240 links');
  });

  it('leaves out a line it has nothing to say on', () => {
    const { svg } = plateHeader({ view: 'Bare', caseName: 'Case' }, 900);
    expect(svg).not.toContain('Question:');
    expect(svg).not.toContain('Fact time');
    expect(svg).not.toContain('Exported');
  });
});

describe('the plate legend', () => {
  it('draws a hue per family and the dash pattern of every stroke on show', () => {
    const { svg, height } = plateLegend(
      { families: [{ family: 'actor', count: 2 }, { family: 'place', count: 5 }], strokes: EDGE_KINDS },
      900,
      500,
    );
    expect(svg).toContain(PLATE_COLOURS.family.actor);
    expect(svg).toContain('actor · 2');
    expect(svg).toContain('stated relation');
    // 8, 5 is the stated relation's own pattern in EDGE_KINDS — the wording and the
    // dashes both come from the registry rather than from a second table here.
    expect(svg).toContain('stroke-dasharray="8 5"');
    expect(height).toBeGreaterThan(PLATE.legendRow);
  });

  it('says nothing when there is nothing to explain', () => {
    const { svg, height } = plateLegend({}, 900, 100);
    expect(svg).toContain('<line');
    expect(height).toBe(18);
  });

  it('flows into as many columns as the plate is wide', () => {
    const families = FAMILY_ORDER.map((family) => ({ family, count: 1 }));
    const narrow = plateLegend({ families }, PLATE.legendColumn + PLATE.pad * 2, 0);
    const wide = plateLegend({ families }, 2000, 0);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
});

describe('framing a drawing', () => {
  it('widens to the drawing, holds it under the header and closes the document', () => {
    const { svg, width, height } = plateDocument({
      meta,
      families: [{ family: 'actor', count: 1 }],
      strokes: [EDGE_KINDS[0]],
      drawing: { width: 1200, height: 800, body: '<circle cx="1" cy="2" r="3" />', defs: '<marker id="m" />' },
    });
    expect(width).toBe(1200 + PLATE.pad * 2);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain('<defs><marker id="m" /></defs>');
    expect(svg).toContain('<circle cx="1" cy="2" r="3" />');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('never shrinks below a readable plate, nor past a size no reader gains from', () => {
    expect(plateDocument({ drawing: { width: 10, height: 10, body: '' } }).width)
      .toBe(PLATE.minWidth);
    expect(plateDocument({ drawing: { width: 99_999, height: 10, body: '' } }).width)
      .toBe(PLATE.maxWidth);
  });
});

describe('serialising text', () => {
  it('escapes what a label may hold, so one entity name cannot break the file', () => {
    expect(escapeXml('Quay & <script>alert("x")</script>')).toBe(
      'Quay &amp; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(svgText('a & b', { x: 1, y: 2 })).toContain('a &amp; b');
  });

  it('haloes a label that has to survive crossing a line', () => {
    const drawn = svgText('Quay 4', { x: 1, y: 2, halo: 3 });
    expect(drawn).toContain(`stroke="${PLATE_COLOURS.paper}"`);
    expect(drawn).toContain('paint-order="stroke"');
    expect(svgText('Quay 4', { x: 1, y: 2 })).not.toContain('paint-order');
  });

  it('writes nothing for a label with nothing in it', () => {
    expect(svgText('   ', { x: 1, y: 2 })).toBe('');
    expect(svgText(null, { x: 1, y: 2 })).toBe('');
  });

  it('cuts to the room it is given, and never through a surrogate pair', () => {
    expect(fitText('Checkpoint standing', 1000)).toBe('Checkpoint standing');
    expect(fitText('Checkpoint standing', 30)).toBe('Chec…');
    expect(fitText('Checkpoint standing', 3)).toBe('');
    // Half of a pair is not a character, and a plate holding one cannot be written out.
    expect(fitText('🏴🏴🏴🏴', 18)).toBe('🏴🏴…');
    expect(fitText(null, 100)).toBe('');
    // The face matters: a title costs more per character than a lane label.
    expect(fitText('Checkpoint standing', 60, PLATE.titleChar)).toBe('Check…');
  });
});

describe('naming the file', () => {
  it('is named after the reading, stamped to the minute', () => {
    expect(plateFilename({ surface: 'Graph', view: 'Rooftop match', at: meta.at }))
      .toBe('graph-rooftop-match-202608132010');
  });

  it('falls back to the lens, then to a name that is still a name', () => {
    expect(plateFilename({ surface: 'graph', lens: 'All connections', at: meta.at }))
      .toBe('graph-all-connections-202608132010');
    expect(plateFilename({ at: meta.at })).toBe('graph-reading-202608132010');
  });
});

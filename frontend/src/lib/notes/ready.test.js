import { describe, expect, it } from 'vitest';
import { READY_NOTES, SHOWCASE, filledBody } from './ready.js';
import { HINT_LINE, coverChoice, normaliseLook, templateLook } from './look.js';
import { COVER_SKELETON, SIGNATURE_BLOCK, coverLineIndex, hasCover } from './reportParts.js';
import { calloutOf } from './callouts.js';
import { findCoordinates } from './syntax.js';
import { readLook } from './editor/tableLook.js';

const named = (id) => READY_NOTES.find((ready) => ready.id === id);

describe('the ready templates', () => {
  it('are the nine an analyst starts from, blank first, then the five that show what a report holds', () => {
    expect(READY_NOTES.map((ready) => ready.name)).toEqual([
      'Blank', 'Geolocation report', 'Chronolocation', 'Media verification', 'Incident brief (5W)',
      'Source profile', 'Daily SITREP', 'Fact-check', 'Investigation log',
      'Front-line analysis', 'Equipment losses register', 'Strike and damage assessment', 'Claim against footage',
      'Story article for the web',
    ]);
    expect(READY_NOTES.slice(-5).map((ready) => ready.id)).toEqual(SHOWCASE);
    expect(named('blank').body).toBe('');
    expect(new Set(READY_NOTES.map((ready) => ready.id)).size).toBe(READY_NOTES.length);
  });

  for (const ready of READY_NOTES.filter((item) => item.id !== 'blank')) {
    describe(ready.name, () => {
      const rows = ready.body.split('\n');

      it('says what goes where, in guidance lines the PDF leaves out', () => {
        const hints = rows.filter((row) => row.startsWith('<!--?'));
        expect(hints.length).toBeGreaterThanOrEqual(2);
        for (const hint of hints) expect(HINT_LINE.test(hint), hint).toBe(true);
        // each on a paragraph of its own, so typing over one leaves a paragraph; a block's
        // own guidance (an empty story's) stands inside it, as `/` writes it
        let inside = false;
        rows.forEach((row, index) => {
          if (/^:::[ \t]*\w/.test(row)) inside = true;
          else if (/^:::[ \t]*$/.test(row)) inside = false;
          if (!HINT_LINE.test(row) || inside) return;
          expect(rows[index - 1] ?? '', row).toBe('');
          expect(rows[index + 1] ?? '', row).toBe('');
        });
      });

      it('has parts, and a callout to settle', () => {
        expect(rows.filter((row) => /^##+ /.test(row)).length).toBeGreaterThanOrEqual(1);
        if (ready.id !== 'log') expect(rows.some((row) => calloutOf(row))).toBe(true);
      });

      it('prints in a look of its own that a template may carry', () => {
        expect(ready.look).not.toBeNull();
        expect(templateLook(ready.look)).toEqual(normaliseLook(ready.look));
        expect(normaliseLook(ready.look).style).not.toBe('plain');
      });

      it('holds no case material, and reads in the app\'s plain register', () => {
        expect(ready.body).not.toMatch(/\[\[(entity|media|include):/);
        expect(findCoordinates(ready.body)).toEqual([]);
        expect(ready.body).not.toMatch(/—|–/);
        expect(ready.note).not.toMatch(/\.$/);
      });
    });
  }

  it('gives a report printed with a cover its own first page, the app\'s logo on a line that comes off, and a signature at the end', () => {
    const covered = READY_NOTES.filter((ready) => normaliseLook(ready.look).cover.on);
    expect(covered.map((ready) => ready.id)).toEqual(['geolocation', 'frontline']);
    for (const ready of covered) {
      expect(coverChoice(ready.look), ready.id).toBe('own');
      expect(ready.body.startsWith(`${COVER_SKELETON}\n\n`), ready.id).toBe(true);
      expect(ready.body.endsWith(`${SIGNATURE_BLOCK}\n`), ready.id).toBe(true);
      // retirable: the logo is one line, and the page and the signature stand without it
      const rows = ready.body.split('\n');
      expect(rows.filter((row) => row.includes('azimut:logo'))).toEqual(['![Azimut](azimut:logo){width=25% align=right}']);
      // the mark sits alone in the top right corner of page 1, which the title stands apart from
      expect(rows.slice(0, 3)).toEqual(['::: top-right', '![Azimut](azimut:logo){width=25% align=right}', ':::']);
      const without = rows.filter((row) => !row.includes('azimut:logo')).join('\n');
      expect(hasCover(without)).toBe(true);
      expect(without.split('\n').slice(0, coverLineIndex(without)).join('\n')).toContain('# {title}');
    }
    // one without a cover stays without one
    for (const ready of READY_NOTES.filter((item) => !normaliseLook(item.look).cover.on)) {
      expect(hasCover(ready.body), ready.id).toBe(false);
      expect(ready.body, ready.id).not.toContain('azimut:');
    }
  });

  describe('the five that show what a report holds', () => {
    const showcase = SHOWCASE.map(named);
    /** Every `::: chart` block of a body, its lines. */
    const charts = (body) => [...body.matchAll(/^::: chart\n([\s\S]*?)^:::$/gm)].map((match) => match[1].split('\n').filter(Boolean));

    it('set up their figures with no row: no number of their own, each opening on its form or the case', () => {
      for (const ready of showcase) {
        const blocks = charts(ready.body);
        expect(blocks.length, ready.id).toBeGreaterThanOrEqual(1);
        for (const lines of blocks) {
          expect(lines[0], ready.id).toMatch(/^kind: /);
          const table = lines.filter((line) => line.startsWith('|'));
          // a header and its rule, nothing under them
          expect(table, `${ready.id}: ${lines[0]}`).toHaveLength(2);
          expect(table[1]).toMatch(/^\|( ---:? \|)+$/);
        }
        expect(ready.body, ready.id).not.toMatch(/\b(step|ground|layer|view|frame|proofs):/);
      }
    });

    it('show each figure the Notebook draws, between them', () => {
      const all = showcase.map((ready) => ready.body).join('\n');
      const kinds = new Set(charts(all).map((lines) => lines[0].slice('kind: '.length)));
      for (const kind of ['key figures', 'timeline', 'stacked bars', 'pictures', 'pictograms', 'donut', 'segments']) {
        expect(kinds.has(kind), kind).toBe(true);
      }
      expect(all).toMatch(/^:::: infographic$/m);
      expect(all).toMatch(/^::: map$/m);
      expect(all).toMatch(/^::: story$/m);
      expect(all).toMatch(/^> \[!limits\] /m);
    });

    it('say how their tables show, in a settings line the grid reads', () => {
      let set = 0;
      for (const ready of showcase) {
        const rows = ready.body.split('\n');
        // the line right under a table's last row
        for (const line of rows.filter((row, index) => row.startsWith('{') && rows[index - 1]?.startsWith('|'))) {
          expect(readLook(line), `${ready.id}: ${line}`).not.toBeNull();
          set += 1;
        }
      }
      expect(set).toBeGreaterThanOrEqual(4);
      expect(named('frontline').body).toContain('{search=always fold=20 colour="Grade"}');
    });

    it('print as a report a reader can check, or as a story on the web', () => {
      const front = normaliseLook(named('frontline').look);
      expect(front.style).toBe('report');
      expect(front.web).toBe('story');
      expect(front.annexes).toEqual({ geolocations: 'on', method: 'on', limits: 'on' });
      expect(normaliseLook(named('story').look)).toMatchObject({ style: 'article', web: 'story' });
      expect(normaliseLook(named('claims').look).style).toBe('article');
      expect(normaliseLook(named('damage').look).style).toBe('brief');
      // the analyst's own words, never a "we"
      for (const ready of showcase) expect(ready.body, ready.id).not.toMatch(/\b(we|our|us)\b/i);
    });
  });

  it('leaves the words the PDF fills in as they are', () => {
    const body = filledBody('# {title}\n{date}\n**{name}**\\\n{role}, {organisation}\n{today}', new Date(2026, 10, 4, 9, 5));
    expect(body).toBe('# {title}\n{date}\n**{name}**\\\n{role}, {organisation}\n2026-11-04');
  });

  it('keeps the day and the time words working', () => {
    const now = new Date(2026, 10, 4, 9, 5);
    expect(filledBody(named('sitrep').body, now)).toMatch(/^## 2026-11-04\n/);
    expect(filledBody(named('log').body, now)).toMatch(/\n### 2026-11-04 09:05 \(UTC/);
  });

  it('dates the log entries the way the journal look reads them', () => {
    expect(named('log').look.style).toBe('journal');
    expect(named('log').body).toContain('### {now}');
  });
});

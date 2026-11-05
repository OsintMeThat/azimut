import { describe, expect, it } from 'vitest';
import { READY_NOTES, filledBody } from './ready.js';
import { HINT_LINE, coverChoice, normaliseLook, templateLook } from './look.js';
import { COVER_SKELETON, SIGNATURE_BLOCK, coverLineIndex, hasCover } from './reportParts.js';
import { calloutOf } from './callouts.js';
import { findCoordinates } from './syntax.js';

const named = (id) => READY_NOTES.find((ready) => ready.id === id);

describe('the ready templates', () => {
  it('are the nine an analyst starts from, blank first', () => {
    expect(READY_NOTES.map((ready) => ready.name)).toEqual([
      'Blank', 'Geolocation report', 'Chronolocation', 'Media verification', 'Incident brief (5W)',
      'Source profile', 'Daily SITREP', 'Fact-check', 'Investigation log',
    ]);
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
        // each on a paragraph of its own, so typing over one leaves a paragraph
        rows.forEach((row, index) => {
          if (!HINT_LINE.test(row)) return;
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
    expect(covered.map((ready) => ready.id)).toEqual(['geolocation']);
    for (const ready of covered) {
      expect(coverChoice(ready.look), ready.id).toBe('own');
      expect(ready.body.startsWith(`${COVER_SKELETON}\n\n`), ready.id).toBe(true);
      expect(ready.body.endsWith(`${SIGNATURE_BLOCK}\n`), ready.id).toBe(true);
      // retirable: the logo is one line, and the page and the signature stand without it
      const rows = ready.body.split('\n');
      expect(rows.filter((row) => row.includes('azimut:logo'))).toEqual(['![Azimut](azimut:logo){width=25% align=center}']);
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

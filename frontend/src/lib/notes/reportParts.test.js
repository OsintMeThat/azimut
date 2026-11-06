import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PICTURES, COVER_LINE, COVER_SKELETON, NO_IDENTITY, PLACEHOLDERS, SIGNATURE_BLOCK, builtInLine, builtInSrc,
  coverChange, coverLineIndex, findPlaceholders, hasCover, placeholderValue,
} from './reportParts.js';
import { HINT_LINE } from './look.js';
import { picturesIn } from './pictureSize.js';

const SET = { name: 'A. Analyst', role: '', organisation: 'Desk', logo: true, signature: false, rev: 2 };

describe('the first page of one\'s own', () => {
  it('ends on a line the PDF reads and never prints', () => {
    expect(COVER_LINE.test('<!-- cover -->')).toBe(true);
    expect(COVER_LINE.test('  <!--cover-->  ')).toBe(true);
    expect(COVER_LINE.test('<!-- Cover -->')).toBe(true);
    expect(COVER_LINE.test('<!--? cover -->')).toBe(false);
    expect(COVER_LINE.test('text <!-- cover -->')).toBe(false);
  });

  it('finds the line outside code only', () => {
    expect(coverLineIndex('# A\n<!-- cover -->\nB')).toBe(1);
    expect(coverLineIndex('```\n<!-- cover -->\n```\nB')).toBe(-1);
    expect(hasCover('```\n<!-- cover -->\n```\n<!-- cover -->')).toBe(true);
  });

  it('is written at the very top as the logo in a corner, the title, a guidance line and the day', () => {
    expect(COVER_SKELETON.split('\n')).toEqual([
      '::: top-right',
      '![Azimut](azimut:logo){width=25% align=right}',
      ':::',
      '',
      '::: center',
      '# {title}',
      '',
      '<!--? A line under the title: what this report is -->',
      '',
      '{date}',
      ':::',
      '<!-- cover -->',
    ]);
    expect(HINT_LINE.test(COVER_SKELETON.split('\n')[7])).toBe(true);
    const change = coverChange('\n\nFirst words');
    // over the blank lines the note starts with, the cursor on the guidance
    expect(change).toMatchObject({ from: 0, to: 2, insert: `${COVER_SKELETON}\n\n` });
    expect(change.insert.slice(change.cursor).startsWith('<!--? A line under the title')).toBe(true);
    expect(coverChange('').to).toBe(0);
    // a note with a cover keeps it
    expect(coverChange(`${COVER_SKELETON}\n\nBody`)).toBeNull();
  });
});

describe('the words the PDF fills in', () => {
  it('are five, each saying what fills it', () => {
    expect(PLACEHOLDERS.map((item) => item.id)).toEqual(['title', 'date', 'name', 'role', 'organisation']);
    for (const item of PLACEHOLDERS) expect(item.said, item.id).not.toMatch(/\.$|—/);
    expect(findPlaceholders('# {title} on {date}', 10)).toEqual([
      { from: 12, to: 19, id: 'title' }, { from: 23, to: 29, id: 'date' },
    ]);
    expect(findPlaceholders('{today} {nobody}')).toEqual([]);
  });

  it('show the analyst\'s own words where Settings has them, and nothing else', () => {
    expect(placeholderValue('name', SET)).toBe('A. Analyst');
    expect(placeholderValue('role', SET)).toBe('');
    expect(placeholderValue('title', SET)).toBe('');
    expect(placeholderValue('name')).toBe('');
  });

  it('sign a report on lines of their own, under the signature', () => {
    const rows = SIGNATURE_BLOCK.split('\n');
    expect(rows[0]).toBe('::: right');
    expect(rows.at(-1)).toBe(':::');
    expect(picturesIn(rows[1])[0]).toMatchObject({ ref: 'azimut:my-signature', width: '30%', align: 'right' });
    // a hard break ends each line, so the PDF does not run them into one
    expect(rows.slice(3, 6)).toEqual(['**{name}**\\', '{role}, {organisation}\\', '{date}']);
  });
});

describe('the three pictures of the app\'s', () => {
  it('are the Azimut logo, the analyst\'s logo and their signature', () => {
    expect(BUILT_IN_PICTURES.map((picture) => picture.label)).toEqual(['Azimut logo', 'Your logo', 'Your signature']);
    expect(builtInLine('my-logo')).toBe('![Logo](azimut:my-logo){width=25%}');
    expect(builtInLine('logo', 'center')).toBe('![Azimut](azimut:logo){width=25% align=center}');
    expect(builtInLine('nothing')).toBe('');
  });

  it('are drawn from this computer, the analyst\'s two only once set', () => {
    expect(builtInSrc('logo')).toBe('/api/notes/pictures/logo');
    expect(builtInSrc('my-logo')).toBe('');
    expect(builtInSrc('my-logo', SET)).toBe('/api/notes/pictures/my-logo?v=2');
    expect(builtInSrc('my-signature', SET)).toBe('');
    expect(builtInSrc('my-signature', { ...NO_IDENTITY, signature: true })).toBe('/api/notes/pictures/my-signature?v=0');
    for (const picture of BUILT_IN_PICTURES.filter((item) => item.setting)) {
      expect(picture.unset).toMatch(/^No (logo|signature) set in Settings › Publishing$/);
    }
  });
});

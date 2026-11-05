import { describe, expect, it } from 'vitest';
import {
  appended, citation, findCoordinates, uploadedImage, findReferences, logStamp, mentionMatches, pastedUrl, slashInsert,
  slashMatches, SLASH_COMMANDS, today,
} from './syntax.js';
import { READY_NOTES, filledBody, freeTitle } from './ready.js';
import { calloutOf, calloutMarkdown } from './callouts.js';

const NOW = new Date(2026, 10, 4, 9, 5);

describe('what a note says', () => {
  it('finds case references with where they sit', () => {
    expect(findReferences('a [[entity:p1|Quay]] b [[media:m1|clip]]{width=50%}', 10)).toEqual([
      { from: 12, to: 30, kind: 'entity', id: 'p1', label: 'Quay', attrs: '' },
      { from: 33, to: 61, kind: 'media', id: 'm1', label: 'clip', attrs: 'width=50%' },
    ]);
  });

  it('finds real coordinates and leaves numbers that are not places', () => {
    expect(findCoordinates('at 33.5138, 36.2765 then -12.0441,-77.0282')).toEqual([
      { from: 3, to: 19, lat: 33.5138, lon: 36.2765 },
      { from: 25, to: 42, lat: -12.0441, lon: -77.0282 },
    ]);
    expect(findCoordinates('v1.2, 3.4 and 95.0001, 10.0001 and 1.23456, 2.34567.8')).toEqual([]);
    expect(findCoordinates('The bridge, at 33.7497, -118.2716.')).toEqual([{ from: 15, to: 33, lat: 33.7497, lon: -118.2716 }]);
  });

  it('takes a pasted link only when it is a link alone', () => {
    expect(pastedUrl(' https://example.org/a?b=1 ')).toBe('https://example.org/a?b=1');
    expect(pastedUrl('see https://example.org')).toBeNull();
    expect(pastedUrl('javascript:alert(1)')).toBeNull();
  });

  it('shows an image just added by its media, or by its file when it has none', () => {
    expect(uploadedImage('case-1', { filename: 'frame.png', path: 'media/frame.png' }, { id: 'e_frame', label: 'frame.png' }))
      .toBe('[[media:e_frame|frame.png]]');
    expect(uploadedImage('case-1', { filename: 'frame.png', path: 'media/frame.png' }, null)).toMatch(/^!\[frame\.png\]\(.+frame\.png\)$/);
  });

  it('cites a picture by showing it and anything else by naming it', () => {
    expect(citation({ id: 'm1', type: 'media', label: 'clip.jpg', attrs: { path: 'media/clip.jpg', kind: 'image' } }))
      .toBe('[[media:m1|clip.jpg]]');
    expect(citation({ id: 'v1', type: 'media', label: 'clip.mp4', attrs: { path: 'media/clip.mp4', kind: 'video' } }))
      .toBe('[[entity:v1|clip.mp4]]');
    expect(citation({ id: 'p1', type: 'place', label: 'Quay [north]', attrs: {} })).toBe('[[entity:p1|Quay north]]');
  });

  it('shows a saved proof as its picture, and names one with no picture yet', () => {
    expect(citation({ id: 'pr1', type: 'proof', label: 'Port strike', attrs: { path: 'proofs/port-strike.png', spec: 'proofs/.meta/port-strike.json' } }))
      .toBe('[[media:pr1|Port strike]]');
    expect(citation({ id: 'pr2', type: 'proof', label: 'Draft', attrs: { spec: 'proofs/.meta/draft.json' } }))
      .toBe('[[entity:pr2|Draft]]');
  });
});

describe('what @ and / offer', () => {
  const entities = [
    { id: 'a', label: 'Harbour mast', type: 'place' },
    { id: 'b', label: 'Mast', type: 'place' },
    { id: 'c', label: 'Hodeïda', type: 'place' },
    { id: 'd', label: 'Guess', type: 'place', provenance: { status: 'suggested' } },
  ];

  it('offers names starting with the words first, folded, never a suggestion', () => {
    expect(mentionMatches(entities, 'mast').map((entity) => entity.id)).toEqual(['b', 'a']);
    expect(mentionMatches(entities, 'hodeida').map((entity) => entity.id)).toEqual(['c']);
    expect(mentionMatches(entities, '').map((entity) => entity.id)).toEqual(['a', 'c', 'b']);
  });

  it('ranks the commands by their name, then by the words they go by', () => {
    expect(slashMatches('').map((command) => command.id)).toEqual(
      SLASH_COMMANDS.filter((command) => command.id !== 'hint').map((command) => command.id));
    expect(slashMatches('ta')[0].id).toBe('table');
    expect(slashMatches('todo')[0].id).toBe('task');
    expect(slashMatches('journal')[0].id).toBe('entry');
    expect(slashMatches('zzz')).toEqual([]);
  });

  it('offers a chapter in a note, and guidance in a template', () => {
    expect(slashMatches('include')[0].id).toBe('include');
    expect(slashMatches('chapter')[0].id).toBe('include');
    expect(slashMatches('guid').map((command) => command.id)).not.toContain('hint');
    expect(slashMatches('guid', { template: true })[0].id).toBe('hint');
    expect(slashMatches('', { template: true }).map((command) => command.id)).not.toContain('include');
  });

  it('writes a line command at the start of its line, a block on lines of its own', () => {
    const command = (id) => SLASH_COMMANDS.find((item) => item.id === id);
    expect(slashInsert(command('h2'))).toEqual({ text: '## ', cursor: 3 });
    expect(slashInsert(command('divider'), { before: 'text ' })).toEqual({ text: '\n\n---\n', cursor: 6 });
    expect(slashInsert(command('entry'), { now: NOW }).text).toMatch(/^### 2026-11-04 09:05 \(UTC[+-]?[\d:]*\)\n$/);
    const code = slashInsert(command('code'));
    expect(code.text.slice(0, code.cursor)).toBe('```\n');
    const table = slashInsert(command('table'));
    expect(table.text.slice(table.cursor)).toBe(' |  |\n');
    expect(slashInsert(command('cite'))).toBeNull();
    expect(slashInsert(command('include'))).toBeNull();
    const hint = slashInsert(command('hint'));
    expect(hint.text).toBe('<!--?  -->\n');
    expect(hint.text.slice(0, hint.cursor)).toBe('<!--? ');
    expect(slashInsert(command('hint'), { before: 'text ' }).text).toBe('\n\n<!--?  -->\n');
  });

  it('dates a log entry on the analyst’s own clock', () => {
    expect(logStamp(NOW)).toMatch(/^2026-11-04 09:05 \(UTC/);
    expect(today(NOW)).toBe('2026-11-04');
  });
});

describe('notes made from others', () => {
  it('adds a block at the end with a blank line between', () => {
    expect(appended('', 'x')).toBe('x\n');
    expect(appended('First\n\n\n', 'x')).toBe('First\n\nx\n');
    expect(appended('First', '  ')).toBe('First');
  });

  it('fills in the day and the time a template names', () => {
    expect(filledBody('## {today}\n### {now}', NOW)).toMatch(/^## 2026-11-04\n### 2026-11-04 09:05 \(UTC/);
    expect(filledBody(READY_NOTES.find((ready) => ready.id === 'log').body, NOW)).toMatch(/### 2026-11-04 09:05 \(UTC/);
  });

  it('numbers a name already taken', () => {
    expect(freeTitle('Geolocation', ['Other'])).toBe('Geolocation');
    expect(freeTitle('Geolocation', ['geolocation', 'Geolocation 2'])).toBe('Geolocation 3');
  });

  it('reads and writes the six callouts, and no other', () => {
    expect(calloutOf('> [!Confirmed] yes')?.kind).toBe('confirmed');
    expect(calloutOf('> [!INTERNAL] who told us')?.kind).toBe('internal');
    expect(calloutOf('> [!odd] no')).toBeNull();
    expect(calloutOf('plain')).toBeNull();
    expect(calloutMarkdown('lead', 'Ask')).toBe('> [!lead] Ask');
    expect(calloutMarkdown('internal')).toBe('> [!internal] ');
  });
});

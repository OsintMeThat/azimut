import { describe, expect, it } from 'vitest';
import {
  aliasesOf,
  guessSubjectType,
  insertMention,
  mentionAt,
  mostUsedType,
  namesExactly,
  rankMentions,
  typeMenu,
} from './entryLine.js';

describe('aliasesOf', () => {
  it('splits other names on a semicolon, a comma or a line', () => {
    expect(aliasesOf({ attrs: { aliases: 'Perekhrestia; X-roads,Crossroads N.\nПерехрестя ' } }))
      .toEqual(['Perekhrestia', 'X-roads', 'Crossroads N.', 'Перехрестя']);
    expect(aliasesOf({ attrs: {} })).toEqual([]);
    expect(aliasesOf(null)).toEqual([]);
  });
});

describe('namesExactly', () => {
  const place = { label: 'Kyïv', attrs: { aliases: 'Kiev; Київ' } };

  it('matches the name or one other name whole, accents and case aside', () => {
    expect(namesExactly(place, 'kyiv')).toBe(true);
    expect(namesExactly(place, 'KIEV')).toBe(true);
    expect(namesExactly(place, 'київ')).toBe(true);
    expect(namesExactly(place, 'Ki')).toBe(false);
    expect(namesExactly(place, '')).toBe(false);
  });
});

describe('rankMentions', () => {
  const rows = [
    { id: 'a', type: 'place', label: 'Kyiv oblast' },
    { id: 'b', type: 'person', label: 'Ivan' },
    { id: 'c', type: 'place', label: 'Capital', attrs: { aliases: 'Kyiv' } },
    { id: 'd', type: 'place', label: 'Kyiv' },
  ];

  it('puts exact names first, then what the draft mentions, then the rest', () => {
    const ranked = rankMentions(rows, 'kyiv', new Set(['b']));
    expect(ranked.map((row) => row.entity.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('says why a row matched when it was not by its name', () => {
    const ranked = rankMentions(rows, 'kyiv');
    expect(ranked.find((row) => row.entity.id === 'c').reason).toEqual({ label: 'Also known as', value: 'Kyiv' });
    expect(ranked.find((row) => row.entity.id === 'd').reason).toBeNull();
    expect(ranked.find((row) => row.entity.id === 'a').reason).toBeNull();
  });
});

describe('mentionAt', () => {
  it('finds the @term being typed at the caret', () => {
    expect(mentionAt('Seen at @Cross', 14)).toEqual({ start: 8, end: 14, term: 'Cross' });
    expect(mentionAt('@4th brig', 9)).toEqual({ start: 0, end: 9, term: '4th brig' });
    expect(mentionAt('Mail from @ops@example.org', 26)).toEqual({ start: 10, end: 26, term: 'ops@example.org' });
  });

  it('leaves an address, a finished line and a closed mention alone', () => {
    expect(mentionAt('ops@example.org', 15)).toBeNull();
    expect(mentionAt('no mention here', 15)).toBeNull();
    expect(mentionAt('@a\nb', 4)).toBeNull();
    expect(mentionAt('@name  and more', 15)).toBeNull();
  });
});

describe('insertMention', () => {
  it('puts the name where the term was, with one space after it', () => {
    expect(insertMention('Seen at @Cro', { start: 8, end: 12 }, 'Crossroads')).toEqual({ text: 'Seen at Crossroads ', caret: 19 });
    expect(insertMention('At @Cro today', { start: 3, end: 7 }, 'Crossroads')).toEqual({ text: 'At Crossroads today', caret: 13 });
  });
});

describe('guessSubjectType', () => {
  it.each([
    ['ops@example.org', 'email', 'looks like an email'],
    ['203.0.113.42', 'ip', 'looks like an IP address'],
    ['2001:db8::1', 'ip', 'looks like an IP address'],
    ['203.0.113.0/24', 'network', 'looks like a network'],
    ['example.org', 'domain', 'looks like a domain'],
    ['+380 44 123 4567', 'phone', 'looks like a phone number'],
    ['@spotter_ua', 'account', 'looks like a handle'],
    ['https://t.me/spotter_ua', 'account', 'looks like a profile address'],
  ])('reads %s as a %s', (value, type, rule) => {
    expect(guessSubjectType(value, { mostUsed: 'organization' })).toEqual({ type, rule });
  });

  it('takes the type the case uses most for a name, and a person with nothing to go on', () => {
    expect(guessSubjectType('4th brigade', { mostUsed: 'organization' }))
      .toEqual({ type: 'organization', rule: 'the type this case uses most' });
    expect(guessSubjectType('Ivan Petrenko')).toEqual({ type: 'person', rule: 'no other hint' });
    // A version number or a year is not a domain or a phone.
    expect(guessSubjectType('T-72B3').type).toBe('person');
    expect(guessSubjectType('2026').type).toBe('person');
    expect(guessSubjectType('v1.2').type).toBe('person');
  });
});

describe('mostUsedType and typeMenu', () => {
  const creatable = ['person', 'organization', 'vehicle', 'account', 'email', 'claim'].map((type) => ({ type }));

  it('picks the subject type the case holds most of, never a claim', () => {
    expect(mostUsedType({ by_type: { claim: 40, vehicle: 6, person: 6 } }, creatable)).toBe('person');
    expect(mostUsedType({ by_type: { claim: 40, vehicle: 7 } }, creatable)).toBe('vehicle');
    expect(mostUsedType(null, creatable)).toBe('');
  });

  it('offers the quick types, the case favourite, then the rest, and never a place', () => {
    expect(typeMenu(creatable, 'vehicle')).toEqual({
      quick: ['person', 'organization', 'account', 'vehicle'],
      other: ['email'],
    });
    expect(typeMenu(creatable, 'person').quick).toEqual(['person', 'organization', 'account']);
  });
});

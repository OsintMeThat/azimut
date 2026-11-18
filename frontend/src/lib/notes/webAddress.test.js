import { describe, expect, it } from 'vitest';
import { MAX_ADDRESS, addressProblem, keepAddress, readAddress } from './webAddress.js';

function memory({ broken = false } = {}) {
  const kept = new Map();
  return {
    kept,
    getItem: (key) => { if (broken) throw new Error('denied'); return kept.get(key) ?? null; },
    setItem: (key, value) => { if (broken) throw new Error('denied'); kept.set(key, value); },
  };
}

describe('the address a web folder will live at', () => {
  it('is kept note by note, and forgotten when the field is emptied', () => {
    const storage = memory();
    expect(readAddress('c1', 'n1', storage)).toBe('');
    keepAddress('c1', 'n1', ' https://desk.github.io/articles/harbour/ ', storage);
    keepAddress('c1', null, 'https://desk.github.io/articles/log/', storage);
    expect(readAddress('c1', 'n1', storage)).toBe('https://desk.github.io/articles/harbour/');
    expect(readAddress('c1', 'case', storage)).toBe('https://desk.github.io/articles/log/');
    expect(readAddress('c2', 'n1', storage)).toBe('');
    keepAddress('c1', 'n1', '   ', storage);
    expect(readAddress('c1', 'n1', storage)).toBe('');
    expect(() => keepAddress('c1', 'n1', 'x', memory({ broken: true }))).not.toThrow();
    expect(readAddress('c1', 'n1', memory({ broken: true }))).toBe('');
  });

  it('says what is wrong in the server\'s words, and lets an empty field or a plain https address through', () => {
    expect(addressProblem('')).toBe('');
    expect(addressProblem('https://desk.github.io/articles/harbour/')).toBe('');
    expect(addressProblem('https://desk.github.io/articles/harbour')).toBe('');
    expect(addressProblem('http://desk.github.io/a/')).toBe('The address must start with https://.');
    expect(addressProblem('desk.github.io/a/')).toBe('That is not an address.');
    expect(addressProblem('https://me:secret@desk.github.io/a/')).toBe('The address must not hold a name or a password.');
    expect(addressProblem('https://localhost/a/')).toBe('The address needs a site name, such as your-name.github.io.');
    expect(addressProblem('https://desk.github.io/a/?x=1')).toBe('The address must not hold ? or #.');
    expect(addressProblem('https://desk.github.io/a b/')).toBe('The address holds a character an address cannot.');
    expect(addressProblem('https://desk.github.io/"><script>/')).toBe('The address holds a character an address cannot.');
    expect(addressProblem(`https://desk.github.io/${'a'.repeat(MAX_ADDRESS)}/`)).toBe(`The address is longer than ${MAX_ADDRESS} characters.`);
  });
});

import { describe, expect, it } from 'vitest';

import { SLASH_COMMANDS } from '../syntax.js';
import { SLASH_WRITERS, slashWriter } from './slashMenu.js';

/** Every entry of the `/` menu writes through one of its named writers. */
describe('the writers of the / menu', () => {
  it('has a writer for every entry the menu lists', () => {
    for (const command of SLASH_COMMANDS) expect(typeof SLASH_WRITERS[slashWriter(command)], command.id).toBe('function');
  });

  it('picks the writer by the field an entry carries', () => {
    const writer = (id) => slashWriter(SLASH_COMMANDS.find((command) => command.id === id));
    expect(writer('cite')).toBe('cite');
    expect(writer('picture')).toBe('action');
    expect(writer('align')).toBe('menu');
    expect(writer('align-center')).toBe('wrap');
    expect(writer('h2')).toBe('line');
    expect(['table', 'entry', 'date', 'hint', 'steps'].map(writer)).toEqual(['insert', 'insert', 'insert', 'insert', 'insert']);
  });
});

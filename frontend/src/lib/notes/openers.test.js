import { afterEach, describe, expect, it, vi } from 'vitest';
import { openerFor, registerOpener, resetOpeners } from './openers.js';

/** A picture in a note goes back to the tool state it was made in, when a tool says it can. */

afterEach(() => resetOpeners());

const capture = { id: 'cap1', type: 'capture', label: 'Roof', attrs: { path: 'media/roof.png', zoom: 17 } };

describe('the way back from a picture', () => {
  it('is the first tool that accepts it, named after the tool', () => {
    const open = vi.fn();
    registerOpener('compare', { accepts: (entity) => entity.attrs?.pair, open: vi.fn() });
    registerOpener('satellite', { accepts: (entity) => entity.type === 'capture', open, label: 'Open in Map' });
    const found = openerFor(capture);
    expect(found).toMatchObject({ tool: 'satellite', label: 'Open in Map' });
    found.open();
    expect(open).toHaveBeenCalledWith(capture);
  });

  it('is named by the tool when it says nothing else', () => {
    registerOpener('proof', { accepts: (entity) => entity.type === 'proof', open: () => {} });
    expect(openerFor({ id: 'p1', type: 'proof' }).label).toBe('Open in Geo Proof');
  });

  it('is none when no tool accepts it, or one fails asking', () => {
    registerOpener('inspect', { accepts: () => { throw new Error('bad'); }, open: () => {} });
    expect(openerFor(capture)).toBeNull();
    expect(openerFor(null)).toBeNull();
  });

  it('goes when its tool takes it back', () => {
    const undo = registerOpener('satellite', { accepts: () => true, open: () => {} });
    undo();
    expect(openerFor(capture)).toBeNull();
    expect(registerOpener('x', { accepts: true })).toBeTypeOf('function');
  });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readBlocks, readLinks, fillText, layerCard } from './layerCard.js';

describe('readBlocks', () => {
  it('reads a labelled line as its label and its value', () => {
    expect(readBlocks('code: UA\nlayer: OLD26')).toEqual([
      { label: 'code', value: 'UA' },
      { label: 'layer', value: 'OLD26' },
    ]);
  });

  it('keeps prose and columns in the order they were written', () => {
    expect(readBlocks('Seen at dawn\nName: North gate\nnothing since')).toEqual([
      { text: 'Seen at dawn' },
      { label: 'Name', value: 'North gate' },
      { text: 'nothing since' },
    ]);
  });

  it('leaves a sentence with a colon in it alone', () => {
    // no space after the colon, so an address and a time stay one piece of prose
    expect(readBlocks('at 10:30 see https://x.com/a/1')).toEqual([
      { text: 'at 10:30 see https://x.com/a/1' },
    ]);
  });

  it('leaves a long lead-in as prose rather than calling it a label', () => {
    const line = `${'word '.repeat(12)}: value`;
    expect(readBlocks(line)).toEqual([{ text: line }]);
  });

  it('is empty for a feature the source said nothing about', () => {
    expect(readBlocks('')).toEqual([]);
    expect(readBlocks(undefined)).toEqual([]);
  });
});

describe('readLinks', () => {
  it('splits an address out of the words around it', () => {
    expect(readLinks('see https://x.com/a/1 now')).toEqual([
      { text: 'see ' },
      { text: 'https://x.com/a/1', href: 'https://x.com/a/1' },
      { text: ' now' },
    ]);
  });

  it('leaves the punctuation that ended the sentence out of the address', () => {
    expect(readLinks('(https://x.com/a/1).')).toEqual([
      { text: '(' },
      { text: 'https://x.com/a/1', href: 'https://x.com/a/1' },
      { text: ').' },
    ]);
  });

  it('links nothing in a string with no address', () => {
    expect(readLinks('north gate')).toEqual([{ text: 'north gate' }]);
  });
});

describe('fillText', () => {
  it('writes an address as a link that opens away from the app', () => {
    const element = fillText(document.createElement('p'), 'see https://x.com/a/1');
    const link = element.querySelector('a');
    expect(link.href).toBe('https://x.com/a/1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer noopener');
  });

  it('never lets the source write markup into the page', () => {
    const element = fillText(document.createElement('p'), '<img src=x onerror=boom>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toBe('<img src=x onerror=boom>');
  });
});

describe('layerCard', () => {
  const card = layerCard('Ukraine Control Map v2');

  it('states the name, the group and whose map it came from', () => {
    const element = card({ name: 'Ua Position', category: 'Archives Geos' });
    expect(element.querySelector('h4').textContent).toBe('Ua Position');
    expect(element.querySelector('.layer-card-group').textContent).toBe('Archives Geos');
    expect(element.querySelector('.layer-card-from').textContent).toBe('Ukraine Control Map v2');
  });

  it('names a feature the source left unnamed', () => {
    expect(card({}).querySelector('h4').textContent).toBe('Unnamed feature');
  });

  it('draws the columns the source wrote as rows, and their addresses as links', () => {
    const element = card({
      name: 'Ua Position',
      description: 'Description: shelling https://x.com/a/1\ncode: UA',
    });
    const labels = [...element.querySelectorAll('.layer-card-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Description', 'code']);
    const values = [...element.querySelectorAll('.layer-card-value')].map((n) => n.textContent);
    expect(values).toEqual(['shelling https://x.com/a/1', 'UA']);
    expect(element.querySelector('.layer-card-value a').href).toBe('https://x.com/a/1');
  });

  it('carries no body at all when the source described nothing', () => {
    expect(card({ name: 'Ua Position' }).querySelector('.layer-card-body')).toBeNull();
  });

  it('offers no way out of itself: a card is read, never acted on', () => {
    const element = card({ name: 'Ua Position', description: 'code: UA' });
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('input')).toBeNull();
  });
});

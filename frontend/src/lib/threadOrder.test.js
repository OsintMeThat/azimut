import { describe, expect, it } from 'vitest';
import {
  blockName, blockWords, DEFAULT_ORDER, hasRecap, isAllInOne, moveBlock, ORDER_PRESETS, orderBlocks, orderKey, orderWords,
  ORDERS, presetOf, threadOrder, withBlock, withoutBlock,
} from './threadOrder.js';

/**
 * A video thread's order as a list of its posts, top to bottom: the four ready ones,
 * the analyst's own, and the one rule both the editor and the server keep.
 */

describe('an order', () => {
  it('is a list of posts, the four ready ones among them, Recap first the default', () => {
    expect(ORDERS).toEqual(['recap', 'video', 'proof', 'all']);
    expect(DEFAULT_ORDER).toBe('recap');
    expect(ORDER_PRESETS.recap).toEqual(['recap', 'video', 'places']);
    expect(ORDER_PRESETS.proof).toEqual(['first', 'video', 'places']);
    expect(threadOrder(undefined)).toEqual(['recap', 'video', 'places']);
  });

  it('reads a ready order by the name the first 0.3.4 builds stored', () => {
    for (const name of ORDERS) expect(orderBlocks(name)).toEqual([...ORDER_PRESETS[name]]);
    expect(threadOrder('proof')).toEqual(['first', 'video', 'places']);
    expect(threadOrder('sideways')).toEqual(['recap', 'video', 'places']);
  });

  it('holds the video and the places once each, the recap and the first place at most once, or all in one alone', () => {
    expect(orderBlocks(['recap', 'places', 'video'])).toEqual(['recap', 'places', 'video']);
    expect(orderBlocks(['places', 'first', 'video'])).toEqual(['places', 'first', 'video']);
    expect(orderBlocks(['all'])).toEqual(['all']);
    for (const bad of [[], ['recap', 'places'], ['video', 'recap'], ['video', 'places', 'video'], ['all', 'video', 'places'],
      ['video', 'places', 'sheet'], 'random', null, { recap: 1 }]) {
      expect(orderBlocks(bad)).toBeNull();
    }
  });

  it('gives a fresh list, never the ready one itself', () => {
    const list = orderBlocks('recap');
    list.push('first');
    expect(ORDER_PRESETS.recap).toEqual(['recap', 'video', 'places']);
  });

  it('is told apart from the four, and said in a line', () => {
    expect(presetOf(['video', 'places'])).toBe('video');
    expect(presetOf('all')).toBe('all');
    expect(presetOf(['recap', 'places', 'video'])).toBeNull();
    expect(orderKey(['recap', 'places', 'video'])).toBe('recap places video');
    expect(orderKey('proof')).toBe(orderKey(['first', 'video', 'places']));
    expect(orderWords('video')).toBe('The video, then a post per place');
    expect(orderWords(['recap', 'places', 'video'])).toBe('The recap, then a post per place, then the video');
    expect(orderWords(['recap', 'first', 'video', 'places'])).toBe('The recap, then the first place, then the video, then the other places');
    expect([hasRecap(['places', 'recap', 'video']), hasRecap('video'), isAllInOne(['all']), isAllInOne('recap')])
      .toEqual([true, false, true, false]);
  });
});

describe('the editor\'s moves', () => {
  it('move a post anywhere, and leave the list alone for a move out of it', () => {
    expect(moveBlock(['recap', 'video', 'places'], 1, 2)).toEqual(['recap', 'places', 'video']);
    expect(moveBlock(['recap', 'video', 'places'], 2, 0)).toEqual(['places', 'recap', 'video']);
    expect(moveBlock(['recap', 'video', 'places'], 0, -1)).toEqual(['recap', 'video', 'places']);
    expect(moveBlock(['recap', 'video', 'places'], 2, 3)).toEqual(['recap', 'video', 'places']);
  });

  it('leave out and put back the recap and the first place only, at the top', () => {
    expect(withoutBlock(['recap', 'video', 'places'], 'recap')).toEqual(['video', 'places']);
    expect(withoutBlock(['recap', 'video', 'places'], 'video')).toEqual(['recap', 'video', 'places']);
    expect(withBlock(['video', 'places'], 'recap')).toEqual(['recap', 'video', 'places']);
    expect(withBlock(['video', 'places'], 'first')).toEqual(['first', 'video', 'places']);
    expect(withBlock(['recap', 'video', 'places'], 'recap')).toEqual(['recap', 'video', 'places']);
    expect(withBlock(['all'], 'recap')).toEqual(['all']);
    expect(withBlock(['video', 'places'], 'places')).toEqual(['video', 'places']);
  });

  it('name each post, the places after whether the first one has its own', () => {
    expect(['recap', 'video', 'places'].map((block) => blockName(block, ['recap', 'video', 'places'])))
      .toEqual(['Recap', 'Video', 'Each place']);
    expect(blockName('places', ['first', 'video', 'places'])).toBe('Other places');
    expect(blockName('first', ['first', 'video', 'places'])).toBe('First place');
    expect(blockWords('places', ['first', 'video', 'places'])).toBe('A post for each of the others');
  });
});

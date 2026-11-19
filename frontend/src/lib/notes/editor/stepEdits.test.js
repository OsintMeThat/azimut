import { describe, expect, it } from 'vitest';

import {
  addSteps, blockSteps, moveStep, removeStep, setStepPicture, setStepWords, stepChange,
} from './stepEdits.js';

/**
 * What the step strip writes: each gesture is the block's own lines, as an expert
 * would type them, and nothing else of the note moves.
 */

const ROOF = { id: 'm1', label: 'Roof' };
const YARD = { id: 'm2', label: 'Yard' };
const GATE = { id: 'm3', label: 'Gate' };

const STORY = [
  '::: story',
  'What the strike left.',
  '[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}',
  'The **roof** first.',
  '',
  'Then the yard.',
  '',
  '[[media:m2|Yard]]',
  'The yard.',
  ':::',
].join('\n');

const STEPS = '::: steps\n[[media:m1|Roof]]{caption="2 Mar"}\n[[media:m2|Yard]]{caption="3 Mar"}\n:::';

describe('the steps of a block', () => {
  it('are read off its lines: a picture opens each, the words after it are its own', () => {
    const { steps, lead } = blockSteps(STORY);
    expect(lead).toEqual([1, 1]);
    expect(steps.map(({ at, end, last, ref, words, zoom }) => ({ at, end, last, ref, words, zoom }))).toEqual([
      { at: 2, end: 5, last: 6, ref: 'media:m1', words: 'The **roof** first.\n\nThen the yard.', zoom: { x: 0.25, y: 0.1, w: 0.5, h: 0.4 } },
      { at: 7, end: 8, last: 8, ref: 'media:m2', words: 'The yard.', zoom: null },
    ]);
    expect(blockSteps(STEPS).steps.map((step) => step.caption)).toEqual(['2 Mar', '3 Mar']);
    expect(blockSteps('::: story\n:::').steps).toEqual([]);
  });
});

describe('a step added', () => {
  it('takes the place of the guidance an empty block opens with, in a note', () => {
    const empty = '::: story\n<!--? A picture, then the words read beside it -->\n:::';
    expect(addSteps(empty, [ROOF, YARD])).toBe('::: story\n[[media:m1|Roof]]\n[[media:m2|Yard]]\n:::');
    // a template's guidance is its own text, kept
    expect(addSteps(empty, [ROOF], Infinity, { template: true }))
      .toBe('::: story\n<!--? A picture, then the words read beside it -->\n[[media:m1|Roof]]\n:::');
    expect(addSteps('::: steps\n:::', [ROOF])).toBe('::: steps\n[[media:m1|Roof]]\n:::');
  });

  it('goes last, a blank line after a step with words, none after a picture alone', () => {
    expect(addSteps(STORY, [GATE])).toBe(STORY.replace('The yard.\n:::', 'The yard.\n\n[[media:m3|Gate]]\n:::'));
    expect(addSteps(STEPS, [GATE])).toBe(STEPS.replace('\n:::', '\n[[media:m3|Gate]]\n:::'));
  });

  it('goes before the step it is dropped on', () => {
    expect(addSteps(STEPS, [GATE], 1)).toBe('::: steps\n[[media:m1|Roof]]{caption="2 Mar"}\n[[media:m3|Gate]]\n[[media:m2|Yard]]{caption="3 Mar"}\n:::');
    expect(addSteps(STEPS, [GATE], 0)).toBe('::: steps\n[[media:m3|Gate]]\n[[media:m1|Roof]]{caption="2 Mar"}\n[[media:m2|Yard]]{caption="3 Mar"}\n:::');
    // before a step that follows words, the words keep their blank line
    expect(addSteps(STORY, [GATE], 1)).toBe(STORY.replace('\n[[media:m2|Yard]]', '\n[[media:m3|Gate]]\n[[media:m2|Yard]]'));
    expect(addSteps(STEPS, [])).toBeNull();
  });
});

describe('a step moved', () => {
  it('takes its picture and its words with it, a blank line after the words', () => {
    expect(moveStep(STORY, 1, 0)).toBe([
      '::: story',
      'What the strike left.',
      '[[media:m2|Yard]]',
      'The yard.',
      '',
      '[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}',
      'The **roof** first.',
      '',
      'Then the yard.',
      ':::',
    ].join('\n'));
    expect(moveStep(moveStep(STORY, 1, 0), 0, 1)).toBe(STORY);
    expect(moveStep(STEPS, 0, 1)).toBe('::: steps\n[[media:m2|Yard]]{caption="3 Mar"}\n[[media:m1|Roof]]{caption="2 Mar"}\n:::');
  });

  it('stays where it is past either end', () => {
    expect(moveStep(STEPS, 0, -1)).toBeNull();
    expect(moveStep(STEPS, 1, 2)).toBeNull();
    expect(moveStep(STEPS, 1, 1)).toBeNull();
  });
});

describe('a step removed', () => {
  it('takes its picture, its words and the blank line that set it apart', () => {
    expect(removeStep(STORY, 0)).toBe('::: story\nWhat the strike left.\n[[media:m2|Yard]]\nThe yard.\n:::');
    expect(removeStep(STORY, 1)).toBe('::: story\nWhat the strike left.\n[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}\nThe **roof** first.\n\nThen the yard.\n:::');
    expect(removeStep(removeStep(STEPS, 0), 0)).toBe('::: steps\n:::');
    expect(removeStep(STEPS, 5)).toBeNull();
  });
});

describe('a step\'s words and picture', () => {
  it('are written in place of what it said, and taken out when emptied', () => {
    expect(setStepWords(STORY, 1, 'The yard, from the gate.')).toBe(STORY.replace('The yard.\n:::', 'The yard, from the gate.\n:::'));
    expect(setStepWords(STORY, 0, 'Roof only.')).toBe(STORY.replace('The **roof** first.\n\nThen the yard.', 'Roof only.'));
    expect(setStepWords(STORY, 1, '  ')).toBe(STORY.replace('\nThe yard.\n:::', '\n:::'));
    expect(setStepWords(STORY, 1, 'The yard.')).toBeNull();
  });

  it('stand apart from the next step when a step had none', () => {
    expect(setStepWords(STEPS, 0, 'The roof\nburnt.')).toBe('::: steps\n[[media:m1|Roof]]{caption="2 Mar"}\nThe roof\nburnt.\n\n[[media:m2|Yard]]{caption="3 Mar"}\n:::');
  });

  it('give a step its caption and a story\'s step its zoom, on its picture\'s line', () => {
    expect(setStepPicture(STEPS, 1, { caption: '4 Mar' })).toBe(STEPS.replace('3 Mar', '4 Mar'));
    expect(setStepPicture(STORY, 1, { zoom: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } }))
      .toBe(STORY.replace('[[media:m2|Yard]]', '[[media:m2|Yard]]{zoom=0.5,0.5,0.25,0.25}'));
    expect(setStepPicture(STORY, 0, { zoom: null })).toBe(STORY.replace('{zoom=0.25,0.1,0.5,0.4}', ''));
    expect(setStepPicture(STEPS, 0, { caption: '2 Mar' })).toBeNull();
  });
});

describe('the change a gesture dispatches', () => {
  it('is only the stretch that differs, at the block\'s place in the note', () => {
    const after = setStepPicture(STEPS, 1, { caption: '4 Mar' });
    const change = stepChange(100, STEPS, after);
    expect(change).toEqual({ from: 100 + STEPS.indexOf('3 Mar'), to: 100 + STEPS.indexOf('3 Mar') + 1, insert: '4' });
    expect(stepChange(100, STEPS, STEPS)).toBeNull();
    expect(stepChange(100, STEPS, null)).toBeNull();
  });
});

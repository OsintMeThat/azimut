// @vitest-environment happy-dom
/**
 * The post-template editor, actually mounted.
 *
 * What it promises is only visible in a DOM: a preview that follows the layout as
 * it is typed, a count that turns red at a platform's limit, a warning that mends
 * itself in one click, and starting layouts that appear for a new template only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PostTemplateEditor from './PostTemplateEditor.svelte';
import { postDraftState } from '../lib/state.svelte.js';
import { DEFAULT_TWEET_BODY, POST_TEMPLATE_STARTERS, TWEET_TOKENS } from '../lib/post.js';

const sample = (tag) => TWEET_TOKENS.find((t) => t.tag === tag).sample;

let target;
let app;

function open({ fresh = false, ...blob } = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const data = $state({
    mention: '@GeoConfirmed',
    body: DEFAULT_TWEET_BODY,
    mediaEnabled: true,
    extraTweets: [],
    ...blob,
  });
  app = mount(PostTemplateEditor, {
    target,
    props: {
      get data() {
        return data;
      },
      fresh,
    },
  });
  flushSync();
  return data;
}

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  postDraftState.fields = null;
});

const preview = () => target.querySelector('.pe-preview pre').textContent;
const counters = () => [...target.querySelectorAll('.counter')];
const optionButton = (label) =>
  [...target.querySelectorAll('.pv-opt')].find((b) => b.textContent.trim() === label);
const warnings = () => [...target.querySelectorAll('.misspelled')];
const click = (el) => {
  el.click();
  flushSync();
};

describe('the preview', () => {
  it('opens on the sample facts, with the template own mention', () => {
    open({ body: '#place\n#mention', mention: '@House' });
    expect(preview()).toBe(`${sample('#place')}\n@House`);
  });

  it('shows the date line the sample carries', () => {
    open({ body: 'Filmed: #date' });
    expect(preview()).toBe(`Filmed: ${sample('#date')}`);
  });

  it('drops the mention line when the template has none, as a post would', () => {
    open({ body: '#place\n#mention', mention: '' });
    expect(preview()).toBe(sample('#place'));
  });

  it('follows the layout as it is typed', () => {
    const data = open({ body: '#place' });
    data.body = '#mention\n#place';
    flushSync();
    expect(preview()).toBe(`@GeoConfirmed\n${sample('#place')}`);
  });

  it('says so when the layout would print nothing', () => {
    open({ body: '#description', mention: '' });
    postDraftState.fields = { description: '' };
    flushSync();
    click(optionButton('Open post'));
    expect(preview()).toBe('(empty post)');
  });
});

describe('the open post', () => {
  const draft = {
    place: 'Kyiv', plusCode: '', description: '', lat: 50.45, lon: 30.52,
    coordsText: '', mention: '@FromTheDraft', source: '', date: '',
  };

  it('is not offered while the composer holds nothing, and says why', () => {
    open();
    const button = optionButton('Open post');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No post is open in the composer');
    expect(optionButton('Sample').getAttribute('aria-pressed')).toBe('true');
  });

  it('fills the layout with the draft, under the template own mention', () => {
    open({ body: '#place\n#mention', mention: '@House' });
    postDraftState.fields = draft;
    flushSync();

    expect(optionButton('Open post').disabled).toBe(false);
    expect(preview()).toBe(`${sample('#place')}\n@House`); // still the sample until asked

    click(optionButton('Open post'));
    expect(preview()).toBe('Kyiv\n@House');
    expect(optionButton('Open post').getAttribute('aria-pressed')).toBe('true');

    click(optionButton('Sample'));
    expect(preview()).toBe(`${sample('#place')}\n@House`);
  });

  it('follows the draft while it is edited, and lets go when the composer is emptied', () => {
    open({ body: '#place' });
    postDraftState.fields = draft;
    flushSync();
    click(optionButton('Open post'));

    postDraftState.fields = { ...draft, place: 'Bucha' };
    flushSync();
    expect(preview()).toBe('Bucha');

    postDraftState.fields = null;
    flushSync();
    expect(preview()).toBe(sample('#place'));
    expect(optionButton('Open post').disabled).toBe(true);
    expect(optionButton('Sample').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the character counters', () => {
  it('counts the first post for each platform', () => {
    open({ body: 'hello', mention: '' });
    expect(counters().map((c) => c.textContent)).toEqual(['X 5/280', 'Bluesky 5/300']);
    expect(target.querySelector('.counters').textContent).toBe('X 5/280 · Bluesky 5/300');
  });

  it('reddens only the platform whose limit the post is past', () => {
    open({ body: 'a'.repeat(290), mention: '' });
    const [x, bluesky] = counters();
    expect(x.textContent).toBe('X 290/280');
    expect(x.classList.contains('over')).toBe(true);
    expect(bluesky.textContent).toBe('Bluesky 290/300');
    expect(bluesky.classList.contains('over')).toBe(false);
  });

  it('counts a link as X does, whatever its length', () => {
    open({ body: `https://example.org/${'a'.repeat(200)}`, mention: '' });
    expect(counters()[0].textContent).toBe('X 23/280');
  });
});

describe('a word that looks like a token and is not one', () => {
  it('is named with the token it meant', () => {
    open({ body: '#place\n#coordinate' });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].textContent.replace(/\s+/g, ' ')).toContain(
      '#coordinate is not a token. Did you mean #coordinates?',
    );
  });

  it('is mended everywhere by Fix, which then goes away', () => {
    const data = open({ body: '#coordinate\n#place #coordinate\n#coordinates' });
    click(warnings()[0].querySelector('button'));
    expect(data.body).toBe('#coordinates\n#place #coordinates\n#coordinates');
    expect(warnings()).toHaveLength(0);
    expect(target.querySelector('textarea.body').value).toBe(data.body);
  });

  it('says nothing about a layout made of real tokens and its own hashtags', () => {
    open({ body: `${DEFAULT_TWEET_BODY}\n#osint` });
    expect(warnings()).toHaveLength(0);
  });

  it('appears as the layout is typed', () => {
    const textarea = () => target.querySelector('textarea.body');
    open({ body: '#place' });
    expect(warnings()).toHaveLength(0);
    textarea().value = '#place\n#plus_code';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(warnings()).toHaveLength(1);
  });
});

describe('starting points', () => {
  const starters = () => target.querySelector('.starters');

  it('are offered for a new template only', () => {
    open({ fresh: false });
    expect(starters()).toBeNull();
  });

  it('are one button each, and Start from says what they are', () => {
    open({ fresh: true });
    expect(starters().textContent).toContain('Start from');
    expect([...starters().querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(
      POST_TEMPLATE_STARTERS.map((s) => s.label),
    );
  });

  it('replace the layout with theirs and leave the rest of the template alone', () => {
    const data = open({ fresh: true, mention: '@House', mediaEnabled: false });
    const short = POST_TEMPLATE_STARTERS.find((s) => s.id === 'short');
    click([...starters().querySelectorAll('button')].find((b) => b.textContent.trim() === short.label));
    expect(data.body).toBe(short.body);
    expect(target.querySelector('textarea.body').value).toBe(short.body);
    expect(data.mention).toBe('@House');
    expect(data.mediaEnabled).toBe(false);
    expect(preview()).toBe(`${sample('#place')}\n48.850000, 2.350000\n\nSource: ${sample('#source')}`);
  });
});

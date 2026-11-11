// @vitest-environment happy-dom
/**
 * The post-template editor, actually mounted.
 *
 * What it promises is only visible in a DOM: a preview that follows the layout as
 * it is typed, a count that turns red at a platform's limit, a warning that mends
 * itself in one click, and starting layouts that appear for a new template only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import PostTemplateEditor from './PostTemplateEditor.svelte';
import { postDraftState } from '../lib/state.svelte.js';
import { DEFAULT_TWEET_BODY, POST_TEMPLATE_STARTERS, TWEET_TOKENS, VIDEO_THREAD_STARTERS } from '../lib/post.js';

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
    expect(preview()).toBe(`${sample('#place')}\n48.850000, 2.350000\n${sample('#timecode')}\n\nSource: ${sample('#source')}`);
  });
});

describe('a template of a kind', () => {
  const tokenTags = () => [...target.querySelectorAll('.tokens .tok')].map((b) => b.textContent.trim());

  it('says its kind, and a template from before is a geolocation', () => {
    open();
    expect(target.querySelector('.pe-kind').textContent.trim()).toBe('Geolocation');
    unmount(app);
    open({ kind: 'plate', body: '#description' });
    expect(target.querySelector('.pe-kind').textContent.trim()).toBe('Map plate');
  });

  it('offers the tokens and the starts of its kind', () => {
    open({ kind: 'free', fresh: true, body: '#description' });
    expect(tokenTags()).not.toContain('#coordinates');
    expect(tokenTags()).toEqual(expect.arrayContaining(['#description', '#source', '#credits']));
    expect([...target.querySelectorAll('.starters button')].map((b) => b.textContent.trim())).toEqual(['Text and source']);
    unmount(app);
    open({ kind: 'video', fresh: true });
    expect(tokenTags()).toEqual(expect.arrayContaining(['#timecode', '#scenes', '#video']));
    expect([...target.querySelectorAll('.starters button')].map((b) => b.textContent.trim()))
      .toEqual(['Recap first', 'Video first', 'Proof first', 'All in one']);
  });

  it('previews with a sample of its kind', () => {
    open({ kind: 'free', body: '#description\n#coordinates' });
    expect(preview()).toBe('Smoke over the port at dusk, seen from three angles');
  });
});

describe('a video thread template', () => {
  const posts = () => [...target.querySelectorAll('.pv-post')].map((post) => ({
    label: post.querySelector('.pv-num').textContent,
    text: post.querySelector('pre').textContent,
  }));
  const text = (role) => target.querySelector(`[data-role="${role}"] textarea`);
  const recapFirst = VIDEO_THREAD_STARTERS[0];

  it('says its order and each post\'s text, and previews the whole thread on three places', () => {
    const data = open({ kind: 'video', body: recapFirst.body, mediaEnabled: false });
    // a template that said neither starts on Recap first's
    expect(data.order).toBe('recap');
    expect(data.posts).toEqual(recapFirst.posts.map((one) => ({ ...one })));
    expect(target.querySelector('select.order').value).toBe('recap');
    expect(text('video').value).toBe('Source: #source');
    expect(text('place').value).toBe('#description\n#timecode\n\n#coordinates');
    expect(target.querySelector('.chk input')).toBeNull(); // no media post: each post carries its own
    expect(posts().map((p) => p.label)).toEqual(['1 · Recap', '2 · Video', '3 · Road bridge', '4 · Port gate', '5 · Hilltop village']);
    expect(posts()[0].text).toBe(`${sample('#video')}\n\n1. [0:00–0:07] Road bridge\n2. [0:15] Port gate\n3. Hilltop village\n\n@GeoConfirmed`);
    expect(posts()[3].text).toBe('Port gate\n[0:15]\n\n48.860000, 2.360000');
    expect(posts()[4].text).toBe('Hilltop village\n\n48.870000, 2.370000');
  });

  it('follows the order picked and the texts as they are typed', () => {
    const data = open({ kind: 'video', body: recapFirst.body });
    const order = target.querySelector('select.order');
    order.value = 'proof';
    order.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(data.order).toBe('proof');
    expect(posts().map((p) => p.label)).toEqual(['1 · Road bridge', '2 · Video', '3 · Port gate', '4 · Hilltop village']);
    text('place').value = 'Here: #timecode';
    text('place').dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(data.posts.find((one) => one.role === 'place').body).toBe('Here: #timecode');
    expect(posts()[0].text).toBe('Here: [0:00–0:07]');
  });

  it('puts a token in the text last written in', () => {
    const data = open({ kind: 'video', body: '#scenes' });
    text('video').dispatchEvent(new Event('focus'));
    flushSync();
    click([...target.querySelectorAll('.tokens .tok')].find((b) => b.textContent.trim() === '#mention'));
    expect(data.posts.find((one) => one.role === 'video').body).toContain('#mention');
    expect(data.body).toBe('#scenes');
  });

  it('starts from one order\'s layout, its texts and its order', () => {
    const data = open({ kind: 'video', fresh: true });
    click([...target.querySelectorAll('.starters button')].find((b) => b.textContent.trim() === 'All in one'));
    const all = VIDEO_THREAD_STARTERS.find((one) => one.order === 'all');
    expect([data.order, data.body]).toEqual(['all', all.body]);
    expect(posts()).toHaveLength(1);
  });

  it('previews with the open post only when it is of that kind', () => {
    postDraftState.fields = { description: 'A free one', kind: 'free' };
    open({ body: '#description' });
    expect(optionButton('Open post').disabled).toBe(true);
    unmount(app);
    open({ kind: 'free', body: '#description' });
    expect(optionButton('Open post').disabled).toBe(false);
  });

  it('lets a geolocation reply under the source by default, written only when it does', () => {
    const data = open();
    const box = target.querySelector('label.reply input[type="checkbox"]');
    expect(box.closest('label').textContent.trim()).toBe('Reply under the source by default');
    expect(box.checked).toBe(false);
    box.click();
    flushSync();
    expect(data.reply).toBe(true);
    box.click();
    flushSync();
    expect(data).not.toHaveProperty('reply');
    unmount(app);
    open({ kind: 'free', body: '#description' });
    expect(target.querySelector('label.reply')).toBeNull();
  });
});

describe('the post templates 0.3.3 wrote', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const stored = JSON.parse(readFileSync(join(here, '../../../tests/fixtures/post-templates-0.3.3.json'), 'utf8'));

  it('open as geolocations and are left as they were by an editor that only looks', () => {
    for (const record of stored.post) {
      const data = open({ ...structuredClone(record.data) });
      expect(target.querySelector('.pe-kind').textContent.trim()).toBe('Geolocation');
      expect(JSON.parse(JSON.stringify(data))).toEqual({ ...record.data });
      unmount(app);
      app = null;
      target.remove();
    }
  });
});

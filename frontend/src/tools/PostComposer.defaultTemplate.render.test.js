// @vitest-environment happy-dom
/**
 * The Post composer and the template a new post starts with, actually mounted.
 *
 * The rule is about timing more than layout: the template can be there before
 * the composer, arrive after it, or be taken off by the analyst, and each of
 * those has to leave the draft as the analyst would expect to find it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('konva', () => ({ default: {} }));

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(async () => []),
    put: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
}));

const { caseState, postDraftState, prefs, templatesState, uiState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');

const HOUSE = {
  id: 'po_1',
  name: 'House style',
  data: { mention: '@House', body: '#coordinates\n#mention', mediaEnabled: true, extraTweets: [] },
};
const OTHER = {
  id: 'po_2',
  name: 'Other style',
  data: { mention: '', body: '#place', mediaEnabled: true, extraTweets: [] },
};

let target;
let app;

const mountComposer = () => {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(PostComposer, { target });
  flushSync();
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const chip = () => target.querySelector('.tpl-loaded-name')?.textContent.trim() ?? null;
const removeButton = () => target.querySelector('.tpl-remove');
const description = () => target.querySelector('#pc-desc');
const mentionField = () => target.querySelector('input[placeholder="@GeoConfirmed"]');
const toasts = () => uiState.toasts.map((t) => t.message);

beforeEach(() => {
  prefs.postTemplate = '';
  prefs.postMention = '@GeoConfirmed';
  templatesState.post = [];
  uiState.toasts.splice(0);
  caseState.current = null;
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  prefs.postTemplate = '';
  templatesState.post = [];
  caseState.current = null;
  uiState.toasts.splice(0);
});

describe('a blank composer', () => {
  it('starts on the default template, without a toast', () => {
    templatesState.post = [HOUSE, OTHER];
    prefs.postTemplate = 'po_1';
    mountComposer();

    expect(chip()).toBe('House style');
    expect(toasts()).toEqual([]);
    expect(mentionField().value).toBe('@House'); // the template set it
  });

  it('starts classic when no default is set', () => {
    templatesState.post = [HOUSE];
    mountComposer();
    expect(chip()).toBeNull();
    expect(target.querySelector('#pc-tpl')).not.toBeNull(); // the picker, still offered
  });

  it('starts classic when the default names a template that is gone', () => {
    templatesState.post = [OTHER];
    prefs.postTemplate = 'po_gone';
    mountComposer();
    expect(chip()).toBeNull();
  });

  it('picks the template up when it arrives after the composer', async () => {
    mountComposer();
    expect(chip()).toBeNull();

    prefs.postTemplate = 'po_1';
    flushSync();
    expect(chip()).toBeNull(); // the preference is here, the template is not yet
    templatesState.post = [HOUSE];
    await settle();

    expect(chip()).toBe('House style');
    expect(toasts()).toEqual([]);
  });

  it('follows a change of the default while it is still blank', async () => {
    mountComposer();
    templatesState.post = [HOUSE, OTHER];
    prefs.postTemplate = 'po_2';
    await settle();
    expect(chip()).toBe('Other style');
  });
});

describe('Remove', () => {
  it('goes back to the classic layout and stays there', async () => {
    templatesState.post = [HOUSE];
    prefs.postTemplate = 'po_1';
    mountComposer();
    expect(mentionField().value).toBe('@House');

    removeButton().click();
    await settle();

    expect(chip()).toBeNull();
    expect(mentionField().value).toBe('@GeoConfirmed');
    expect(target.querySelector('#pc-tpl')).not.toBeNull();
    // changing what the effect reads must not put the template back
    templatesState.post = [HOUSE, OTHER];
    await settle();
    expect(chip()).toBeNull();
  });

  it('does not make an empty composer look as if it held a post', async () => {
    templatesState.post = [HOUSE];
    prefs.postTemplate = 'po_1';
    mountComposer();
    removeButton().click();
    await settle();

    expect(postDraftState.fields).toBeNull();
    expect([...target.querySelectorAll('.head-actions button')].map((b) => b.textContent.trim()))
      .not.toContain('Discard');
  });

  it('is undone by the next blank draft, which starts on the default again', async () => {
    templatesState.post = [HOUSE];
    prefs.postTemplate = 'po_1';
    caseState.current = { id: 'case-1', folders: [], entities: [] };
    mountComposer();
    await settle();
    removeButton().click();
    await settle();
    expect(chip()).toBeNull();

    caseState.current = { id: 'case-2', folders: [], entities: [] };
    await settle();
    expect(chip()).toBe('House style');
  });
});

describe('a composer that holds a post', () => {
  it('is left as it is when the default arrives late', async () => {
    mountComposer();
    description().value = 'A rooftop';
    description().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    templatesState.post = [HOUSE];
    prefs.postTemplate = 'po_1';
    await settle();

    expect(chip()).toBeNull();
    expect(description().value).toBe('A rooftop');
  });

  it('starts the next draft on the default once it is discarded', async () => {
    templatesState.post = [HOUSE];
    prefs.postTemplate = 'po_1';
    mountComposer();
    description().value = 'A rooftop';
    description().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const discard = [...target.querySelectorAll('.head-actions button')]
      .find((b) => b.textContent.trim() === 'Discard');
    discard.click();
    flushSync();
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.trim() !== 'Cancel');
    confirm.click();
    await settle();

    expect(description().value).toBe('');
    expect(chip()).toBe('House style');
  });
});

describe('the draft the template editor previews with', () => {
  it('is nothing while the composer is empty', () => {
    mountComposer();
    expect(postDraftState.fields).toBeNull();
  });

  it('carries what the tokens stand for once the composer holds a post', async () => {
    mountComposer();
    description().value = 'A rooftop';
    description().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(postDraftState.fields).toMatchObject({
      description: 'A rooftop',
      mention: '@GeoConfirmed',
      place: '',
      source: '',
      date: '',
    });
  });

  it('lets go when the composer goes', async () => {
    mountComposer();
    description().value = 'A rooftop';
    description().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(postDraftState.fields).not.toBeNull();

    unmount(app);
    app = null;
    expect(postDraftState.fields).toBeNull();
  });
});

describe('Publish', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('still opens the site when the browser refuses the clipboard, and says what is left to do', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    mountComposer();
    await settle();
    const first = target.querySelector('.tweet-block textarea');
    first.value = 'Convoy on the coast road';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const publish = [...target.querySelectorAll('button')].find((b) => b.title.startsWith('Copy posts and open'));
    expect(publish.disabled).toBe(false);

    publish.click();
    publish.click(); // a second press while the first runs opens nothing more
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(toasts()).toContain('The browser refused the clipboard');
    expect(toasts().some((t) => t.endsWith('Copy the replies from here.'))).toBe(true);
  });
});

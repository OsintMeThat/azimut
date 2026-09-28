// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The entry line, filled the way an analyst fills it: one thing to say is enough, the
 * entity it was opened from already in its seat, `@` for the rest, a date only when
 * one is given, and one request that files the whole entry.
 */

const CONDITIONS = [
  { value: 'intact', label: 'Intact' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'destroyed', label: 'Destroyed' },
  { value: 'abandoned', label: 'Abandoned' },
];
const TYPES = [
  { type: 'person', family: 'actor', label: 'Person', attrs: [{ key: 'aliases', label: 'Other names', kind: 'text' }], manual: true },
  { type: 'organization', family: 'actor', label: 'Organization', attrs: [], manual: true },
  { type: 'vehicle', family: 'asset', label: 'Vehicle', attrs: [{ key: 'plate', label: 'Plate', kind: 'text' }], manual: true },
  { type: 'equipment-type', family: 'class', label: 'Equipment type', attrs: [], manual: true },
  { type: 'account', family: 'identifier', label: 'Account', attrs: [], manual: true },
  { type: 'email', family: 'identifier', label: 'Email', attrs: [], manual: true },
  { type: 'place', family: 'place', label: 'Place', attrs: [{ key: 'aliases', label: 'Other names', kind: 'text' }] },
  { type: 'media', family: 'collected', label: 'Media', attrs: [] },
  {
    type: 'claim',
    family: 'claim',
    label: 'Claim',
    manual: true,
    attrs: [
      { key: 'count', label: 'How many', kind: 'number', minimum: 1, maximum: 100000 },
      { key: 'condition', label: 'Condition', kind: 'choice', options: CONDITIONS },
      {
        key: 'confidence',
        label: 'Confidence',
        kind: 'choice',
        options: [
          { value: 'certain', label: 'Certain' },
          { value: 'probable', label: 'Probable' },
        ],
      },
    ],
  },
];
const SUBJECTS = ['equipment-type', 'vehicle', 'person', 'organization', 'account', 'email', 'place', 'media'];
const verb = (type, to) => ({ type, label: type, action: 'claim', manual: true, from_types: ['claim'], to_types: to });
const RELATIONS = [
  verb('about', SUBJECTS),
  verb('at', ['place']),
  verb('cites', ['media', 'claim']),
];

const KHARKIV = { id: 'place-k', type: 'place', label: 'Kharkiv', attrs: { lat: 49.99, lon: 36.23 } };
const LVIV = { id: 'place-l', type: 'place', label: 'Lviv', attrs: { lat: 49.84, lon: 24.03 } };
const LISBON = { id: 'place-p', type: 'place', label: 'Lisbon', attrs: { lat: 38.72, lon: -9.14 } };
const CROSSROADS = { id: 'place-1', type: 'place', label: 'Crossroads North', attrs: { aliases: 'Perekhrestia; X-roads' } };
const TRUCK = { id: 'v-1', type: 'vehicle', label: 'Bridge truck', attrs: { plate: 'AA1234' } };

let catalog = [];
let twin = null;
const get = vi.fn(async (url) => {
  if (url.includes('/entity-types')) return TYPES;
  if (url.includes('/relation-types')) return RELATIONS;
  if (url.includes('/confidence-levels')) return [];
  if (url.includes('/catalog/summary')) return { total: 6, by_type: { organization: 3, person: 1, media: 1, claim: 1 } };
  if (url.includes('/entities/twin')) return { entity: twin };
  if (url.includes('/api/geo/zone')) {
    const lon = Number(new URL(url, 'http://x').searchParams.get('lon'));
    return { name: lon > 30 ? 'Europe/Kyiv' : lon > 20 ? 'Europe/Kyiv' : 'Europe/Lisbon' };
  }
  if (url.includes('/catalog/entities')) return { items: catalog };
  return { items: [] };
});
const post = vi.fn(async () => ({ entity: { id: 'claim-1' }, created: [], links: [] }));
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const reloadCase = vi.fn(async () => {});
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', () => ({ reloadCase, toast }));

const { default: EntryLine, claimSeat } = await import('./EntryLine.svelte');
const { forgetZones } = await import('../lib/localZone.js');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
  flushSync();
}

async function open(entity = null, props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(EntryLine, { target, props: { caseId: 'case-a', entity, ...props } });
  await settle();
  return live;
}

function close() {
  if (live) unmount(live);
  live = null;
  target?.remove();
}

const sentence = () => target.querySelector('input[aria-label="What happened"]');
const dateField = () => target.querySelector('input[aria-label="When"]');
const count = () => target.querySelector('input[type="number"]');
const conditionSelect = () =>
  [...target.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'destroyed'));
const button = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const addButton = () => button('Add');
const options = () => [...target.querySelectorAll('[role="option"]')];
const chips = () => [...target.querySelectorAll('.chip')].map((chip) => chip.textContent.replace(/\s+/g, ' ').trim());

function type(element, value) {
  element.value = value;
  if (element.type === 'text') element.setSelectionRange(value.length, value.length);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function choose(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function key(element, name, extra = {}) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
  flushSync();
}

const MODEL = { id: 'model-1', type: 'equipment-type', label: 'T-72B3' };

beforeEach(() => {
  vi.clearAllMocks();
  catalog = [];
  twin = null;
  forgetZones();
});

afterEach(close);

describe('filed from a model', () => {
  it('opens on how many and in what state, and writes the sentence from them', async () => {
    await open(MODEL);

    expect(count()).not.toBeNull();
    expect(conditionSelect()).not.toBeUndefined();
    expect(sentence().value).toBe('T-72B3 seen');

    type(count(), '2');
    choose(conditionSelect(), 'destroyed');
    expect(sentence().value).toBe('2 × T-72B3 destroyed');
  });

  it('files the observation about the model in one request, then refreshes the case', async () => {
    const onsaved = vi.fn();
    await open(MODEL, { onsaved });
    type(count(), '2');
    choose(conditionSelect(), 'destroyed');

    addButton().click();
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/timeline/claims', {
      statement: '2 × T-72B3 destroyed',
      when: null,
      time_role: null,
      confidence: null,
      count: 2,
      condition: 'destroyed',
      about: ['model-1'],
      at: [],
      cites: [],
      create: [],
    });
    expect(reloadCase).toHaveBeenCalled();
    expect(onsaved).toHaveBeenCalled();
  });

  it('keeps a sentence the analyst wrote when a field changes under it', async () => {
    await open(MODEL);
    type(sentence(), 'Two tanks burning near the bridge');
    type(count(), '3');

    expect(sentence().value).toBe('Two tanks burning near the bridge');
    button('Rewrite from the mentions').click();
    flushSync();
    expect(sentence().value).toBe('3 × T-72B3 seen');
  });
});

describe('filed from something else', () => {
  it('asks a named object for its state and never for a count', async () => {
    await open(TRUCK);
    expect(count()).toBeNull();
    expect(conditionSelect()).not.toBeUndefined();
  });

  it('asks a person for neither, and keeps them folded away', async () => {
    await open({ id: 'p-1', type: 'person', label: 'Ivan' });
    expect(count()).toBeNull();
    expect(conditionSelect()).toBeUndefined();
    expect(sentence().value).toBe('Ivan seen');
  });

  it('seats a place where it was seen', async () => {
    await open({ id: 'place-1', type: 'place', label: 'Crossroads' });
    expect(sentence().value).toBe('Seen at Crossroads');

    type(sentence(), 'Convoy seen at Crossroads');
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ about: [], at: ['place-1'], cites: [] });
  });

  it('seats a video as the source and says it was seen in it', async () => {
    await open({ id: 'm-1', type: 'media', label: 'clip.mp4', attrs: { kind: 'video' } });
    expect(sentence().value).toBe('Seen in clip.mp4');
    // A date is never offered from the file: the line opens with none.
    expect(dateField().value).toBe('');

    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ statement: 'Seen in clip.mp4', when: null, about: [], at: [], cites: ['m-1'] });
  });
});

describe('what the line asks for', () => {
  it('needs one thing to say, and says so on the button', async () => {
    await open();
    expect(addButton().disabled).toBe(true);
    expect(addButton().title).toBe('Write what happened, mention a subject or cite a source');

    type(sentence(), 'Explosions heard');
    expect(addButton().disabled).toBe(false);
  });

  it('holds back a date it cannot read, and not an empty one', async () => {
    await open();
    type(sentence(), 'Explosions heard');
    type(dateField(), '12/03/26');
    expect(addButton().disabled).toBe(true);
    expect(addButton().title).toBe('Correct the date or clear it');

    type(dateField(), '');
    expect(addButton().disabled).toBe(false);

    type(dateField(), 'mars 2026');
    expect(target.textContent).toContain('Reads: Mar 2026');
    key(sentence(), 'Enter');
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ statement: 'Explosions heard', when: '2026-03', time_role: 'observed' });
  });

  it('empties after adding and keeps the sentence for the next one, with an Undo', async () => {
    post.mockResolvedValueOnce({ entity: { id: 'claim-9' }, created: [{ id: 'org-1' }], links: [] });
    await open();
    type(sentence(), 'Explosions heard');
    key(sentence(), 'Enter');
    await settle();

    expect(sentence().value).toBe('');
    expect(document.activeElement).toBe(sentence());
    const [message, kind, , action] = toast.mock.calls.at(-1);
    expect([message, kind, action.label]).toEqual(['Added', 'ok', 'Undo']);

    await action.onClick();
    expect(post).toHaveBeenLastCalledWith('/api/cases/case-a/entities/delete', { ids: ['claim-9', 'org-1'] });
  });

  it('keeps everything and says why when the case refuses', async () => {
    post.mockRejectedValueOnce(new Error("entity 'place-1' not found"));
    await open({ id: 'place-1', type: 'place', label: 'Crossroads' });
    addButton().click();
    await settle();

    expect(sentence().value).toBe('Seen at Crossroads');
    expect(target.querySelector('[role="alert"]').textContent).toContain('not found');
  });

  it('files from any field with Ctrl+Enter', async () => {
    await open();
    type(sentence(), 'Explosions heard');
    key(dateField(), 'Enter', { ctrlKey: true });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('mentions', () => {
  it('offers an exact other name first and says which field matched', async () => {
    catalog = [TRUCK, { id: 'place-2', type: 'place', label: 'X-roads market' }, CROSSROADS];
    await open();
    type(sentence(), 'Convoy at @X-roads');
    await settle();

    const names = options().map((option) => option.querySelector('.name').textContent);
    expect(names[0]).toBe('Crossroads North');
    expect(options()[0].textContent).toContain('Also known as: X-roads');
    expect(names.at(-1)).toBe('New · X-roads');
    expect(get.mock.calls.some(([url]) => url.includes('/catalog/entities') && url.includes('q=X-roads'))).toBe(true);
  });

  it('puts the chosen name in the sentence and the subject in its seat', async () => {
    catalog = [CROSSROADS, TRUCK];
    await open();
    type(sentence(), 'Convoy at @Cross');
    await settle();
    key(sentence(), 'Enter');
    await settle();

    expect(sentence().value).toBe('Convoy at Crossroads North ');
    expect(chips()).toEqual([expect.stringContaining('Crossroads North at')]);

    type(sentence(), 'Convoy at Crossroads North with @AA12');
    await settle();
    key(sentence(), 'ArrowDown');
    key(sentence(), 'ArrowUp');
    key(sentence(), 'Tab');
    await settle();
    expect(chips()[1]).toContain('Bridge truck about');

    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ at: ['place-1'], about: ['v-1'], create: [] });
  });

  it('shows the field that matched when it is not the name', async () => {
    catalog = [TRUCK];
    await open();
    type(sentence(), '@AA12');
    await settle();
    expect(options()[0].textContent).toContain('Plate: AA1234');
  });

  it('keeps a literal @ as text on Escape', async () => {
    catalog = [TRUCK];
    await open();
    type(sentence(), 'Mail @ops');
    await settle();
    expect(options().length).toBeGreaterThan(0);
    key(sentence(), 'Escape');
    expect(target.querySelector('[role="listbox"]')).toBeNull();
    expect(sentence().value).toBe('Mail @ops');
    expect(chips()).toEqual([]);
  });

  it('never opens a mention inside an address', async () => {
    await open();
    type(sentence(), 'Wrote to ops@example.org');
    await settle();
    expect(target.querySelector('[role="listbox"]')).toBeNull();
  });

  it('removes a mention with a click on its chip, and moves it with Alt+↓', async () => {
    catalog = [TRUCK];
    await open();
    type(sentence(), '@Bridge');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    const chip = target.querySelector('.chip-name');
    chip.click();
    flushSync();
    expect(chips()).toEqual([]);

    catalog = [CROSSROADS];
    type(sentence(), '@Cross');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    expect(chips()[0]).toContain('Crossroads North at');
    // A place can also be what the entry is about.
    key(target.querySelector('.chip-name'), 'ArrowDown', { altKey: true });
    expect(chips()[0]).toContain('Crossroads North about');
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ about: ['place-1'], at: [] });
  });
});

describe('a new subject', () => {
  it('is guessed from its shape, says its rule, and is created only with the line', async () => {
    await open();
    type(sentence(), 'Mail from @ops@example.org');
    await settle();
    const created = options().at(-1);
    expect(created.textContent).toContain('New · ops@example.org');
    expect(created.textContent).toContain('Email · looks like an email');
    key(sentence(), 'Enter');
    await settle();

    expect(chips()[0]).toContain('new · looks like an email');
    expect(post).not.toHaveBeenCalled();

    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({
      statement: 'Mail from ops@example.org',
      about: [],
      create: [{ slot: 'about', type: 'email', label: 'ops@example.org' }],
    });
  });

  it('takes the type the case uses most when its shape says nothing', async () => {
    await open();
    type(sentence(), '@4th brigade');
    await settle();
    expect(options().at(-1).textContent).toContain('Organization · the type this case uses most');
  });

  it('can be retyped from its chip', async () => {
    await open();
    type(sentence(), '@Ivan');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    const retype = target.querySelector('select.retype');
    expect([...retype.options].map((option) => option.value)).not.toContain('place');
    choose(retype, 'person');
    await settle();
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1].create).toEqual([{ slot: 'about', type: 'person', label: 'Ivan' }]);
  });

  it('offers the identifier the case already holds, without refusing the new one', async () => {
    twin = { id: 'mail-1', type: 'email', label: 'ops@example.org' };
    await open();
    type(sentence(), '@ops@example.org');
    await settle();
    key(sentence(), 'Enter');
    await settle();

    expect(addButton().disabled).toBe(false);
    button('Use the one in the case').click();
    flushSync();
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ about: ['mail-1'], create: [] });
  });
});

describe('the time at the place', () => {
  it('reads an hour as the local time at the one place, summer or winter', async () => {
    await open(KHARKIV);
    type(sentence(), 'Strike reported');
    type(dateField(), '11/08/2026 17:05');
    await settle();
    expect(target.textContent).toContain('Reads: 17:05 at Kharkiv (Europe/Kyiv, UTC+03:00)');

    addButton().click();
    await settle();
    expect(post.mock.calls[0][1].when).toBe('2026-08-11T17:05:00+03:00');

    type(sentence(), 'Second strike');
    type(dateField(), '11/01/2026 17:05');
    await settle();
    addButton().click();
    await settle();
    expect(post.mock.calls[1][1].when).toBe('2026-01-11T17:05:00+02:00');
    // One zone read per point, however many times the hour changes.
    expect(get.mock.calls.filter(([url]) => url.includes('/api/geo/zone'))).toHaveLength(1);
  });

  it('never replaces a zone the analyst typed, and can be turned down', async () => {
    await open(KHARKIV);
    type(sentence(), 'Strike reported');
    type(dateField(), '11/08/2026 17:05 UTC');
    await settle();
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1].when).toBe('2026-08-11T17:05:00Z');

    type(sentence(), 'Strike reported');
    type(dateField(), '11/08/2026 17:05');
    await settle();
    button('No zone').click();
    flushSync();
    addButton().click();
    await settle();
    expect(post.mock.calls[1][1].when).toBe('2026-08-11T17:05:00');
  });

  it('takes no zone for granted when two places disagree, and offers each', async () => {
    catalog = [LISBON];
    await open(KHARKIV);
    type(sentence(), 'Seen at Kharkiv and @Lisbon');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    type(dateField(), '11/08/2026 17:05');
    await settle();

    expect(button('Local at Kharkiv')).toBeDefined();
    expect(button('Local at Lisbon')).toBeDefined();
    button('Local at Lisbon').click();
    flushSync();
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1].when).toBe('2026-08-11T17:05:00+01:00');
  });

  it('counts two places in one zone as one choice', async () => {
    catalog = [LVIV];
    await open(KHARKIV);
    type(sentence(), 'Seen in @Lviv');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    type(dateField(), '11/08/2026 17:05');
    await settle();
    expect(target.textContent).toContain('Reads: 17:05 at Kharkiv (Europe/Kyiv, UTC+03:00)');
  });
});

describe('help where it is needed', () => {
  it('says what a date can be while its field is empty and focused', async () => {
    await open();
    dateField().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flushSync();
    const help = target.querySelector('.help').textContent;
    for (const example of ['12/03/2026', '12/03/2026 14:30', 'March 2026', '~2026', '2026?', '12/03/2026 to 15/03/2026']) {
      expect(help).toContain(example);
    }
    expect(help).toContain('Or leave it empty: the entry waits in Undated.');

    type(dateField(), 'mars 2026');
    expect(target.querySelector('.help')).toBeNull();
    expect(target.textContent).toContain('Reads: Mar 2026');
  });

  it('says how the sentence works while it is empty and focused', async () => {
    await open();
    sentence().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.help').textContent).toContain('mentions a person, a place or a file');
    type(sentence(), 'Explosions heard');
    expect(target.querySelector('.help')).toBeNull();
  });

  it('builds a date from the calendar for someone who would rather point at it', async () => {
    await open();
    target.querySelector('button[aria-label="Build the date"]').click();
    flushSync();
    expect(target.querySelector('.calendar-panel')).not.toBeNull();
    button('Today').click();
    flushSync();
    expect(dateField().value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.calendar-panel')).toBeNull();
  });

  it('cites a source picked by its kind from the paperclip', async () => {
    catalog = [
      { id: 'm-1', type: 'media', label: 'clip.mp4', attrs: { kind: 'video' } },
      { id: 'c-9', type: 'claim', label: 'Earlier finding' },
    ];
    await open();
    target.querySelector('button[aria-label="Cite a source"]').click();
    await settle();

    const kinds = [...target.querySelectorAll('[aria-label="Kinds"] button')].map((chip) => chip.textContent.trim());
    expect(kinds).toEqual(['All', 'Media1', 'Claim1']);
    const finder = get.mock.calls.map(([url]) => url).filter((url) => url.includes('/catalog/entities')).at(-1);
    expect(finder).toContain('order=-created');
    expect(finder).toContain('previews=true');

    target.querySelector('.sources-panel [role="option"]').dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.querySelector('.sources-panel')).toBeNull();
    expect(chips()[0]).toContain('clip.mp4 source');
    expect(sentence().value).toBe('Seen in clip.mp4');

    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ statement: 'Seen in clip.mp4', cites: ['m-1'] });
  });
});

describe('more, and the full editor', () => {
  it('asks a confidence and hands the whole draft to the full editor', async () => {
    catalog = [TRUCK];
    await open();
    type(sentence(), 'Truck at the bridge @Bridge');
    await settle();
    key(sentence(), 'Enter');
    await settle();
    type(dateField(), 'mars 2026');
    button('More').click();
    flushSync();
    const confidence = [...target.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'probable'));
    choose(confidence, 'probable');

    button('Full editor').click();
    await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.querySelector('#temporal-statement').value).toBe('Truck at the bridge Bridge truck');
    expect(dialog.textContent).toContain('Bridge truck');
    expect([...dialog.querySelectorAll('select')].some((s) => s.value === 'probable')).toBe(true);
  });
});

describe('a draft', () => {
  it('is kept for the session under its key, and dropped once added', async () => {
    await open(null, { draftKey: 'timeline:' });
    type(sentence(), 'Half written');
    close();

    await open(null, { draftKey: 'timeline:' });
    expect(sentence().value).toBe('Half written');
    addButton().click();
    await settle();
    close();

    await open(null, { draftKey: 'timeline:' });
    expect(sentence().value).toBe('');
  });

  it('takes a date offered from the axis and goes to the sentence', async () => {
    const line = await open();
    line.offer('2026-03-12');
    await settle();
    expect(dateField().value).toBe('12/03/2026');
    expect(document.activeElement).toBe(sentence());
  });
});

describe('claimSeat', () => {
  it('offers no seat on a claim itself, which has its own editor', async () => {
    await open(MODEL); // lands both registries
    expect(claimSeat({ id: 'c', type: 'claim', label: 'x' })).toBeNull();
    expect(claimSeat(MODEL)).toEqual({ slot: 'about', count: true, condition: true });
  });
});

// @vitest-environment happy-dom
/**
 * The generated fields, actually mounted and actually typed into.
 *
 * Its sibling suite reads the source, which cannot tell whether a controlled input
 * accepts a keystroke or silently reverts it — the failure an analyst reports as
 * "I can't put anything in these boxes". So this one drives the DOM.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const FIELDS = [
  {
    key: 'radius_m',
    label: 'Uncertainty radius (m)',
    kind: 'number',
    group: 'How precise',
    rungs: [
      { label: 'This block', value: 100 },
      { label: 'This town', value: 2000 },
    ],
    minimum: 1,
    maximum: 5000000,
  },
  { key: 'footprint', label: 'Footprint', kind: 'geojson', rungs: [] },
  // the two that hold sentences, as the registry declares them
  { key: 'verbatim', label: 'As the source put it', kind: 'longtext', rungs: [] },
  { key: 'method', label: 'How this point was found', kind: 'longtext', rungs: [] },
];

const RELIABILITY = {
  key: 'reliability',
  label: 'Source reliability',
  kind: 'choice',
  rungs: [],
  options: [
    { value: 'A', label: 'Completely reliable' },
    { value: 'B', label: 'Usually reliable' },
    { value: 'E', label: 'Unreliable' },
  ],
};

// Two subjects on one type, the shape a Claim has: what it states, then why that is
// believed. A single heading over all four would file a count as reasoning.
const COUNTED = [
  { key: 'count', label: 'How many', kind: 'number', group: 'What it states',
    rungs: [], minimum: 1, whole: true },
  { key: 'condition', label: 'Condition', kind: 'choice', rungs: [],
    options: [{ value: 'destroyed', label: 'Destroyed' }] },
  { key: 'confidence', label: 'Confidence', kind: 'choice', group: 'Reasoning',
    rungs: [], options: [{ value: 'probable', label: 'Probable' }] },
  { key: 'method', label: 'How this was worked out', kind: 'longtext', rungs: [] },
];

// A media declares nothing, and `traced` stands for a type whose only field is a
// shape — the one case where a declared field can still leave the block empty.
const BY_TYPE = {
  place: FIELDS,
  media: [],
  traced: [FIELDS[1]],
  claim: COUNTED,
  bookmark: [{ key: 'archive_url', label: 'Archived copy', kind: 'url', rungs: [] }, RELIABILITY],
  ip: [
    { key: 'network', label: 'Legacy network', kind: 'text', editable: false, rungs: [] },
    { key: 'provider', label: 'Provider', kind: 'text', rungs: [] },
  ],
};

vi.mock('../lib/entityTypes.svelte.js', async (importOriginal) => ({
  ...(await importOriginal()),
  entityFields: (type) => BY_TYPE[type] ?? [],
}));

const { default: AttrFields } = await import('./AttrFields.svelte');

let live = null;

function open(values = {}, type = 'place') {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(AttrFields, { target, props: { type, values } });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const field = (root, key) => root.querySelector(`#attr-${key}`);

function type(input, text) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('typing into a declared field', () => {
  it('keeps what was typed in a text field rather than reverting it', () => {
    const root = open();

    type(field(root, 'verbatim'), 'somewhere on the north quay');

    expect(field(root, 'verbatim').value).toBe('somewhere on the north quay');
  });

  it('keeps a metre count typed straight into the number field', () => {
    const root = open();

    type(field(root, 'radius_m'), '350');

    expect(field(root, 'radius_m').value).toBe('350');
  });

  it('fills every declared text field independently', () => {
    const root = open();

    type(field(root, 'verbatim'), 'the old sawmill');
    type(field(root, 'method'), 'roofline matched against 2023 imagery');

    expect(field(root, 'verbatim').value).toBe('the old sawmill');
    expect(field(root, 'method').value).toBe('roofline matched against 2023 imagery');
  });

  it('starts every field empty, with no value standing in for unknown', () => {
    const root = open();

    for (const key of ['radius_m', 'verbatim', 'method']) {
      expect(field(root, key).value, key).toBe('');
      expect(field(root, key).placeholder, key).toBe('Unknown');
    }
  });
});

describe('a field that holds sentences', () => {
  it('is a box that grows, not a line that scrolls sideways', () => {
    // 4000 characters of quoted source in a one-line input is a field nobody fills
    const root = open();

    expect(field(root, 'verbatim').tagName).toBe('TEXTAREA');
    expect(field(root, 'method').tagName).toBe('TEXTAREA');
  });

  it('keeps several lines of what was typed', () => {
    const root = open();

    type(field(root, 'method'), 'roofline matched\nagainst 2023 imagery');

    expect(field(root, 'method').value).toBe('roofline matched\nagainst 2023 imagery');
  });

  it('leaves a short field on one line', () => {
    const root = open({}, 'bookmark');

    expect(field(root, 'archive_url').tagName).toBe('INPUT');
  });
});

describe('the rungs, clicked', () => {
  const rungs = (root) => [...root.querySelectorAll('button')];

  it('writes its metres into the number field', () => {
    const root = open();

    rungs(root)[0].click();
    flushSync();

    expect(field(root, 'radius_m').value).toBe('100');
    expect(rungs(root)[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the field when the chosen rung is clicked again', () => {
    const root = open();

    rungs(root)[1].click();
    flushSync();
    expect(field(root, 'radius_m').value).toBe('2000');

    rungs(root)[1].click();
    flushSync();

    expect(field(root, 'radius_m').value).toBe('');
    expect(rungs(root)[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('moves the selection rather than adding to it', () => {
    const root = open();

    rungs(root)[0].click();
    flushSync();
    rungs(root)[1].click();
    flushSync();

    expect(field(root, 'radius_m').value).toBe('2000');
    expect(rungs(root).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('lights no rung for a radius typed between two of them', () => {
    const root = open();

    type(field(root, 'radius_m'), '350');

    expect(rungs(root).some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false);
  });
});

describe('the footprint', () => {
  const ring = [[14.55, 53.44], [14.56, 53.44], [14.56, 53.45], [14.55, 53.44]];
  const polygon = { type: 'Polygon', coordinates: [ring] };

  it('does not appear at all while there is no shape', () => {
    const root = open();

    expect(root.textContent).not.toContain('Footprint');
  });

  it('appears with its shape summarised the moment one exists', () => {
    const root = open({ footprint: polygon });

    expect(root.textContent).toContain('Footprint');
    expect(root.textContent).toContain('Polygon, 4 points');
  });

  it('goes away again when it is cleared', () => {
    const root = open({ footprint: polygon });

    [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear').click();
    flushSync();

    expect(root.textContent).not.toContain('Footprint');
  });
});

describe('a closed field', () => {
  const open_ = (values = {}) => open(values, 'bookmark');
  const pick = (root, value) => {
    const select = field(root, 'reliability');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    return select;
  };

  it('offers exactly the grades the registry served, and nothing invented here', () => {
    const options = [...open_().querySelector('#attr-reliability').options];

    expect(options.map((o) => o.value)).toEqual(['', 'A', 'B', 'E']);
    expect(options[2].textContent.trim()).toBe('B · Usually reliable');
  });

  it('starts ungraded, which is a state and not a hole', () => {
    expect(field(open_(), 'reliability').value).toBe('');
    // and nothing on screen says a grade is missing
    expect(open_().textContent).not.toContain('Not assessed');
  });

  it('keeps the grade that was picked', () => {
    expect(pick(open_(), 'B').value).toBe('B');
  });

  it('goes back to ungraded through the blank option', () => {
    const root = open_({ reliability: 'A' });

    expect(pick(root, '').value).toBe('');
  });

  it('shows the graded source beside its archived copy, both editable', () => {
    const root = open_({ reliability: 'E' });

    expect(field(root, 'reliability').value).toBe('E');
    type(field(root, 'archive_url'), 'https://web.archive.test/web/2026/https://x.test/p');
    expect(field(root, 'archive_url').value).toBe(
      'https://web.archive.test/web/2026/https://x.test/p',
    );
  });
});

describe('an older read-only field', () => {
  it('stays hidden on a new entity', () => {
    const root = open({}, 'ip');

    expect(root.textContent).not.toContain('Legacy network');
    expect(field(root, 'provider')).not.toBeNull();
  });

  it('shows an existing value without an input that could change it', () => {
    const root = open({ network: '203.0.113.0/24' }, 'ip');

    expect(root.textContent).toContain('Legacy network');
    expect(root.textContent).toContain('203.0.113.0/24');
    expect(field(root, 'network')).toBeNull();
  });
});

describe('a type with nothing to show', () => {
  it('renders no block for a type that declares no fields', () => {
    expect(open({}, 'media').textContent.trim()).toBe('');
  });

  it('renders no block, and so no heading, when every declared field hides itself', () => {
    // one geojson field and no shape in it: the heading would be the only thing left
    expect(open({}, 'traced').textContent.trim()).toBe('');
  });
});

describe('one type, two subjects', () => {
  const headings = (root) =>
    [...root.querySelectorAll('.attrs-h')].map((node) => node.textContent);

  it('opens a heading where the registry changes group, and only there', () => {
    // four fields, two headings: a count is not reasoning, and a heading per field
    // would be a form of labels rather than a form of blocks
    expect(headings(open({}, 'claim'))).toEqual(['What it states', 'Reasoning']);
  });

  it('leaves the fields in the order the vocabulary declares them', () => {
    const root = open({}, 'claim');
    const order = [...root.querySelectorAll('.attr-k')].map((node) => node.textContent);

    expect(order).toEqual([
      'How many', 'Condition', 'Confidence', 'How this was worked out',
    ]);
  });

  it('states one heading over the fields that follow it', () => {
    // a place says "How precise" once above four fields, not once per field
    expect(headings(open({ footprint: null }, 'place'))).toEqual(['How precise']);
  });

  it('counts in whole numbers, because half a destroyed thing is not a quantity', () => {
    const root = open({}, 'claim');

    expect(field(root, 'count').getAttribute('step')).toBe('1');
    expect(field(root, 'count').getAttribute('min')).toBe('1');
  });
});

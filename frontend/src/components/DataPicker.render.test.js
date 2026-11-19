// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

/**
 * The source picker (`DataPicker.svelte`): the case's sheets first, recommended, then the
 * tables of this note, then New data…, a table pasted kept as a new sheet. What is picked is
 * read at once and handed over with its rows; nothing is written to the note here.
 */

const server = vi.hoisted(() => ({ asked: [] }));
vi.mock('../lib/api.js', () => ({
  api: {
    post: vi.fn(async (path, body) => {
      server.asked.push({ path, body });
      if (path.endsWith('/notes/figure/rows')) {
        return { found: true, name: 'Vehicle register', rows: 2, text: '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| M-ATV | Almost sure |' };
      }
      return { id: 'e_new', label: body.title };
    }),
    get: vi.fn(),
  },
}));
vi.mock('../lib/state.svelte.js', () => ({ toast: vi.fn(), reloadCase: vi.fn(async () => {}) }));
const { default: DataPicker } = await import('./DataPicker.svelte');
const { toast } = await import('../lib/state.svelte.js');

const NOTE = '# Losses\n\n## The register\n\n| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n';
const SHEETS = [{ origin: 'sheet:e_s1', title: 'Vehicle register', rows: 60, columns: ['Model', 'Grade'] }];

let target;
let app;
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.body.replaceChildren();
  app = null;
  server.asked = [];
});

const settle = async () => {
  for (let step = 0; step < 6; step += 1) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync();
};

async function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const onpick = vi.fn();
  const sources = vi.fn(async () => ({ tables: [], sheets: SHEETS }));
  app = mount(DataPicker, { target, props: { caseId: 'c1', noteId: 'n1', noteText: NOTE, anchor, onpick, onclose: vi.fn(), sources, ...props } });
  await settle();
  return { onpick, sources };
}

const items = () => [...document.querySelectorAll('.float-menu .fm-item')];
const button = (words) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(words));

describe('the source picker', () => {
  it('lists the sheets first, recommended, then this note’s tables, then New data…', async () => {
    const { sources } = await open({ current: 'sheet:e_s1' });
    expect(sources).toHaveBeenCalledWith({ caseId: 'c1', noteId: 'n1' });
    expect(document.querySelector('.fm-head').textContent).toContain('Sheets of the case');
    expect(document.querySelector('.dp-rec').textContent).toBe('Recommended');
    expect(items().map((node) => node.querySelector('.fm-grow').textContent)).toEqual(['Vehicle register', 'The register', 'New data…']);
    expect(items()[0].querySelector('.fm-tick')).not.toBeNull();
  });

  it('reads the source picked now and hands it over with its rows', async () => {
    const { onpick } = await open();
    items()[0].click();
    await settle();
    expect(server.asked[0]).toEqual({ path: '/api/cases/c1/notes/figure/rows', body: { origin: 'sheet:e_s1' } });
    expect(onpick).toHaveBeenCalledTimes(1);
    const [{ origin, data }] = onpick.mock.calls[0];
    expect(origin).toBe('sheet:e_s1');
    expect(data).toMatchObject({ found: true, kind: 'sheet', name: 'Vehicle register', rows: 2, columns: ['Model', 'Grade'] });
  });

  it('offers a panel the infographic’s own data first', async () => {
    const { onpick } = await open({ inherit: { label: 'Sheet “Vehicle register”' } });
    expect(items()[0].textContent).toContain('The infographic’s data');
    items()[0].click();
    expect(onpick).toHaveBeenCalledWith({ inherit: true });
  });
});

describe('New data…', () => {
  it('keeps a table pasted as a new sheet under its name, then hands it over', async () => {
    const { onpick } = await open();
    button('New data').click();
    await settle();
    const area = document.querySelector('.nd-paste');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: (type) => (type === 'text/plain' ? 'Model\tGrade\nCougar\tConfirmed\nM-ATV\tAlmost sure\n' : '') };
    area.dispatchEvent(paste);
    await settle();
    expect(document.querySelector('.nd-said').textContent).toBe('2 rows · 2 columns');
    expect([...document.querySelectorAll('.nd-preview th')].map((node) => node.textContent)).toEqual(['Model', 'Grade']);
    // no name, no sheet
    expect(button('Make the sheet').disabled).toBe(true);
    const name = document.querySelector('.nd input.input');
    name.value = 'Vehicle register';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    button('Make the sheet').click();
    await settle();
    expect(server.asked[0]).toEqual({
      path: '/api/cases/c1/sheets',
      body: { title: 'Vehicle register', columns: ['Model', 'Grade'], rows: [['Cougar', 'Confirmed'], ['M-ATV', 'Almost sure']] },
    });
    expect(toast).toHaveBeenCalledWith('Kept as the sheet “Vehicle register”: the Sheet tool shows it.', 'ok', 5000);
    expect(onpick.mock.calls[0][0].origin).toBe('sheet:e_new');
  });

  it('says when what was pasted holds no table', async () => {
    await open();
    button('New data').click();
    await settle();
    const area = document.querySelector('.nd-paste');
    area.value = 'A sentence, not a table.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.querySelector('.nd-warn').textContent).toContain('No table in this');
    expect(button('Make the sheet').disabled).toBe(true);
  });
});

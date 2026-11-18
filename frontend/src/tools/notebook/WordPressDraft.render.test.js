// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const drawDiagrams = vi.fn(async () => ({ k1: 'cG5n' }));
const uiState = { tool: 'notebook', settingsTab: null };
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
vi.mock('../../lib/state.svelte.js', () => ({ uiState, toast: vi.fn() }));
vi.mock('../../lib/notesExport.js', () => ({ drawDiagrams }));
const { default: WordPressDraft } = await import('./WordPressDraft.svelte');

const SET = { site: 'https://desk.example.org', user: 'desk', password: { set: true, hint: '…6789' } };
const CHECK = { site: SET.site, ready: true, pictures: 3, clips: 1, left_said: '1 internal passage stays out.',
  pov: ['Junction geolocated: 15.413060, 44.236870'], warnings: ['Picture "Overlay" has no source.'], left: { internal: 1 } };

let live;
let target;
let bound;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); };

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
  bound = { busy: false, sent: null, ready: false };
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

/** The branch as the dialog holds it; `ready` read back as the dialog's Send button reads it. */
function show(noteIds = ['n1']) {
  const props = {
    caseId: 'c1', noteIds, prepare: vi.fn(async () => {}),
    get ready() { return bound.ready; }, set ready(value) { bound.ready = value; },
  };
  live = mount(WordPressDraft, { target, props });
  return props;
}

it('shows the steps of Settings while no site is set, and the way there', async () => {
  get.mockResolvedValue({ wordpress: { site: '', user: '', password: { set: false, hint: '' } } });
  post.mockResolvedValue(CHECK);
  show();
  await settle();
  expect(target.textContent).toContain('Connect your WordPress site once');
  expect(target.textContent).toContain('Users › Profile');
  expect(target.textContent).toMatch(/Free: application passwords/);
  expect(bound.ready).toBe(false);
  [...target.querySelectorAll('button')].find((node) => node.textContent.includes('Open Settings')).click();
  expect(uiState).toMatchObject({ tool: 'settings', settingsTab: 'publishing' });
});

it('says where the draft goes and what goes with it, reaching nothing', async () => {
  get.mockResolvedValue({ wordpress: SET });
  post.mockResolvedValue(CHECK);
  show();
  await settle();
  expect(target.textContent).toContain('To desk.example.org as desk, as a draft you publish in WordPress.');
  expect(target.textContent).toContain('internal passages never leave this computer');
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n1/wordpress', { check: true }, expect.anything());
  expect(target.textContent).toContain('3 pictures and 1 clip go to the media library, without their metadata.');
  expect(target.textContent).toContain('1 internal passage stays out.');
  expect(target.querySelector('[aria-label="Points of view"]').textContent).toContain('15.413060');
  expect(target.querySelector('[aria-label="Before you send"]').textContent).toContain('Picture "Overlay" has no source.');
  expect(bound.ready).toBe(true);
});

it('sends on the press, the diagrams drawn first, and says what WordPress answered', async () => {
  get.mockResolvedValue({ wordpress: SET });
  post.mockImplementation(async (path, body) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [{ key: 'k1', source: 'graph LR' }] };
    if (body?.check) return CHECK;
    return { post: 21, updated: false, left_said: '1 internal passage stays out.',
      edit: 'https://desk.example.org/wp-admin/post.php?post=21&action=edit', preview: 'https://desk.example.org/?p=21&preview=true' };
  });
  show();
  await settle();
  target.querySelector('input[type="checkbox"]').click();
  flushSync();
  await live.send();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/pdf/diagrams', { notes: ['n1'], edition: 'public' });
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n1/wordpress', { diagrams: { k1: 'cG5n' }, round_pov: true });
  expect(target.textContent).toContain('Draft saved in WordPress.');
  const preview = [...target.querySelectorAll('a')].find((node) => node.textContent === 'Preview');
  expect(preview.getAttribute('href')).toBe('https://desk.example.org/?p=21&preview=true');
  expect(preview.getAttribute('rel')).toContain('noopener');
});

it('says what went wrong in the words the site gave', async () => {
  get.mockResolvedValue({ wordpress: SET });
  post.mockImplementation(async (path, body) => {
    if (path.endsWith('/pdf/diagrams')) return { diagrams: [] };
    if (body?.check) return CHECK;
    throw new Error('WordPress refused the password: make an application password in Users › Profile, then paste it here.');
  });
  show();
  await settle();
  await live.send();
  await settle();
  expect(target.querySelector('[role="alert"]').textContent).toContain('WordPress refused the password');
  expect(target.textContent).not.toContain('Draft saved');
});

it('takes one note at a time', async () => {
  get.mockResolvedValue({ wordpress: SET });
  show(['n1', 'n2']);
  await settle();
  expect(target.textContent).toContain('WordPress takes one note at a time.');
  expect(bound.ready).toBe(false);
  expect(post).not.toHaveBeenCalled();
});
